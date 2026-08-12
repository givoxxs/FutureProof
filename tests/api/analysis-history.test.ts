import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../../apps/api/src/server.ts";
import { AnalysisRepository } from "../../apps/api/src/analysis-repository.ts";

async function tempRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-api-history-"));
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

function aggregate(candidateId: "A" | "B") {
  return {
    scenarioId: "FR-01",
    status: "SUCCESS",
    trialCount: 1,
    metrics: {
      toolCalls: candidateId === "A" ? 10 : 20,
      filesTouched: candidateId === "A" ? 2 : 5,
      editOps: 1,
      testRuns: 2,
      tokenUsage: candidateId === "A" ? 100 : 250,
      regressionArea: 0,
      failedRegressionSnapshots: 0,
      structuralDelta: { cyclomaticComplexity: 0, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 1 },
      structuralMagnitude: 0.05,
    },
  };
}

function report(analysisId: string) {
  return {
    analysisId,
    candidates: {
      A: {
        candidateId: "A",
        baseline: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
        dimensions: { resilienceRisk: 0, efficiencyRisk: 0, regressionRisk: 0, structuralRisk: 10, overallRisk: 33 },
        scenarioRuns: [], aggregatedScenarios: [aggregate("A")],
        averages: { toolCalls: 10, filesTouched: 2, regressionCycles: 0, tokenUsage: 100 },
      },
      B: {
        candidateId: "B",
        baseline: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
        dimensions: { resilienceRisk: 0, efficiencyRisk: 0, regressionRisk: 0, structuralRisk: 0, overallRisk: 1 },
        scenarioRuns: [], aggregatedScenarios: [aggregate("B")],
        averages: { toolCalls: 20, filesTouched: 5, regressionCycles: 0, tokenUsage: 250 },
      },
    },
    ratios: { toolCalls: 2, filesTouched: 2.5, regressionArea: null, tokenUsage: 2.5 },
    ratioLabels: { toolCalls: "2.00x", filesTouched: "2.50x", regressionArea: "not comparable", tokenUsage: "2.50x" },
    scenarios: [scenario],
  } as any;
}

async function waitForTerminal(server: ReturnType<typeof buildServer>, id: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const response = await server.inject({ method: "GET", url: `/api/analyses/${id}` });
    if (response.statusCode === 200) {
      const body = response.json();
      if (["completed", "failed", "interrupted"].includes(body.status)) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("analysis did not reach terminal state");
}

test("completed analysis is listed and rehydrates after API reconstruction", async () => {
  const root = await tempRoot();
  const first = buildServer({
    projectRoot: root,
    idFactory: () => "history-run-1",
    runDemo: async ({ emit }) => {
      emit({ type: "analysis_started", analysisId: "history-run-1", detail: { provider: "OpenRouter", model: "model-history", concurrency: 2, requestTimeoutMs: 90_000 } });
      return report("history-run-1");
    },
  });

  try {
    const started = await first.inject({ method: "POST", url: "/api/analyses/demo", payload: {} });
    assert.equal(started.statusCode, 202);
    await waitForTerminal(first, "history-run-1");

    const list = await first.inject({ method: "GET", url: "/api/analyses" });
    assert.equal(list.statusCode, 200);
    const listed = list.json().analyses;
    assert.equal(listed[0].analysisId, "history-run-1");
    assert.equal(listed[0].status, "completed");
    assert.deepEqual(listed[0].candidateRisk, { A: 33, B: 1 });
    assert.equal(listed[0].model, "model-history");
  } finally {
    await first.close();
  }

  const second = buildServer({ projectRoot: root, idFactory: () => "unused", runDemo: async () => report("unused") });
  try {
    const reopened = await second.inject({ method: "GET", url: "/api/analyses/history-run-1" });
    assert.equal(reopened.statusCode, 200);
    assert.equal(reopened.json().status, "completed");
    assert.equal(reopened.json().report.analysisId, "history-run-1");

    const scenarioResponse = await second.inject({ method: "GET", url: "/api/analyses/history-run-1/scenarios/FR-01" });
    assert.equal(scenarioResponse.statusCode, 200);
    assert.equal(scenarioResponse.json().scenario.id, "FR-01");

    const serialized = JSON.stringify({ list: (await second.inject({ method: "GET", url: "/api/analyses" })).json(), reopened: reopened.json() });
    assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(serialized, /\.futureproof|OPENROUTER_API_KEY|Authorization|sk-or-/i);
  } finally {
    await second.close();
  }
});

test("persisted running analysis becomes interrupted when no current process owns it", async () => {
  const root = await tempRoot();
  const repository = new AnalysisRepository(root);
  await repository.createRunning("orphan-run");
  await repository.patchRuntime("orphan-run", { provider: "OpenRouter", model: "model-orphan", concurrency: 2 });

  const server = buildServer({ projectRoot: root, idFactory: () => "unused", runDemo: async () => report("unused") });
  try {
    const response = await server.inject({ method: "GET", url: "/api/analyses/orphan-run" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "interrupted");
    assert.match(response.json().error, /API restart/i);
    assert.equal((await repository.getSummary("orphan-run"))?.status, "interrupted");
  } finally {
    await server.close();
  }
});

test("failed analysis remains in history after API reconstruction", async () => {
  const root = await tempRoot();
  const repository = new AnalysisRepository(root);
  const first = buildServer({
    projectRoot: root,
    idFactory: () => "failed-history-run",
    runDemo: async ({ emit }) => {
      emit({ type: "analysis_started", analysisId: "failed-history-run", detail: { provider: "OpenRouter", model: "model-fail", concurrency: 2 } });
      throw new Error("model provider unavailable");
    },
  });
  try {
    await first.inject({ method: "POST", url: "/api/analyses/demo", payload: {} });
    const terminal = await waitForTerminal(first, "failed-history-run");
    assert.equal(terminal.status, "failed");
    const persisted = await repository.getSummary("failed-history-run");
    assert.equal(persisted?.status, "failed");
    assert.match(persisted?.error ?? "", /provider unavailable/);
  } finally {
    await first.close();
  }

  const second = buildServer({ projectRoot: root, idFactory: () => "unused", runDemo: async () => report("unused") });
  try {
    const list = await second.inject({ method: "GET", url: "/api/analyses" });
    assert.equal(list.statusCode, 200);
    const failed = list.json().analyses.find((item: any) => item.analysisId === "failed-history-run");
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /provider unavailable/);
  } finally {
    await second.close();
  }
});
