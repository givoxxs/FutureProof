import test from "node:test";
import assert from "node:assert/strict";
import {
  FutureScenarioSchema,
  ScenarioRunSummarySchema,
  RiskDimensionsSchema,
} from "../../packages/core/src/schema.ts";

const scenario = {
  id: "FR-01",
  title: "SMS",
  dimension: "breadth",
  requirement: "Create a Channel interface and add SmsChannel",
  rationale: "second channel",
  affectedCapability: "notification delivery",
  difficulty: "medium",
  externalDependencies: false,
  provenance: ["README: shipment notifications"],
  acceptance: [],
};

test("accepts scenario shape before semantic neutrality filtering", () => {
  const result = FutureScenarioSchema.safeParse(scenario);
  assert.equal(result.success, true);
});

test("rejects scenario without provenance", () => {
  const result = FutureScenarioSchema.safeParse({ ...scenario, provenance: [] });
  assert.equal(result.success, false);
});

test("rejects invalid scenario status", () => {
  const result = ScenarioRunSummarySchema.safeParse({
    analysisId: "analysis-1",
    candidateId: "A",
    scenarioId: "FR-01",
    trial: 1,
    status: "MAYBE",
    acceptancePassed: 1,
    acceptanceFailed: 0,
    existingPassed: 22,
    existingFailed: 0,
    buildPassed: true,
    metrics: {
      toolCalls: 1,
      readOps: 1,
      searchOps: 0,
      editOps: 0,
      testRuns: 1,
      tokenUsage: 10,
      wallTimeMs: 1.5,
      filesTouched: 0,
      modulesTouched: 0,
      locAdded: 0,
      locDeleted: 0,
      publicApiFilesTouched: 0,
      regressionSnapshots: [],
      structuralDelta: null,
    },
    remainingFailures: [],
    patchPath: "patch.diff",
    artifactDir: ".futureproof/runs/analysis-1/A/FR-01",
  });
  assert.equal(result.success, false);
});

test("rejects negative metric counts", () => {
  const result = ScenarioRunSummarySchema.safeParse({
    analysisId: "analysis-1",
    candidateId: "A",
    scenarioId: "FR-01",
    trial: 1,
    status: "SUCCESS",
    acceptancePassed: 1,
    acceptanceFailed: 0,
    existingPassed: 22,
    existingFailed: 0,
    buildPassed: true,
    metrics: {
      toolCalls: -1,
      readOps: 0,
      searchOps: 0,
      editOps: 0,
      testRuns: 0,
      tokenUsage: 0,
      wallTimeMs: 0,
      filesTouched: 0,
      modulesTouched: 0,
      locAdded: 0,
      locDeleted: 0,
      publicApiFilesTouched: 0,
      regressionSnapshots: [],
      structuralDelta: null,
    },
    remainingFailures: [],
    patchPath: "patch.diff",
    artifactDir: ".futureproof/runs/analysis-1/A/FR-01",
  });
  assert.equal(result.success, false);
});

test("risk dimensions stay within zero to one hundred", () => {
  assert.equal(RiskDimensionsSchema.safeParse({
    resilienceRisk: 20,
    efficiencyRisk: 30,
    regressionRisk: null,
    structuralRisk: 50,
    overallRisk: 101,
  }).success, false);
  assert.equal(RiskDimensionsSchema.safeParse({
    resilienceRisk: 20,
    efficiencyRisk: 30,
    regressionRisk: null,
    structuralRisk: 50,
    overallRisk: 42,
  }).success, true);
});

test("structural deltas may be negative when a change improves structure", () => {
  const result = ScenarioRunSummarySchema.safeParse({
    analysisId: "analysis-1",
    candidateId: "A",
    scenarioId: "FR-01",
    trial: 1,
    status: "SUCCESS",
    acceptancePassed: 2,
    acceptanceFailed: 0,
    existingPassed: 22,
    existingFailed: 0,
    buildPassed: true,
    metrics: {
      toolCalls: 2,
      readOps: 0,
      searchOps: 0,
      editOps: 1,
      testRuns: 1,
      tokenUsage: 10,
      wallTimeMs: 100,
      filesTouched: 1,
      modulesTouched: 1,
      locAdded: 1,
      locDeleted: 2,
      publicApiFilesTouched: 0,
      regressionSnapshots: [],
      structuralDelta: {
        cyclomaticComplexity: -1,
        duplicateLineWindows: -2,
        dependencyFanOut: 0,
        fileSizeLines: -3,
      },
    },
    remainingFailures: [],
    patchPath: "patch.diff",
    artifactDir: ".futureproof/runs/analysis-1/A/FR-01",
  });
  assert.equal(result.success, true);
});
