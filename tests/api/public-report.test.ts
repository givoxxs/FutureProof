import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../../apps/api/src/server.ts";

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

function makeReport(projectRoot: string) {
  const privateRoot = path.join(projectRoot, "private-run");
  const rawRun = (candidateId: "A" | "B") => ({
    analysisId: "analysis-public",
    candidateId,
    scenarioId: "FR-01",
    trial: 1,
    status: "SUCCESS",
    acceptancePassed: 1,
    acceptanceFailed: 0,
    existingPassed: 22,
    existingFailed: 0,
    buildPassed: true,
    metrics: {
      toolCalls: 10, readOps: 1, searchOps: 1, editOps: 1, testRuns: 2, tokenUsage: 100, wallTimeMs: 10,
      filesTouched: 2, modulesTouched: 1, locAdded: 5, locDeleted: 1, publicApiFilesTouched: 0,
      regressionSnapshots: [],
      structuralDelta: { cyclomaticComplexity: 0, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 1 },
    },
    remainingFailures: [],
    patchPath: path.join(privateRoot, candidateId, "patch.diff"),
    artifactDir: path.join(privateRoot, candidateId),
  });
  const aggregate = {
    scenarioId: "FR-01", status: "SUCCESS", trialCount: 1,
    metrics: { toolCalls: 10, filesTouched: 2, editOps: 1, testRuns: 2, tokenUsage: 100, regressionArea: 0, failedRegressionSnapshots: 0, structuralDelta: { cyclomaticComplexity: 0, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 1 }, structuralMagnitude: 0.05 },
  };
  const candidate = (candidateId: "A" | "B") => ({
    candidateId,
    baseline: { candidateId, testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
    dimensions: { resilienceRisk: 0, efficiencyRisk: 0, regressionRisk: 0, structuralRisk: 0, overallRisk: candidateId === "A" ? 18 : 74 },
    scenarioRuns: [rawRun(candidateId)],
    aggregatedScenarios: [aggregate],
    averages: { toolCalls: 10, filesTouched: 2, regressionCycles: 0, tokenUsage: 100 },
  });
  return {
    analysisId: "analysis-public",
    candidates: { A: candidate("A"), B: candidate("B") },
    ratios: { toolCalls: 1, filesTouched: 1, regressionArea: null, tokenUsage: 1 },
    ratioLabels: { toolCalls: "1.00x", filesTouched: "1.00x", regressionArea: "not comparable", tokenUsage: "1.00x" },
    scenarios: [scenario],
  } as any;
}

async function complete(server: ReturnType<typeof buildServer>) {
  await server.inject({ method: "POST", url: "/api/analyses/demo", payload: {} });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await server.inject({ method: "GET", url: "/api/analyses/analysis-public" });
    if (response.statusCode === 200 && response.json().status === "completed") return response;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("analysis did not complete");
}

test("completed analysis response never exposes server filesystem paths", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-public-report-"));
  const server = buildServer({ projectRoot, idFactory: () => "analysis-public", runDemo: async () => makeReport(projectRoot) });
  try {
    const response = await complete(server);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes("patchPath"), false);
    assert.equal(response.body.includes("artifactDir"), false);
    assert.equal(response.body.includes(projectRoot), false);
    const body = response.json();
    assert.equal(body.report.candidates.A.aggregatedScenarios[0].status, "SUCCESS");
    assert.equal(body.report.candidates.A.scenarioRuns[0].trial, 1);
  } finally {
    await server.close();
  }
});
