import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentBudget,
  AnalysisExecution,
  CandidateBaseline,
  CandidateId,
  FutureScenario,
  RegressionSnapshot,
  RunMetrics,
  ScenarioRunSummary,
  ScenarioStatus,
} from "@futureproof/core";
import { appendJsonl, writeJson } from "@futureproof/core/artifacts";
import { analysisArtifactDir } from "@futureproof/core/paths";
import { injectAcceptanceTest as injectAcceptanceTestDefault } from "./acceptance-injector.ts";
import { runCodingAgent, type AgentEvent, type AgentStopReason } from "./coding-agent.ts";
import { runAllowedCommand } from "./command-runner.ts";
import type { ToolCallingLlmClient } from "./llm-client.ts";
import { collectRunMetrics as collectRunMetricsDefault } from "./metrics.ts";
import { parseNodeTestCounts } from "./regression-probe.ts";
import { createSandbox as createSandboxDefault, validateBaseline as validateBaselineDefault, type Sandbox } from "./sandbox-manager.ts";
import { validateScenarioSet } from "./scenario-validator.ts";

export interface AnalysisRequest {
  analysisId: string;
  baseRoot: string;
  candidates: Record<CandidateId, string>;
  scenarios: FutureScenario[];
  acceptanceDir: string;
  runRoot: string;
  budget: AgentBudget;
  trialsByScenario: Record<string, number>;
}

export interface FinalCheckResult {
  acceptancePassed: number;
  acceptanceFailed: number;
  existingPassed: number;
  existingFailed: number;
  buildPassed: boolean;
  remainingFailures: string[];
}

type CreateSandbox = typeof createSandboxDefault;
type ValidateBaseline = typeof validateBaselineDefault;
type InjectAcceptance = typeof injectAcceptanceTestDefault;
type RunAgent = typeof runCodingAgent;
type CollectMetrics = typeof collectRunMetricsDefault;

export interface OrchestratorProgressEvent {
  type: "candidate_started" | "candidate_completed";
  candidateId: CandidateId;
  scenarioId: string;
}

export interface OrchestratorDeps {
  client: ToolCallingLlmClient;
  modelName: string;
  random?: () => number;
  onProgress?: (event: OrchestratorProgressEvent) => void;
  createSandbox?: CreateSandbox;
  validateBaseline?: ValidateBaseline;
  injectAcceptanceTest?: InjectAcceptance;
  runAgent?: RunAgent;
  finalCheck?: (sandbox: Sandbox, scenario: FutureScenario) => Promise<FinalCheckResult>;
  collectMetrics?: CollectMetrics;
}

const CANDIDATES: CandidateId[] = ["A", "B"];

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const j = Math.floor(random() * (index + 1));
    [result[index], result[j]] = [result[j]!, result[index]!];
  }
  return result;
}

function emptyMetrics(): RunMetrics {
  return {
    toolCalls: 0,
    readOps: 0,
    searchOps: 0,
    editOps: 0,
    testRuns: 0,
    tokenUsage: 0,
    wallTimeMs: 0,
    filesTouched: 0,
    modulesTouched: 0,
    locAdded: 0,
    locDeleted: 0,
    publicApiFilesTouched: 0,
    regressionSnapshots: [],
    structuralDelta: null,
  };
}

async function readRegressionSnapshots(sandbox: Sandbox): Promise<RegressionSnapshot[]> {
  const file = path.join(sandbox.root, ".futureproof", "regression-snapshots.jsonl");
  try {
    const text = await fs.readFile(file, "utf8");
    return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line) as RegressionSnapshot) : [];
  } catch {
    return [];
  }
}

async function readSandboxWarnings(sandbox: Sandbox): Promise<unknown[]> {
  const file = path.join(sandbox.root, ".futureproof", "metadata.json");
  try {
    const metadata = JSON.parse(await fs.readFile(file, "utf8")) as { warnings?: unknown[] };
    return Array.isArray(metadata.warnings) ? metadata.warnings : [];
  } catch {
    return [];
  }
}

function tokenUsage(events: AgentEvent[]): number {
  let max = 0;
  for (const event of events) {
    if (event.type !== "model_turn") continue;
    const total = event.payload.totalTokens;
    if (typeof total === "number" && Number.isFinite(total)) max = Math.max(max, total);
    else {
      const input = typeof event.payload.inputTokens === "number" ? event.payload.inputTokens : 0;
      const output = typeof event.payload.outputTokens === "number" ? event.payload.outputTokens : 0;
      max += input + output;
    }
  }
  return max;
}

function mapStatus(check: FinalCheckResult, stopReason: AgentStopReason): ScenarioStatus {
  if (check.acceptanceFailed === 0 && check.existingFailed === 0 && check.buildPassed) return "SUCCESS";
  if (check.acceptancePassed > 0 && check.acceptanceFailed > 0 && check.existingFailed === 0 && check.buildPassed) return "PARTIAL";
  if (stopReason === "tool_budget" || stopReason === "token_budget" || stopReason === "timeout") return "BUDGET_EXHAUSTED";
  if (!check.buildPassed) return "BUILD_BROKEN";
  return "FAIL";
}

async function defaultFinalCheck(sandbox: Sandbox, scenario: FutureScenario): Promise<FinalCheckResult> {
  const test = await runAllowedCommand(sandbox.root, "pnpm test", 30_000);
  const output = `${test.stdout}\n${test.stderr}`;
  const totals = parseNodeTestCounts(output);
  if (!totals) throw new Error(`final test totals unavailable for ${scenario.id}`);

  let acceptancePassed = 0;
  let acceptanceFailed = 0;
  const remainingFailures: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^(ok|not ok)\s+\d+\s+-\s+(.+)$/.exec(line);
    if (!match) continue;
    const passed = match[1] === "ok";
    const title = match[2] ?? "";
    if (title.startsWith(scenario.id)) {
      if (passed) acceptancePassed += 1;
      else acceptanceFailed += 1;
    } else if (!passed) {
      remainingFailures.push(title);
    }
  }

  if (acceptancePassed + acceptanceFailed === 0 && test.exitCode !== 0) {
    acceptanceFailed = Math.max(1, scenario.acceptance.length);
  }
  const acceptanceFailuresCountedByRunner = Math.min(totals.failed, acceptanceFailed);
  const acceptancePassesCountedByRunner = Math.min(totals.passed, acceptancePassed);
  const existingFailed = Math.max(0, totals.failed - acceptanceFailuresCountedByRunner);
  const existingPassed = Math.max(0, totals.passed - acceptancePassesCountedByRunner);
  const build = await runAllowedCommand(sandbox.root, "pnpm run build", 30_000);

  return {
    acceptancePassed,
    acceptanceFailed,
    existingPassed,
    existingFailed,
    buildPassed: build.exitCode === 0,
    remainingFailures,
  };
}

async function listPatchFiles(root: string, relative = "."): Promise<string[]> {
  const ignored = new Set([".git", "node_modules", ".futureproof", "dist"]);
  const absolute = path.join(root, relative);
  let entries;
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
    const rel = path.join(relative, entry.name).replace(/^\.\//, "").split(path.sep).join("/");
    if (entry.isDirectory()) files.push(...await listPatchFiles(root, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

async function optionalText(root: string, relative: string): Promise<string | null> {
  try { return await fs.readFile(path.join(root, relative), "utf8"); } catch { return null; }
}

async function buildPatchDiff(beforeRoot: string, afterRoot: string): Promise<string> {
  const files = [...new Set([...await listPatchFiles(beforeRoot), ...await listPatchFiles(afterRoot)])].sort();
  const chunks: string[] = [];
  for (const file of files) {
    const [before, after] = await Promise.all([optionalText(beforeRoot, file), optionalText(afterRoot, file)]);
    if (before === after) continue;
    chunks.push(`--- a/${file}\n+++ b/${file}\n@@ whole-file @@\n${(before ?? "").split(/\r?\n/).filter(Boolean).map((line) => `-${line}`).join("\n")}\n${(after ?? "").split(/\r?\n/).filter(Boolean).map((line) => `+${line}`).join("\n")}\n`);
  }
  return chunks.join("\n");
}

function artifactDirFor(request: AnalysisRequest, candidateId: CandidateId, scenarioId: string, trial: number): string {
  return path.join(analysisArtifactDir(request.runRoot, request.analysisId), candidateId, scenarioId, `trial-${trial}`);
}

function sandboxRunRoot(request: AnalysisRequest): string {
  return path.join(request.runRoot, ".futureproof", "workspaces");
}

async function persistInvalidRun(args: {
  request: AnalysisRequest;
  candidateId: CandidateId;
  scenario: FutureScenario;
  trial: number;
  baseline: CandidateBaseline;
  modelName: string;
}): Promise<ScenarioRunSummary> {
  const artifactDir = artifactDirFor(args.request, args.candidateId, args.scenario.id, args.trial);
  await fs.mkdir(artifactDir, { recursive: true });
  const patchPath = path.join(artifactDir, "patch.diff");
  const metrics = emptyMetrics();
  const summary: ScenarioRunSummary = {
    analysisId: args.request.analysisId,
    candidateId: args.candidateId,
    scenarioId: args.scenario.id,
    trial: args.trial,
    status: "INVALID",
    acceptancePassed: 0,
    acceptanceFailed: 0,
    existingPassed: args.baseline.testsPassed,
    existingFailed: args.baseline.testsFailed,
    buildPassed: args.baseline.buildPassed,
    metrics,
    remainingFailures: ["candidate baseline is invalid"],
    patchPath,
    artifactDir,
  };
  await writeJson(path.join(artifactDir, "metadata.json"), {
    analysisId: args.request.analysisId,
    candidateId: args.candidateId,
    scenarioId: args.scenario.id,
    scenarioHash: sha256(JSON.stringify(args.scenario)),
    trial: args.trial,
    modelName: args.modelName,
    budget: args.request.budget,
    sourcePathHash: sha256(path.resolve(args.request.candidates[args.candidateId])),
    invalidReason: "baseline",
    timestamps: { createdAtMs: Date.now() },
  });
  await fs.writeFile(path.join(artifactDir, "tool-events.jsonl"), "", "utf8");
  await writeJson(path.join(artifactDir, "test-results.json"), { baseline: args.baseline });
  await fs.writeFile(patchPath, "", "utf8");
  await writeJson(path.join(artifactDir, "metrics.json"), metrics);
  await writeJson(path.join(artifactDir, "summary.json"), summary);
  return summary;
}

export async function runAnalysis(request: AnalysisRequest, deps: OrchestratorDeps): Promise<AnalysisExecution> {
  const scenarios = validateScenarioSet(request.scenarios);
  const random = deps.random ?? Math.random;
  const scenarioOrder = shuffle(scenarios, random);
  const createSandbox = deps.createSandbox ?? createSandboxDefault;
  const validateBaseline = deps.validateBaseline ?? validateBaselineDefault;
  const injectAcceptanceTest = deps.injectAcceptanceTest ?? injectAcceptanceTestDefault;
  const runAgent = deps.runAgent ?? runCodingAgent;
  const finalCheck = deps.finalCheck ?? defaultFinalCheck;
  const collectMetrics = deps.collectMetrics ?? collectRunMetricsDefault;
  const baselines = {} as Record<CandidateId, CandidateBaseline>;
  const runs: ScenarioRunSummary[] = [];

  for (const candidateId of CANDIDATES) {
    const sandbox = await createSandbox({
      sourceRoot: request.candidates[candidateId],
      runRoot: sandboxRunRoot(request),
      analysisId: request.analysisId,
      candidateId,
      scenarioId: "__baseline__",
      trial: 1,
    });
    try {
      baselines[candidateId] = await validateBaseline(sandbox);
    } finally {
      await fs.rm(sandbox.root, { recursive: true, force: true });
    }
  }

  for (const candidateId of CANDIDATES) {
    const candidateBaseline = baselines[candidateId];
    for (const scenario of scenarioOrder) {
      const trials = request.trialsByScenario[scenario.id] ?? 1;
      if (!Number.isInteger(trials) || trials < 1) throw new Error(`invalid trial count for ${scenario.id}`);
      deps.onProgress?.({ type: "candidate_started", candidateId, scenarioId: scenario.id });
      for (let trial = 1; trial <= trials; trial += 1) {
        if (!candidateBaseline.valid) {
          runs.push(await persistInvalidRun({ request, candidateId, scenario, trial, baseline: candidateBaseline, modelName: deps.modelName }));
          continue;
        }

        const sourceRoot = request.candidates[candidateId];
        const sandbox = await createSandbox({
          sourceRoot,
          runRoot: sandboxRunRoot(request),
          analysisId: request.analysisId,
          candidateId,
          scenarioId: scenario.id,
          trial,
        });
        const artifactDir = artifactDirFor(request, candidateId, scenario.id, trial);
        await fs.mkdir(artifactDir, { recursive: true });
        const toolEventFile = path.join(artifactDir, "tool-events.jsonl");
        await fs.writeFile(toolEventFile, "", "utf8");
        const startedAtMs = Date.now();

        try {
          const runBaseline = await validateBaseline(sandbox);
          if (!runBaseline.valid) {
            runs.push(await persistInvalidRun({ request, candidateId, scenario, trial, baseline: runBaseline, modelName: deps.modelName }));
            continue;
          }

          const sourceAcceptance = path.join(request.acceptanceDir, `${scenario.id}.test.ts`);
          await injectAcceptanceTest(sandbox.root, scenario.id, sourceAcceptance);
          const events: AgentEvent[] = [];
          const stop = await runAgent({
            sandbox,
            scenario,
            budget: request.budget,
            client: deps.client,
            onEvent: async (event) => {
              events.push(event);
              await appendJsonl(toolEventFile, event);
            },
          });
          const check = await finalCheck(sandbox, scenario);
          const regressionSnapshots = await readRegressionSnapshots(sandbox);
          const metrics = await collectMetrics({
            sandbox,
            baselineRoot: sourceRoot,
            events,
            regressionSnapshots,
            wallTimeMs: Date.now() - startedAtMs,
            tokenUsage: tokenUsage(events),
          });
          const patchPath = path.join(artifactDir, "patch.diff");
          await fs.writeFile(patchPath, await buildPatchDiff(sourceRoot, sandbox.root), "utf8");
          const warnings = await readSandboxWarnings(sandbox);
          const status = mapStatus(check, stop.stopReason);
          const summary: ScenarioRunSummary = {
            analysisId: request.analysisId,
            candidateId,
            scenarioId: scenario.id,
            trial,
            status,
            acceptancePassed: check.acceptancePassed,
            acceptanceFailed: check.acceptanceFailed,
            existingPassed: check.existingPassed,
            existingFailed: check.existingFailed,
            buildPassed: check.buildPassed,
            metrics,
            remainingFailures: check.remainingFailures,
            patchPath,
            artifactDir,
          };
          await writeJson(path.join(artifactDir, "metadata.json"), {
            analysisId: request.analysisId,
            candidateId,
            scenarioId: scenario.id,
            scenarioHash: sha256(JSON.stringify(scenario)),
            trial,
            modelName: deps.modelName,
            budget: request.budget,
            sourcePathHash: sha256(path.resolve(sourceRoot)),
            basePathHash: sha256(path.resolve(request.baseRoot)),
            warnings,
            timestamps: { startedAtMs, finishedAtMs: Date.now() },
          });
          await writeJson(path.join(artifactDir, "test-results.json"), check);
          await writeJson(path.join(artifactDir, "metrics.json"), metrics);
          await writeJson(path.join(artifactDir, "summary.json"), summary);
          runs.push(summary);
        } finally {
          await fs.rm(sandbox.root, { recursive: true, force: true });
        }
      }
      deps.onProgress?.({ type: "candidate_completed", candidateId, scenarioId: scenario.id });
    }
  }

  return { baselines, runs };
}