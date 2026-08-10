import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateBaseline, FutureScenario, ScenarioRunSummary } from "@futureproof/core";
import { buildAnalysisReport } from "../../packages/engine/src/compare.ts";

const scenario: FutureScenario = {
  id: "S1", title: "one", dimension: "breadth", requirement: "one", rationale: "r", affectedCapability: "x", difficulty: "medium", externalDependencies: false,
  provenance: ["p"], acceptance: [{ name: "a", given: "g", when: "w", then: "t" }],
};
const baselines: Record<"A" | "B", CandidateBaseline> = {
  A: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
  B: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
};

function run(candidateId: "A" | "B", trial: number, toolCalls: number, filesTouched: number, tokenUsage: number, failed: number, status: ScenarioRunSummary["status"] = "SUCCESS"): ScenarioRunSummary {
  return {
    analysisId: "a", candidateId, scenarioId: "S1", trial, status,
    acceptancePassed: 2, acceptanceFailed: 0, existingPassed: 22, existingFailed: 0, buildPassed: true,
    metrics: {
      toolCalls, readOps: 0, searchOps: 0, editOps: 1, testRuns: 1, tokenUsage, wallTimeMs: 1,
      filesTouched, modulesTouched: 1, locAdded: 1, locDeleted: 0, publicApiFilesTouched: 0,
      regressionSnapshots: failed < 0 ? [] : [{ cycle: 1, passed: 22 - failed, failed, timestampMs: 1 }],
      structuralDelta: { cyclomaticComplexity: 1, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 0 },
    },
    remainingFailures: [], patchPath: "p", artifactDir: "a",
  };
}

test("candidate ratios expose B-to-A effort and mark zero denominators not comparable", () => {
  const report = buildAnalysisReport("a", [scenario], { baselines, runs: [run("A", 1, 10, 2, 100, 1), run("B", 1, 25, 6, 250, 3)] });
  assert.equal(report.ratios.toolCalls, 2.5);
  assert.equal(report.ratios.filesTouched, 3);
  assert.equal(report.ratios.regressionArea, 3);
  assert.equal(report.ratios.tokenUsage, 2.5);
  assert.equal(report.ratioLabels.toolCalls, "2.50x");

  const zero = buildAnalysisReport("a", [scenario], { baselines, runs: [run("A", 1, 0, 0, 0, 0), run("B", 1, 5, 1, 10, 1)] });
  assert.equal(zero.ratios.toolCalls, null);
  assert.equal(zero.ratioLabels.toolCalls, "not comparable");
});

test("three trials use scalar medians and majority status while retaining raw trials", () => {
  const runs = [
    run("A", 1, 1, 1, 10, 0, "SUCCESS"),
    run("A", 2, 100, 100, 1000, 0, "FAIL"),
    run("A", 3, 3, 3, 30, 0, "SUCCESS"),
    run("B", 1, 6, 6, 60, 0, "SUCCESS"),
  ];
  const report = buildAnalysisReport("a", [scenario], { baselines, runs });
  assert.equal(report.candidates.A.averages.toolCalls, 3);
  assert.equal(report.candidates.A.averages.filesTouched, 3);
  assert.equal(report.candidates.A.scenarioRuns.length, 3);
  assert.equal(report.candidates.A.aggregatedScenarios[0]?.status, "SUCCESS");
});
