import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentBudget, CandidateBaseline, FutureScenario, RunMetrics } from "@futureproof/core";
import type { AgentEvent } from "../../packages/engine/src/coding-agent.ts";
import { buildAnalysisReport } from "../../packages/engine/src/compare.ts";
import type { ToolCallingLlmClient } from "../../packages/engine/src/llm-client.ts";
import { runAnalysis, type AnalysisRequest, type OrchestratorDeps } from "../../packages/engine/src/orchestrator.ts";
import { writeReportBundle } from "../../packages/engine/src/report-export.ts";

const fixture = path.resolve("fixtures/notification-demo");
const fakeClient = {} as ToolCallingLlmClient;
const budget: AgentBudget = { maxToolCalls: 35, maxTokens: 30_000, maxTestCycles: 8, timeoutMs: 180_000 };

async function scenarios(): Promise<FutureScenario[]> {
  return JSON.parse(await fs.readFile(path.join(fixture, "scenarios.json"), "utf8")) as FutureScenario[];
}

function metricsFor(candidateId: "A" | "B", scenarioId: string): RunMetrics {
  const hard = scenarioId === "FR-04";
  const candidateB = candidateId === "B";
  return {
    toolCalls: candidateB ? (hard ? 35 : 24) : (hard ? 12 : 10),
    readOps: candidateB ? 8 : 3,
    searchOps: candidateB ? 4 : 1,
    editOps: candidateB ? (hard ? 7 : 4) : 2,
    testRuns: candidateB ? (hard ? 8 : 4) : 2,
    tokenUsage: candidateB ? (hard ? 31_000 : 22_000) : (hard ? 11_500 : 9_500),
    wallTimeMs: candidateB ? 2500 : 1000,
    filesTouched: candidateB ? (hard ? 12 : 8) : 3,
    modulesTouched: candidateB ? 4 : 2,
    locAdded: candidateB ? 150 : 60,
    locDeleted: candidateB ? 35 : 8,
    publicApiFilesTouched: candidateB && hard ? 1 : 0,
    regressionSnapshots: candidateB
      ? [{ cycle: 1, passed: hard ? 17 : 20, failed: hard ? 7 : 4, timestampMs: 1 }]
      : [{ cycle: 1, passed: 23, failed: 1, timestampMs: 1 }],
    structuralDelta: {
      cyclomaticComplexity: candidateB ? (hard ? 12 : 7) : 2,
      duplicateLineWindows: candidateB && hard ? 1 : 0,
      dependencyFanOut: candidateB ? 1 : 0,
      fileSizeLines: candidateB ? (hard ? 14 : 8) : 2,
    },
  };
}

async function request(runRoot: string): Promise<AnalysisRequest> {
  return {
    analysisId: "golden-analysis",
    baseRoot: path.join(fixture, "base"),
    candidates: { A: path.join(fixture, "candidate-a"), B: path.join(fixture, "candidate-b") },
    scenarios: await scenarios(),
    acceptanceDir: path.join(fixture, "acceptance"),
    runRoot,
    budget,
    trialsByScenario: { "FR-01": 1, "FR-02": 1, "FR-03": 1, "FR-04": 3, "FR-05": 1 },
  };
}

function deps(): OrchestratorDeps {
  let sequence = 0;
  return {
    client: fakeClient,
    modelName: "deterministic-golden-agent",
    random: () => 0.42,
    async createSandbox(args) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `futureproof-golden-${args.candidateId}-${sequence++}-`));
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "index.ts"), `export const candidate = ${JSON.stringify(args.candidateId)};\n`, "utf8");
      return { root, candidateId: args.candidateId, scenarioId: args.scenarioId, trial: args.trial };
    },
    async validateBaseline(sandbox): Promise<CandidateBaseline> {
      return { candidateId: sandbox.candidateId, testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true };
    },
    async injectAcceptanceTest(sandboxRoot, scenarioId) {
      const destination = path.join(sandboxRoot, "test", "futureproof", `${scenarioId}.test.ts`);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, `// frozen ${scenarioId}\n`, "utf8");
      return destination;
    },
    async runAgent(args) {
      await args.onEvent({
        seq: 1,
        type: "model_turn",
        timestampMs: 1,
        payload: { inputTokens: args.sandbox.candidateId === "B" ? 20_000 : 8_000, outputTokens: 1_000 },
      } satisfies AgentEvent);
      return { stopReason: "completed" as const };
    },
    async finalCheck(sandbox, scenario) {
      if (sandbox.candidateId === "B" && scenario.id === "FR-04") {
        return { acceptancePassed: 0, acceptanceFailed: 2, existingPassed: 22, existingFailed: 0, buildPassed: true, remainingFailures: ["FR-04 fallback remains coupled"] };
      }
      if (sandbox.candidateId === "B" && scenario.id === "FR-03") {
        return { acceptancePassed: 1, acceptanceFailed: 1, existingPassed: 22, existingFailed: 0, buildPassed: true, remainingFailures: ["FR-03 retry edge case"] };
      }
      return { acceptancePassed: 2, acceptanceFailed: 0, existingPassed: 22, existingFailed: 0, buildPassed: true, remainingFailures: [] };
    },
    async collectMetrics(args) {
      return metricsFor(args.sandbox.candidateId, args.sandbox.scenarioId);
    },
  };
}

test("golden pipeline runs 5 frozen scenarios with repeated hard trials, scores A/B, and exports reproducible evidence", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-golden-run-"));
  const analysisRequest = await request(runRoot);
  const execution = await runAnalysis(analysisRequest, deps());

  assert.equal(execution.runs.length, 14);
  assert.equal(execution.runs.filter((run) => run.scenarioId === "FR-04" && run.candidateId === "A").length, 3);
  assert.equal(execution.runs.filter((run) => run.scenarioId === "FR-04" && run.candidateId === "B").length, 3);
  assert.deepEqual(execution.runs.filter((run) => run.scenarioId === "FR-04" && run.candidateId === "B").map((run) => run.trial).sort(), [1, 2, 3]);

  const report = buildAnalysisReport(analysisRequest.analysisId, analysisRequest.scenarios, execution);
  assert.equal(report.scenarios.length, 5);
  assert.equal(report.candidates.A.scenarioRuns.length, 7);
  assert.equal(report.candidates.B.scenarioRuns.length, 7);
  assert.equal(report.candidates.A.aggregatedScenarios.find((item) => item.scenarioId === "FR-04")?.trialCount, 3);
  assert.equal(report.candidates.B.aggregatedScenarios.find((item) => item.scenarioId === "FR-04")?.status, "FAIL");
  assert.ok(report.candidates.B.dimensions.overallRisk > report.candidates.A.dimensions.overallRisk);
  assert.ok((report.ratios.toolCalls ?? 0) > 1);

  for (const run of execution.runs) {
    for (const filename of ["metadata.json", "tool-events.jsonl", "test-results.json", "patch.diff", "metrics.json", "summary.json"]) {
      await fs.access(path.join(run.artifactDir, filename));
    }
  }

  const bundle = await writeReportBundle(runRoot, report);
  const [jsonText, markdown, manifestText] = await Promise.all([
    fs.readFile(bundle.files.report, "utf8"),
    fs.readFile(bundle.files.markdown, "utf8"),
    fs.readFile(bundle.files.manifest, "utf8"),
  ]);
  const exported = JSON.parse(jsonText);
  const manifest = JSON.parse(manifestText);

  assert.equal(exported.analysisId, "golden-analysis");
  assert.equal(exported.scenarios.length, 5);
  assert.equal(jsonText.includes("patchPath"), false);
  assert.equal(jsonText.includes("artifactDir"), false);
  assert.match(markdown, /Candidate A/);
  assert.match(markdown, /Candidate B/);
  assert.match(markdown, /Provider Fallback/);
  assert.match(markdown, /3 trials/);
  assert.match(manifest.reportSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.markdownSha256, /^[a-f0-9]{64}$/);
});
