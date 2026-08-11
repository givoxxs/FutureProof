import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analysisArtifactDir } from "../../packages/core/src/paths.ts";
import { buildServer } from "../../apps/api/src/server.ts";

const scenario = {
  id: "FR-04",
  title: "Provider fallback",
  dimension: "composition",
  requirement: "Fall back to a secondary email provider when the primary provider fails.",
  rationale: "Provider failure already exists.",
  affectedCapability: "email delivery",
  difficulty: "hard",
  externalDependencies: false,
  provenance: ["current requirement"],
  acceptance: [{ name: "fallback", given: "primary fails", when: "delivery runs", then: "secondary sends" }],
};

async function makeFixture() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-api-artifacts-"));
  const artifactDir = path.join(analysisArtifactDir(projectRoot, "analysis-artifacts"), "B", "FR-04", "trial-1");
  await fs.mkdir(artifactDir, { recursive: true });
  const patchPath = path.join(artifactDir, "patch.diff");
  await fs.writeFile(patchPath, "--- a/src/index.ts\n+++ b/src/index.ts\n", "utf8");
  await fs.writeFile(path.join(artifactDir, "tool-events.jsonl"), '{"type":"tool_call"}\n', "utf8");

  const run = {
    analysisId: "analysis-artifacts",
    candidateId: "B",
    scenarioId: "FR-04",
    trial: 1,
    status: "FAIL",
    acceptancePassed: 1,
    acceptanceFailed: 1,
    existingPassed: 22,
    existingFailed: 0,
    buildPassed: true,
    metrics: {
      toolCalls: 35, readOps: 10, searchOps: 5, editOps: 7, testRuns: 8, tokenUsage: 26300, wallTimeMs: 1000,
      filesTouched: 9, modulesTouched: 3, locAdded: 140, locDeleted: 30, publicApiFilesTouched: 1,
      regressionSnapshots: [{ cycle: 1, passed: 17, failed: 7, timestampMs: 1 }],
      structuralDelta: { cyclomaticComplexity: 12, duplicateLineWindows: 1, dependencyFanOut: 1, fileSizeLines: 14 },
    },
    remainingFailures: ["FR-04 uses secondary provider after primary failure"],
    patchPath,
    artifactDir,
  };

  const aggregate = {
    scenarioId: "FR-04", status: "FAIL", trialCount: 1,
    metrics: { toolCalls: 35, filesTouched: 9, editOps: 7, testRuns: 8, tokenUsage: 26300, regressionArea: 7, failedRegressionSnapshots: 1, structuralDelta: run.metrics.structuralDelta, structuralMagnitude: 13.7 },
  };

  const report = {
    analysisId: "analysis-artifacts",
    candidates: {
      A: {
        candidateId: "A",
        baseline: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
        dimensions: { resilienceRisk: 0, efficiencyRisk: 0, regressionRisk: 0, structuralRisk: 0, overallRisk: 0 },
        scenarioRuns: [], aggregatedScenarios: [{ ...aggregate, status: "SUCCESS", metrics: { ...aggregate.metrics, toolCalls: 11, filesTouched: 3 } }],
        averages: { toolCalls: 11, filesTouched: 3, regressionCycles: 0, tokenUsage: 9100 },
      },
      B: {
        candidateId: "B",
        baseline: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
        dimensions: { resilienceRisk: 50, efficiencyRisk: 75, regressionRisk: 80, structuralRisk: 70, overallRisk: 70 },
        scenarioRuns: [run], aggregatedScenarios: [aggregate],
        averages: { toolCalls: 35, filesTouched: 9, regressionCycles: 1, tokenUsage: 26300 },
      },
    },
    ratios: { toolCalls: 3.18, filesTouched: 3, regressionArea: null, tokenUsage: 2.89 },
    ratioLabels: { toolCalls: "3.18x", filesTouched: "3.00x", regressionArea: "not comparable", tokenUsage: "2.89x" },
    scenarios: [scenario],
  } as any;
  return { projectRoot, report };
}

async function complete(server: ReturnType<typeof buildServer>) {
  await server.inject({ method: "POST", url: "/api/analyses/demo", payload: {} });
  for (let i = 0; i < 50; i += 1) {
    const response = await server.inject({ method: "GET", url: "/api/analyses/analysis-artifacts" });
    if (response.statusCode === 200 && response.json().status === "completed") return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("analysis did not complete");
}

test("scenario payload never exposes server filesystem paths", async () => {
  const { projectRoot, report } = await makeFixture();
  const server = buildServer({ projectRoot, idFactory: () => "analysis-artifacts", runDemo: async () => report });
  try {
    await complete(server);
    const response = await server.inject({ method: "GET", url: "/api/analyses/analysis-artifacts/scenarios/FR-04" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes("patchPath"), false);
    assert.equal(response.body.includes("artifactDir"), false);
    assert.equal(response.body.includes(projectRoot), false);
  } finally {
    await server.close();
  }
});

test("artifact endpoint resolves patch and event logs from opaque identifiers", async () => {
  const { projectRoot, report } = await makeFixture();
  const server = buildServer({ projectRoot, idFactory: () => "analysis-artifacts", runDemo: async () => report });
  try {
    await complete(server);
    const patch = await server.inject({ method: "GET", url: "/api/analyses/analysis-artifacts/scenarios/FR-04/candidates/B/trials/1/artifacts/patch" });
    assert.equal(patch.statusCode, 200);
    assert.match(patch.body, /--- a\/src\/index\.ts/);
    assert.match(patch.headers["content-type"] ?? "", /text\/plain/);

    const events = await server.inject({ method: "GET", url: "/api/analyses/analysis-artifacts/scenarios/FR-04/candidates/B/trials/1/artifacts/events" });
    assert.equal(events.statusCode, 200);
    assert.match(events.body, /tool_call/);

    const unknown = await server.inject({ method: "GET", url: "/api/analyses/analysis-artifacts/scenarios/FR-04/candidates/B/trials/1/artifacts/secret" });
    assert.equal(unknown.statusCode, 404);
  } finally {
    await server.close();
  }
});
