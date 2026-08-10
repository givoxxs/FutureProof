import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { buildAnalysisReport, type AnalysisReport } from "../../../packages/engine/src/compare.ts";
import { OpenAiCompatibleClient } from "../../../packages/engine/src/llm-client.ts";
import { runAnalysis } from "../../../packages/engine/src/orchestrator.ts";
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

function requireEnv(name: "LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to run the live demo`);
  return value;
}

function createDefaultRunner(projectRoot: string): DemoAnalysisRunner {
  return async ({ analysisId, emit }): Promise<AnalysisReport> => {
    emit({ type: "analysis_started", analysisId });
    const fixtureRoot = path.join(projectRoot, "fixtures", "notification-demo");
    const scenarios = await loadFrozenScenarios(path.join(fixtureRoot, "scenarios.json"));
    const modelName = requireEnv("LLM_MODEL");
    const client = new OpenAiCompatibleClient({
      baseUrl: requireEnv("LLM_BASE_URL"),
      apiKey: requireEnv("LLM_API_KEY"),
      model: modelName,
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
