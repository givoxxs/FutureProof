import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentBudget, CandidateBaseline, FutureScenario, RunMetrics } from "@futureproof/core";
import type { AgentEvent } from "../../packages/engine/src/coding-agent.ts";
import type { ToolCallingLlmClient } from "../../packages/engine/src/llm-client.ts";
import { runAnalysis, type AnalysisRequest, type OrchestratorDeps } from "../../packages/engine/src/orchestrator.ts";

const fixture = path.resolve("fixtures/notification-demo");
const budget: AgentBudget = { maxToolCalls: 35, maxTokens: 30_000, maxTestCycles: 8, timeoutMs: 180_000 };
const fakeClient = {} as ToolCallingLlmClient;

function zeroMetrics(): RunMetrics {
  return {
    toolCalls: 2,
    readOps: 1,
    searchOps: 0,
    editOps: 0,
    testRuns: 1,
    tokenUsage: 20,
    wallTimeMs: 1,
    filesTouched: 0,
    modulesTouched: 0,
    locAdded: 0,
    locDeleted: 0,
    publicApiFilesTouched: 0,
    regressionSnapshots: [],
    structuralDelta: { cyclomaticComplexity: 0, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 0 },
  };
}

async function request(): Promise<AnalysisRequest> {
  const scenarios = JSON.parse(await fs.readFile(path.join(fixture, "scenarios.json"), "utf8")) as FutureScenario[];
  return {
    analysisId: "progress-analysis",
    baseRoot: path.join(fixture, "base"),
    candidates: { A: path.join(fixture, "candidate-a"), B: path.join(fixture, "candidate-b") },
    scenarios,
    acceptanceDir: path.join(fixture, "acceptance"),
    runRoot: await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-progress-")),
    budget,
    trialsByScenario: { "FR-01": 1, "FR-02": 1, "FR-03": 1, "FR-04": 3, "FR-05": 1 },
    concurrency: 2,
  };
}

test("parallel progress exposes observed agent activity and completes repeated scenarios only after every trial", async () => {
  const progress: any[] = [];
  let sequence = 0;
  const deps: OrchestratorDeps = {
    client: fakeClient,
    modelName: "progress-model",
    random: () => 0.5,
    onProgress(event) { progress.push(event); },
    async createSandbox(args) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `futureproof-progress-sb-${args.candidateId}-${sequence++}-`));
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "index.ts"), "export const ok = true;\n", "utf8");
      return { root, candidateId: args.candidateId, scenarioId: args.scenarioId, trial: args.trial };
    },
    async validateBaseline(sandbox): Promise<CandidateBaseline> {
      return { candidateId: sandbox.candidateId, testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true };
    },
    async injectAcceptanceTest(sandboxRoot, scenarioId) {
      return path.join(sandboxRoot, `${scenarioId}.test.ts`);
    },
    async runAgent(args) {
      const now = Date.now();
      await args.onEvent({ seq: 1, type: "model_turn", timestampMs: now, payload: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } satisfies AgentEvent);
      await args.onEvent({ seq: 2, type: "tool_call", tool: "read_file", timestampMs: now + 1, payload: { id: "read-1", arguments: { path: "src/index.ts" } } } satisfies AgentEvent);
      await args.onEvent({ seq: 3, type: "tool_call", tool: "run_command", timestampMs: now + 2, payload: { id: "test-1", arguments: { command: "pnpm test" } } } satisfies AgentEvent);
      return { stopReason: "completed" as const };
    },
    async finalCheck() {
      return { acceptancePassed: 2, acceptanceFailed: 0, existingPassed: 22, existingFailed: 0, buildPassed: true, remainingFailures: [] };
    },
    async collectMetrics() { return zeroMetrics(); },
  };

  await runAnalysis(await request(), deps);

  const activity = progress.filter((event) => event.type === "agent_activity");
  assert.ok(activity.some((event) => event.detail?.action === "thinking"));
  assert.ok(activity.some((event) => event.detail?.action === "reading" && event.trial === 1));
  assert.ok(activity.some((event) => event.detail?.action === "testing" && event.detail?.tool === "run_command"));
  assert.ok(activity.every((event) => event.candidateId && event.scenarioId && Number.isInteger(event.trial)));

  for (const scenarioId of ["FR-01", "FR-02", "FR-03", "FR-04", "FR-05"]) {
    assert.equal(progress.filter((event) => event.type === "scenario_started" && event.scenarioId === scenarioId).length, 1);
    assert.equal(progress.filter((event) => event.type === "scenario_completed" && event.scenarioId === scenarioId).length, 1);
  }

  const fr04CompletionIndex = progress.findIndex((event) => event.type === "scenario_completed" && event.scenarioId === "FR-04");
  const fr04CandidateCompletionsBefore = progress
    .slice(0, fr04CompletionIndex)
    .filter((event) => event.type === "candidate_completed" && event.scenarioId === "FR-04");
  assert.equal(fr04CandidateCompletionsBefore.length, 6);
});
