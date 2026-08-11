import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentBudget, CandidateBaseline, FutureScenario, RunMetrics } from "@futureproof/core";
import type { AgentEvent } from "../../packages/engine/src/coding-agent.ts";
import type { ToolCallingLlmClient } from "../../packages/engine/src/llm-client.ts";
import type { Sandbox } from "../../packages/engine/src/sandbox-manager.ts";
import { runAnalysis, type AnalysisRequest, type OrchestratorDeps } from "../../packages/engine/src/orchestrator.ts";

const fixture = path.resolve("fixtures/notification-demo");

async function loadScenarios(): Promise<FutureScenario[]> {
  return JSON.parse(await fs.readFile(path.join(fixture, "scenarios.json"), "utf8")) as FutureScenario[];
}

const budget: AgentBudget = { maxToolCalls: 35, maxTokens: 30_000, maxTestCycles: 8, timeoutMs: 180_000 };
const fakeClient = {} as ToolCallingLlmClient;

function zeroMetrics(): RunMetrics {
  return {
    toolCalls: 1,
    readOps: 0,
    searchOps: 0,
    editOps: 0,
    testRuns: 1,
    tokenUsage: 15,
    wallTimeMs: 10,
    filesTouched: 0,
    modulesTouched: 0,
    locAdded: 0,
    locDeleted: 0,
    publicApiFilesTouched: 0,
    regressionSnapshots: [],
    structuralDelta: { cyclomaticComplexity: 0, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 0 },
  };
}

async function makeRequest(): Promise<AnalysisRequest> {
  return {
    analysisId: "analysis-test",
    baseRoot: path.join(fixture, "base"),
    candidates: { A: path.join(fixture, "candidate-a"), B: path.join(fixture, "candidate-b") },
    scenarios: await loadScenarios(),
    acceptanceDir: path.join(fixture, "acceptance"),
    runRoot: await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-orchestrator-")),
    budget,
    trialsByScenario: { "FR-01": 1, "FR-02": 1, "FR-03": 1, "FR-04": 1, "FR-05": 1 },
    concurrency: 1,
  };
}

function makeDeps(options: { invalidB?: boolean } = {}) {
  const sandboxRoots: string[] = [];
  const agentCalls: Array<{ candidateId: string; scenarioId: string; budget: AgentBudget; client: ToolCallingLlmClient }> = [];
  const injections: Array<{ candidateId: string; scenarioId: string; bytes: string }> = [];
  const progressEvents: Array<{ type: string; candidateId?: string; scenarioId: string }> = [];
  let sandboxSeq = 0;
  const randomValues = [0.91, 0.17, 0.73, 0.31, 0.55];
  let randomIndex = 0;

  const deps: OrchestratorDeps = {
    client: fakeClient,
    modelName: "fake-model",
    random: () => randomValues[randomIndex++ % randomValues.length]!,
    onProgress(event) { progressEvents.push(event); },
    async createSandbox(args) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `futureproof-orch-sb-${args.candidateId}-${sandboxSeq++}-`));
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "index.ts"), "export const fixture = true;\n", "utf8");
      sandboxRoots.push(root);
      return { root, candidateId: args.candidateId, scenarioId: args.scenarioId, trial: args.trial };
    },
    async validateBaseline(sandbox): Promise<CandidateBaseline> {
      const invalid = options.invalidB === true && sandbox.candidateId === "B";
      return { candidateId: sandbox.candidateId, testsPassed: invalid ? 20 : 22, testsFailed: invalid ? 2 : 0, buildPassed: !invalid, valid: !invalid };
    },
    async injectAcceptanceTest(sandboxRoot, scenarioId, sourceFile) {
      const bytes = await fs.readFile(sourceFile, "utf8");
      const owner = sandboxRoot.includes("-A-") ? "A" : sandboxRoot.includes("-B-") ? "B" : "";
      injections.push({ candidateId: owner, scenarioId, bytes });
      return path.join(sandboxRoot, "test", "futureproof", `${scenarioId}.test.ts`);
    },
    async runAgent(args) {
      agentCalls.push({ candidateId: args.sandbox.candidateId, scenarioId: args.scenario.id, budget: args.budget, client: args.client });
      await args.onEvent({ seq: 1, type: "model_turn", timestampMs: Date.now(), payload: { inputTokens: 10, outputTokens: 5 } } satisfies AgentEvent);
      return { stopReason: "completed" as const };
    },
    async finalCheck() {
      return { acceptancePassed: 2, acceptanceFailed: 0, existingPassed: 22, existingFailed: 0, buildPassed: true, remainingFailures: [] };
    },
    async collectMetrics() { return zeroMetrics(); },
  };

  return { deps, sandboxRoots, agentCalls, injections, progressEvents };
}

test("uses one shuffled scenario order fairly across both candidates and persists complete artifacts", async () => {
  const request = await makeRequest();
  const { deps, sandboxRoots, agentCalls, injections, progressEvents } = makeDeps();
  const execution = await runAnalysis(request, deps);

  assert.equal(execution.runs.length, 10);
  assert.ok(execution.runs.every((run) => run.status === "SUCCESS"));
  const orderA = agentCalls.filter((call) => call.candidateId === "A").map((call) => call.scenarioId);
  const orderB = agentCalls.filter((call) => call.candidateId === "B").map((call) => call.scenarioId);
  assert.deepEqual(orderA, orderB);
  assert.notDeepEqual(orderA, request.scenarios.map((scenario) => scenario.id));
  assert.ok(agentCalls.every((call) => call.client === fakeClient));
  assert.ok(agentCalls.every((call) => JSON.stringify(call.budget) === JSON.stringify(budget)));
  assert.equal(new Set(sandboxRoots).size, sandboxRoots.length);
  assert.equal(progressEvents.filter((event) => event.type === "candidate_started").length, 10);
  assert.equal(progressEvents.filter((event) => event.type === "candidate_completed").length, 10);
  for (const candidateId of ["A", "B"] as const) {
    for (const scenarioId of orderA) {
      assert.ok(progressEvents.some((event) => event.type === "candidate_started" && event.candidateId === candidateId && event.scenarioId === scenarioId));
      assert.ok(progressEvents.some((event) => event.type === "candidate_completed" && event.candidateId === candidateId && event.scenarioId === scenarioId));
    }
  }
  for (const scenario of request.scenarios) {
    const injectedA = injections.find((item) => item.candidateId === "A" && item.scenarioId === scenario.id);
    const injectedB = injections.find((item) => item.candidateId === "B" && item.scenarioId === scenario.id);
    assert.ok(injectedA && injectedB);
    assert.equal(injectedA.bytes, injectedB.bytes);
  }

  for (const scenario of request.scenarios) {
    const runA = execution.runs.find((run) => run.candidateId === "A" && run.scenarioId === scenario.id)!;
    const runB = execution.runs.find((run) => run.candidateId === "B" && run.scenarioId === scenario.id)!;
    const metadataA = JSON.parse(await fs.readFile(path.join(runA.artifactDir, "metadata.json"), "utf8"));
    const metadataB = JSON.parse(await fs.readFile(path.join(runB.artifactDir, "metadata.json"), "utf8"));
    assert.equal(metadataA.scenarioHash, metadataB.scenarioHash);
    for (const run of [runA, runB]) {
      assert.ok(run.artifactDir.startsWith(path.join(request.runRoot, ".futureproof", "runs", request.analysisId)));
      for (const file of ["metadata.json", "tool-events.jsonl", "test-results.json", "patch.diff", "metrics.json", "summary.json"]) {
        await fs.access(path.join(run.artifactDir, file));
      }
    }
  }
});

test("bounded concurrency two runs paired A/B work in parallel and returns logical pair order", async () => {
  const request = await makeRequest();
  request.concurrency = 2;
  const { deps } = makeDeps();
  const starts: Array<{ candidateId: string; scenarioId: string; trial: number }> = [];
  let active = 0;
  let maxActive = 0;

  deps.runAgent = async (args) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    starts.push({ candidateId: args.sandbox.candidateId, scenarioId: args.scenario.id, trial: args.sandbox.trial });
    await new Promise((resolve) => setTimeout(resolve, args.sandbox.candidateId === "A" ? 25 : 5));
    active -= 1;
    return { stopReason: "completed" as const };
  };

  const execution = await runAnalysis(request, deps);

  assert.equal(maxActive, 2);
  assert.equal(starts[0]?.scenarioId, starts[1]?.scenarioId);
  assert.equal(starts[0]?.trial, starts[1]?.trial);
  assert.deepEqual(new Set(starts.slice(0, 2).map((item) => item.candidateId)), new Set(["A", "B"]));

  for (let index = 0; index < execution.runs.length; index += 2) {
    const runA = execution.runs[index]!;
    const runB = execution.runs[index + 1]!;
    assert.equal(runA.candidateId, "A");
    assert.equal(runB.candidateId, "B");
    assert.equal(runA.scenarioId, runB.scenarioId);
    assert.equal(runA.trial, runB.trial);
  }
});

test("concurrency one preserves strictly sequential execution", async () => {
  const request = await makeRequest();
  request.concurrency = 1;
  const { deps } = makeDeps();
  let active = 0;
  let maxActive = 0;

  deps.runAgent = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return { stopReason: "completed" as const };
  };

  await runAnalysis(request, deps);
  assert.equal(maxActive, 1);
});

test("invalid candidate baseline emits INVALID runs and skips its agent executions", async () => {
  const request = await makeRequest();
  const { deps, agentCalls } = makeDeps({ invalidB: true });
  const execution = await runAnalysis(request, deps);

  assert.equal(execution.baselines.B.valid, false);
  assert.equal(agentCalls.some((call) => call.candidateId === "B"), false);
  const invalidB = execution.runs.filter((run) => run.candidateId === "B");
  assert.equal(invalidB.length, 5);
  assert.ok(invalidB.every((run) => run.status === "INVALID"));
});

test("final check uses only the pnpm command policy", async () => {
  const source = await fs.readFile(path.resolve("packages/engine/src/orchestrator.ts"), "utf8");
  assert.doesNotMatch(source, /"npm test"|"npm run build"/);
  assert.match(source, /"pnpm test"/);
  assert.match(source, /"pnpm run build"/);
});