import test from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../../apps/api/src/server.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const scenario = {
  id: "FR-01",
  title: "Add SMS shipment notifications",
  dimension: "breadth",
  requirement: "Support SMS shipment notifications as an alternative to email.",
  rationale: "adjacent channel",
  affectedCapability: "shipment notification delivery",
  difficulty: "medium",
  externalDependencies: false,
  provenance: ["current requirement"],
  acceptance: [{ name: "sms", given: "sms selected", when: "order ships", then: "sms is sent" }],
};

const baselineA = { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true };
const baselineB = { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true };

const report = {
  analysisId: "analysis-test",
  candidates: {
    A: {
      candidateId: "A",
      baseline: baselineA,
      dimensions: { resilienceRisk: 0, efficiencyRisk: 0, regressionRisk: 0, structuralRisk: 0, overallRisk: 0 },
      scenarioRuns: [],
      aggregatedScenarios: [{
        scenarioId: "FR-01", status: "SUCCESS", trialCount: 1,
        metrics: { toolCalls: 10, filesTouched: 2, editOps: 1, testRuns: 2, tokenUsage: 100, regressionArea: 0, failedRegressionSnapshots: 0, structuralDelta: { cyclomaticComplexity: 0, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 1 }, structuralMagnitude: 0.05 },
      }],
      averages: { toolCalls: 10, filesTouched: 2, regressionCycles: 0, tokenUsage: 100 },
    },
    B: {
      candidateId: "B",
      baseline: baselineB,
      dimensions: { resilienceRisk: 50, efficiencyRisk: 50, regressionRisk: 50, structuralRisk: 50, overallRisk: 50 },
      scenarioRuns: [],
      aggregatedScenarios: [{
        scenarioId: "FR-01", status: "PARTIAL", trialCount: 1,
        metrics: { toolCalls: 20, filesTouched: 5, editOps: 3, testRuns: 5, tokenUsage: 250, regressionArea: 3, failedRegressionSnapshots: 2, structuralDelta: { cyclomaticComplexity: 2, duplicateLineWindows: 0, dependencyFanOut: 1, fileSizeLines: 10 }, structuralMagnitude: 3.5 },
      }],
      averages: { toolCalls: 20, filesTouched: 5, regressionCycles: 2, tokenUsage: 250 },
    },
  },
  ratios: { toolCalls: 2, filesTouched: 2.5, regressionArea: null, tokenUsage: 2.5 },
  ratioLabels: { toolCalls: "2.00x", filesTouched: "2.50x", regressionArea: "not comparable", tokenUsage: "2.50x" },
  scenarios: [scenario],
} as any;

async function waitForCompleted(server: ReturnType<typeof buildServer>, id: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await server.inject({ method: "GET", url: `/api/analyses/${id}` });
    const body = response.json();
    if (body.status === "completed" || body.status === "failed") return body;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("analysis did not complete in test window");
}

test("POST starts demo-owned analysis, GET exposes running then completed report", async () => {
  const gate = deferred<any>();
  const server = buildServer({
    idFactory: () => "analysis-test",
    runDemo: async ({ emit }) => {
      emit({ type: "analysis_started", analysisId: "analysis-test" });
      const value = await gate.promise;
      emit({ type: "analysis_completed", analysisId: "analysis-test" });
      return value;
    },
  });
  try {
    const started = await server.inject({ method: "POST", url: "/api/analyses/demo", payload: {} });
    assert.equal(started.statusCode, 202);
    assert.deepEqual(started.json(), { analysisId: "analysis-test" });

    const running = await server.inject({ method: "GET", url: "/api/analyses/analysis-test" });
    assert.equal(running.statusCode, 200);
    assert.deepEqual(running.json(), { status: "running", analysisId: "analysis-test" });

    gate.resolve(report);
    const completed = await waitForCompleted(server, "analysis-test");
    assert.equal(completed.status, "completed");
    assert.equal(completed.report.analysisId, "analysis-test");
  } finally {
    await server.close();
  }
});

test("hackathon demo POST rejects browser-supplied filesystem paths", async () => {
  const server = buildServer({ idFactory: () => "analysis-path", runDemo: async () => report });
  try {
    const response = await server.inject({
      method: "POST",
      url: "/api/analyses/demo",
      payload: { candidateA: "/etc", candidateB: "/tmp/other" },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await server.close();
  }
});

test("completed scenario endpoint returns frozen requirement plus A/B evidence", async () => {
  const server = buildServer({ idFactory: () => "analysis-test", runDemo: async () => report });
  try {
    await server.inject({ method: "POST", url: "/api/analyses/demo", payload: {} });
    await waitForCompleted(server, "analysis-test");
    const response = await server.inject({ method: "GET", url: "/api/analyses/analysis-test/scenarios/FR-01" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.scenario.id, "FR-01");
    assert.equal(body.candidates.A.status, "SUCCESS");
    assert.equal(body.candidates.B.status, "PARTIAL");
  } finally {
    await server.close();
  }
});

test("completed events endpoint is valid finite SSE and contains analysis_completed", async () => {
  const server = buildServer({ idFactory: () => "analysis-test", runDemo: async ({ emit }) => {
    emit({ type: "analysis_started", analysisId: "analysis-test" });
    emit({ type: "analysis_completed", analysisId: "analysis-test" });
    return report;
  } });
  try {
    await server.inject({ method: "POST", url: "/api/analyses/demo", payload: {} });
    await waitForCompleted(server, "analysis-test");
    const response = await server.inject({ method: "GET", url: "/api/analyses/analysis-test/events" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /text\/event-stream/);
    assert.match(response.body, /analysis_completed/);
  } finally {
    await server.close();
  }
});

test("unknown analyses return 404", async () => {
  const server = buildServer({ idFactory: () => "unused", runDemo: async () => report });
  try {
    const response = await server.inject({ method: "GET", url: "/api/analyses/missing" });
    assert.equal(response.statusCode, 404);
  } finally {
    await server.close();
  }
});
