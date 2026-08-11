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

function run(candidateId: "A" | "B", artifactDir: string) {
  return {
    analysisId: "analysis-export",
    candidateId,
    scenarioId: "FR-01",
    trial: 1,
    status: candidateId === "A" ? "SUCCESS" : "PARTIAL",
    acceptancePassed: candidateId === "A" ? 1 : 0,
    acceptanceFailed: candidateId === "A" ? 0 : 1,
    existingPassed: 22,
    existingFailed: 0,
    buildPassed: true,
    metrics: {
      toolCalls: candidateId === "A" ? 10 : 20,
      readOps: 1,
      searchOps: 1,
      editOps: 1,
      testRuns: 2,
      tokenUsage: candidateId === "A" ? 100 : 250,
      wallTimeMs: 10,
      filesTouched: candidateId === "A" ? 2 : 5,
      modulesTouched: 1,
      locAdded: 10,
      locDeleted: 2,
      publicApiFilesTouched: 0,
      regressionSnapshots: [],
      structuralDelta: { cyclomaticComplexity: 1, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 1 },
    },
    remainingFailures: [],
    patchPath: path.join(artifactDir, "patch.diff"),
    artifactDir,
  };
}

function report(projectRoot: string) {
  const artifactA = path.join(projectRoot, "secret-server-path", "A");
  const artifactB = path.join(projectRoot, "secret-server-path", "B");
  const aggregateA = {
    scenarioId: "FR-01", status: "SUCCESS", trialCount: 1,
    metrics: { toolCalls: 10, filesTouched: 2, editOps: 1, testRuns: 2, tokenUsage: 100, regressionArea: 0, failedRegressionSnapshots: 0, structuralDelta: { cyclomaticComplexity: 0, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 1 }, structuralMagnitude: 0.05 },
  };
  const aggregateB = {
    scenarioId: "FR-01", status: "PARTIAL", trialCount: 1,
    metrics: { toolCalls: 20, filesTouched: 5, editOps: 3, testRuns: 5, tokenUsage: 250, regressionArea: 3, failedRegressionSnapshots: 2, structuralDelta: { cyclomaticComplexity: 2, duplicateLineWindows: 0, dependencyFanOut: 1, fileSizeLines: 10 }, structuralMagnitude: 3.5 },
  };
  return {
    analysisId: "analysis-export",
    candidates: {
      A: {
        candidateId: "A",
        baseline: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
        dimensions: { resilienceRisk: 0, efficiencyRisk: 0, regressionRisk: 0, structuralRisk: 0, overallRisk: 18 },
        scenarioRuns: [run("A", artifactA)],
        aggregatedScenarios: [aggregateA],
        averages: { toolCalls: 10, filesTouched: 2, regressionCycles: 0, tokenUsage: 100 },
      },
      B: {
        candidateId: "B",
        baseline: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
        dimensions: { resilienceRisk: 50, efficiencyRisk: 50, regressionRisk: 50, structuralRisk: 50, overallRisk: 74 },
        scenarioRuns: [run("B", artifactB)],
        aggregatedScenarios: [aggregateB],
        averages: { toolCalls: 20, filesTouched: 5, regressionCycles: 2, tokenUsage: 250 },
      },
    },
    ratios: { toolCalls: 2, filesTouched: 2.5, regressionArea: null, tokenUsage: 2.5 },
    ratioLabels: { toolCalls: "2.00x", filesTouched: "2.50x", regressionArea: "not comparable", tokenUsage: "2.50x" },
    scenarios: [scenario],
  } as any;
}

async function complete(server: ReturnType<typeof buildServer>) {
  await server.inject({ method: "POST", url: "/api/analyses/demo", payload: {} });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await server.inject({ method: "GET", url: "/api/analyses/analysis-export" });
    if (response.statusCode === 200 && response.json().status === "completed") return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("analysis did not complete");
}

test("completed analysis serves a path-safe JSON export", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-export-api-"));
  const server = buildServer({ projectRoot, idFactory: () => "analysis-export", runDemo: async () => report(projectRoot) });
  try {
    await complete(server);
    const response = await server.inject({ method: "GET", url: "/api/analyses/analysis-export/exports/report.json" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /application\/json/);
    assert.equal(response.body.includes("patchPath"), false);
    assert.equal(response.body.includes("artifactDir"), false);
    assert.equal(response.body.includes(projectRoot), false);
    assert.equal(response.json().analysisId, "analysis-export");
  } finally {
    await server.close();
  }
});

test("completed analysis serves Markdown and checksum manifest exports", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-export-api-"));
  const server = buildServer({ projectRoot, idFactory: () => "analysis-export", runDemo: async () => report(projectRoot) });
  try {
    await complete(server);
    const markdown = await server.inject({ method: "GET", url: "/api/analyses/analysis-export/exports/report.md" });
    assert.equal(markdown.statusCode, 200);
    assert.match(markdown.headers["content-type"] ?? "", /text\/markdown/);
    assert.match(markdown.body, /# FutureProof Analysis Report/);
    assert.match(markdown.body, /2\.00x/);

    const manifest = await server.inject({ method: "GET", url: "/api/analyses/analysis-export/exports/manifest.json" });
    assert.equal(manifest.statusCode, 200);
    const body = manifest.json();
    assert.equal(body.analysisId, "analysis-export");
    assert.match(body.reportSha256, /^[a-f0-9]{64}$/);
    assert.match(body.markdownSha256, /^[a-f0-9]{64}$/);
  } finally {
    await server.close();
  }
});

test("export route rejects unknown files", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-export-api-"));
  const server = buildServer({ projectRoot, idFactory: () => "analysis-export", runDemo: async () => report(projectRoot) });
  try {
    await complete(server);
    const response = await server.inject({ method: "GET", url: "/api/analyses/analysis-export/exports/secrets.txt" });
    assert.equal(response.statusCode, 404);
  } finally {
    await server.close();
  }
});
