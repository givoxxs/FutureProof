import { expect, test } from "@playwright/test";

const scenarios = [
  ["FR-01", "Add SMS Notifications", "medium", "breadth"],
  ["FR-02", "User Notification Preferences", "medium", "policy"],
  ["FR-03", "Retry Failed Delivery", "medium", "reliability"],
  ["FR-04", "Provider Fallback (Email → SMS)", "hard", "composition"],
  ["FR-05", "Add Push Notifications", "easy", "extension"],
].map(([id, title, difficulty, dimension]) => ({
  id,
  title,
  difficulty,
  dimension,
  requirement: id === "FR-04"
    ? "If the primary email provider fails, automatically fall back to the secondary provider."
    : title,
  rationale: "Plausible future evolution generated from the base requirement.",
  affectedCapability: "shipment notifications",
  externalDependencies: false,
  provenance: ["current-requirement.md: shipment notifications", "base/src/index.ts: current delivery behavior"],
  acceptance: [{ name: "works", given: "a shipped order", when: "notification runs", then: "the requested behavior occurs" }],
}));

function aggregate(scenarioId: string, status: string, toolCalls: number, filesTouched: number, regressions: number, tokenUsage: number, structural: number) {
  return {
    scenarioId,
    status,
    trialCount: scenarioId === "FR-04" ? 3 : 1,
    metrics: {
      toolCalls,
      filesTouched,
      editOps: Math.max(1, Math.round(filesTouched / 2)),
      testRuns: regressions + 1,
      tokenUsage,
      regressionArea: regressions,
      failedRegressionSnapshots: regressions,
      structuralDelta: { cyclomaticComplexity: structural, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: structural * 2 },
      structuralMagnitude: structural,
    },
  };
}

const aggregatesA = [
  aggregate("FR-01", "SUCCESS", 11, 3, 0, 10_200, 1),
  aggregate("FR-02", "SUCCESS", 13, 4, 1, 11_900, 2),
  aggregate("FR-03", "SUCCESS", 14, 4, 1, 12_700, 2),
  aggregate("FR-04", "SUCCESS", 12, 3, 2, 11_500, 5),
  aggregate("FR-05", "SUCCESS", 13, 4, 2, 10_700, 2),
];
const aggregatesB = [
  aggregate("FR-01", "SUCCESS", 20, 7, 2, 21_000, 8),
  aggregate("FR-02", "PARTIAL", 24, 8, 3, 23_000, 10),
  aggregate("FR-03", "FAIL", 30, 9, 5, 29_000, 13),
  aggregate("FR-04", "FAIL", 35, 12, 7, 31_000, 18),
  aggregate("FR-05", "SUCCESS", 24, 8, 4, 25_000, 14),
];

const rawA = {
  analysisId: "visual-analysis", candidateId: "A", scenarioId: "FR-04", trial: 1, status: "SUCCESS",
  acceptancePassed: 2, acceptanceFailed: 0, existingPassed: 22, existingFailed: 0, buildPassed: true,
  metrics: { toolCalls: 11, readOps: 3, searchOps: 2, editOps: 2, testRuns: 2, tokenUsage: 9_100, wallTimeMs: 1000, filesTouched: 3, modulesTouched: 2, locAdded: 74, locDeleted: 8, publicApiFilesTouched: 0, regressionSnapshots: [{ cycle: 1, passed: 23, failed: 1, timestampMs: 1 }, { cycle: 2, passed: 24, failed: 0, timestampMs: 2 }], structuralDelta: { cyclomaticComplexity: 3, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 2 } },
  remainingFailures: [],
};
const rawB = {
  analysisId: "visual-analysis", candidateId: "B", scenarioId: "FR-04", trial: 1, status: "FAIL",
  acceptancePassed: 1, acceptanceFailed: 1, existingPassed: 22, existingFailed: 0, buildPassed: true,
  metrics: { toolCalls: 35, readOps: 12, searchOps: 5, editOps: 7, testRuns: 8, tokenUsage: 26_300, wallTimeMs: 2500, filesTouched: 9, modulesTouched: 4, locAdded: 196, locDeleted: 41, publicApiFilesTouched: 1, regressionSnapshots: [{ cycle: 1, passed: 17, failed: 7, timestampMs: 1 }, { cycle: 2, passed: 22, failed: 2, timestampMs: 2 }], structuralDelta: { cyclomaticComplexity: 12, duplicateLineWindows: 1, dependencyFanOut: 1, fileSizeLines: 14 } },
  remainingFailures: ["FR-04 uses secondary provider after primary failure"],
};

const report = {
  analysisId: "visual-analysis",
  candidates: {
    A: {
      candidateId: "A",
      baseline: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 4, efficiencyRisk: 18, regressionRisk: 10, structuralRisk: 12, overallRisk: 18 },
      scenarioRuns: [rawA], aggregatedScenarios: aggregatesA,
      averages: { toolCalls: 12.6, filesTouched: 3.6, regressionCycles: 1.2, tokenUsage: 11_400 },
    },
    B: {
      candidateId: "B",
      baseline: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 60, efficiencyRisk: 82, regressionRisk: 77, structuralRisk: 76, overallRisk: 74 },
      scenarioRuns: [rawB], aggregatedScenarios: aggregatesB,
      averages: { toolCalls: 26.7, filesTouched: 8.9, regressionCycles: 4.3, tokenUsage: 25_800 },
    },
  },
  ratios: { toolCalls: 2.12, filesTouched: 2.47, regressionArea: 3.58, tokenUsage: 2.26 },
  ratioLabels: { toolCalls: "2.12x", filesTouched: "2.47x", regressionArea: "3.58x", tokenUsage: "2.26x" },
  scenarios,
};

const scenarioDetail = {
  scenario: scenarios.find((scenario) => scenario.id === "FR-04"),
  candidates: { A: aggregatesA[3], B: aggregatesB[3] },
  rawRuns: { A: [rawA], B: [rawB] },
};

test("captures approved report and evidence drawer", async ({ page }, testInfo) => {
  await page.route("**/api/analyses/demo", async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ analysisId: "visual-analysis" }) });
  });
  await page.route("**/api/analyses/visual-analysis/events", async (route) => {
    const event = { type: "analysis_completed", analysisId: "visual-analysis", timestampMs: Date.now() };
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify(event)}\n\n` });
  });
  await page.route("**/api/analyses/visual-analysis/scenarios/FR-04", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scenarioDetail) });
  });
  await page.route("**/api/analyses/visual-analysis", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "completed", analysisId: "visual-analysis", report }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /start analysis/i }).click();
  await expect(page.getByRole("heading", { name: "Analysis Report" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("futureproof-report.png"), fullPage: true });

  await page.getByRole("button", { name: /view details for provider fallback/i }).click();
  await expect(page.getByRole("dialog", { name: /scenario detail/i })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("futureproof-drawer.png"), fullPage: true });
});
