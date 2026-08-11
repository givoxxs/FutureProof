import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { buildAnalysisReport, type AnalysisReport } from "../../../packages/engine/src/compare.ts";
import { OpenAiCompatibleClient } from "../../../packages/engine/src/llm-client.ts";
import { runAnalysis } from "../../../packages/engine/src/orchestrator.ts";
import { OPENROUTER_DEFAULT_BASE_URL, OPENROUTER_DEFAULT_MODEL } from "../../../packages/engine/src/real-model-smoke.ts";
import { loadFrozenScenarios } from "../../../packages/engine/src/scenario-validator.ts";
import { registerAnalysisRoutes, type DemoAnalysisRunner } from "./analysis-routes.ts";
import { ProgressBus } from "./progress-bus.ts";

export interface BuildServerOptions {
  projectRoot?: string;
  idFactory?: () => string;
  runDemo?: DemoAnalysisRunner;
}

function repositoryRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}

function requireOpenRouterApiKey(): string {
  const value = process.env.OPENROUTER_API_KEY?.trim();
  if (!value) throw new Error("OPENROUTER_API_KEY is required to run the live demo");
  return value;
}

export function resolveLiveLlmRequestTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env.OPENROUTER_REQUEST_TIMEOUT_MS?.trim();
  if (!raw) return 90_000;
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("OPENROUTER_REQUEST_TIMEOUT_MS must be a positive integer number of milliseconds");
  }
  return timeoutMs;
}

export function resolveAnalysisConcurrency(env: Record<string, string | undefined>): number {
  const raw = env.FUTUREPROOF_ANALYSIS_CONCURRENCY?.trim();
  if (!raw) return 2;
  const concurrency = Number(raw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("FUTUREPROOF_ANALYSIS_CONCURRENCY must be an integer from 1 through 4");
  }
  return concurrency;
}

function createDefaultRunner(projectRoot: string): DemoAnalysisRunner {
  return async ({ analysisId, emit }): Promise<AnalysisReport> => {
    emit({ type: "analysis_started", analysisId });
    const fixtureRoot = path.join(projectRoot, "fixtures", "notification-demo");
    const scenarios = await loadFrozenScenarios(path.join(fixtureRoot, "scenarios.json"));
    const modelName = process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL;
    const baseUrl = (process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const client = new OpenAiCompatibleClient({
      baseUrl,
      apiKey: requireOpenRouterApiKey(),
      model: modelName,
    }, {
      timeoutMs: resolveLiveLlmRequestTimeoutMs(process.env),
    });

    const startedScenarios = new Set<string>();
    const completedCandidates = new Map<string, Set<string>>();
    const execution = await runAnalysis({
      analysisId,
      baseRoot: path.join(fixtureRoot, "base"),
      candidates: {
        A: path.join(fixtureRoot, "candidate-a"),
        B: path.join(fixtureRoot, "candidate-b"),
      },
      scenarios,
      acceptanceDir: path.join(fixtureRoot, "acceptance"),
      runRoot: projectRoot,
      budget: { maxToolCalls: 35, maxTokens: 30_000, maxTestCycles: 8, timeoutMs: 180_000 },
      trialsByScenario: { "FR-01": 1, "FR-02": 1, "FR-03": 1, "FR-04": 3, "FR-05": 1 },
      concurrency: resolveAnalysisConcurrency(process.env),
    }, {
      client,
      modelName,
      onProgress(event) {
        if (!startedScenarios.has(event.scenarioId)) {
          startedScenarios.add(event.scenarioId);
          emit({ type: "scenario_started", analysisId, scenarioId: event.scenarioId });
        }
        emit({ type: event.type, analysisId, scenarioId: event.scenarioId, candidateId: event.candidateId });
        if (event.type === "candidate_completed") {
          const completed = completedCandidates.get(event.scenarioId) ?? new Set<string>();
          completed.add(event.candidateId);
          completedCandidates.set(event.scenarioId, completed);
          if (completed.size === 2) emit({ type: "scenario_completed", analysisId, scenarioId: event.scenarioId });
        }
      },
    });
    const report = buildAnalysisReport(analysisId, scenarios, execution);
    emit({ type: "analysis_completed", analysisId });
    return report;
  };
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({ logger: false });
  const projectRoot = options.projectRoot ?? repositoryRoot();
  const bus = new ProgressBus();
  server.get("/api/health", async () => ({ status: "ok" }));
  registerAnalysisRoutes(server, {
    projectRoot,
    bus,
    idFactory: options.idFactory ?? (() => crypto.randomUUID()),
    runDemo: options.runDemo ?? createDefaultRunner(projectRoot),
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = buildServer();
  const port = Number(process.env.PORT ?? 3001);
  await server.listen({ host: "0.0.0.0", port });
}
