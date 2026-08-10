import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateBaseline, FutureScenario, ScenarioRunSummary } from "@futureproof/core";
import { ratioPenalty } from "../../packages/engine/src/score.ts";
import { buildAnalysisReport } from "../../packages/engine/src/compare.ts";

const scenario1: FutureScenario = {
  id: "S1", title: "one", dimension: "breadth", requirement: "one", rationale: "r", affectedCapability: "x", difficulty: "medium", externalDependencies: false,
  provenance: ["p"], acceptance: [{ name: "a", given: "g", when: "w", then: "t" }],
};
const scenario2: FutureScenario = { ...scenario1, id: "S2", title: "two", requirement: "two" };

const baselines: Record<"A" | "B", CandidateBaseline> = {
  A: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
  B: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
};

function run(candidateId: "A" | "B", scenarioId: string, status: ScenarioRunSummary["status"], factor: number, structural = factor * 2): ScenarioRunSummary {
  return {
    analysisId: "analysis",
    candidateId,
    scenarioId,
    trial: 1,
    status,
    acceptancePassed: status === "SUCCESS" ? 2 : status === "PARTIAL" ? 1 : 0,
    acceptanceFailed: status === "SUCCESS" ? 0 : status === "PARTIAL" ? 1 : 2,
    existingPassed: 22,
    existingFailed: 0,
    buildPassed: status !== "BUILD_BROKEN",
    metrics: {
      toolCalls: 10 * factor,
      readOps: 2 * factor,
      searchOps: factor,
      editOps: factor,
      testRuns: 2 * factor,
      tokenUsage: 100 * factor,
      wallTimeMs: 1000 * factor,
      filesTouched: 2 * factor,
      modulesTouched: factor,
      locAdded: 10 * factor,
      locDeleted: factor,
      publicApiFilesTouched: 0,
      regressionSnapshots: [{ cycle: 1, passed: 22, failed: factor, timestampMs: 1 }],
      structuralDelta: { cyclomaticComplexity: structural, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 0 },
    },
    remainingFailures: [],
    patchPath: "patch.diff",
    artifactDir: "artifacts",
  };
}

test("ratioPenalty maps 1x to zero, 2x to fifty, and 3x+ to one hundred", () => {
  assert.equal(ratioPenalty(10, 10), 0);
  assert.equal(ratioPenalty(20, 10), 50);
  assert.equal(ratioPenalty(30, 10), 100);
  assert.equal(ratioPenalty(40, 10), 100);
});

test("buildAnalysisReport applies hand-calculated deterministic dimension weights", () => {
  const execution = {
    baselines,
    runs: [
      run("A", "S1", "SUCCESS", 1),
      run("A", "S2", "SUCCESS", 1),
      run("B", "S1", "SUCCESS", 2),
      run("B", "S2", "FAIL", 2),
    ],
  };
  const report = buildAnalysisReport("analysis", [scenario1, scenario2], execution);
  assert.equal(report.candidates.A.dimensions.resilienceRisk, 0);
  assert.equal(report.candidates.A.dimensions.efficiencyRisk, 0);
  assert.equal(report.candidates.A.dimensions.regressionRisk, 0);
  assert.equal(report.candidates.A.dimensions.structuralRisk, 0);
  assert.equal(report.candidates.A.dimensions.overallRisk, 0);

  assert.equal(report.candidates.B.dimensions.resilienceRisk, 50);
  assert.equal(report.candidates.B.dimensions.efficiencyRisk, 50);
  assert.equal(report.candidates.B.dimensions.regressionRisk, 25);
  assert.equal(report.candidates.B.dimensions.structuralRisk, 50);
  assert.equal(report.candidates.B.dimensions.overallRisk, 45);
});

test("missing structural evidence becomes null and renormalizes instead of pretending zero risk", () => {
  const a = run("A", "S1", "SUCCESS", 1);
  const b = run("B", "S1", "FAIL", 2);
  a.metrics.structuralDelta = null;
  b.metrics.structuralDelta = null;
  const report = buildAnalysisReport("analysis", [scenario1], { baselines, runs: [a, b] });
  assert.equal(report.candidates.B.dimensions.structuralRisk, null);
  assert.ok(report.candidates.B.dimensions.overallRisk > 0);
  assert.notEqual(report.candidates.B.dimensions.overallRisk, 0.4 * 100 + 0.25 * 50 + 0.20 * 25);
});

test("report construction rejects an invalid entire candidate", () => {
  const invalidBaselines = { ...baselines, B: { ...baselines.B, valid: false } };
  assert.throws(
    () => buildAnalysisReport("analysis", [scenario1], { baselines: invalidBaselines, runs: [run("A", "S1", "SUCCESS", 1), { ...run("B", "S1", "FAIL", 2), status: "INVALID" }] }),
    /invalid candidate B/i,
  );
});
