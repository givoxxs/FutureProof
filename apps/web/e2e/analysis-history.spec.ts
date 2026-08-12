import { expect, test, type Page } from "@playwright/test";

const analysisId = "history-run";
const scenario = {
  id: "FR-01",
  title: "Add SMS shipment notifications",
  difficulty: "medium",
  dimension: "breadth",
  requirement: "Support SMS shipment notifications as an alternative to email.",
  rationale: "Plausible future evolution.",
  affectedCapability: "shipment notifications",
  externalDependencies: false,
  provenance: ["current requirement"],
  acceptance: [{ name: "works", given: "a shipment", when: "notification runs", then: "behavior passes" }],
};

function aggregate(candidateId: "A" | "B") {
  return {
    scenarioId: "FR-01",
    status: "SUCCESS",
    trialCount: 1,
    metrics: {
      toolCalls: candidateId === "A" ? 10 : 15,
      filesTouched: candidateId === "A" ? 2 : 4,
      editOps: 2,
      testRuns: 2,
      tokenUsage: candidateId === "A" ? 10_000 : 15_000,
      regressionArea: 0,
      failedRegressionSnapshots: 0,
      structuralDelta: { cyclomaticComplexity: 1, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 1 },
      structuralMagnitude: 1,
    },
  };
}

const report = {
  analysisId,
  candidates: {
    A: {
      candidateId: "A",
      baseline: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 0, efficiencyRisk: 10, regressionRisk: 0, structuralRisk: 10, overallRisk: 8 },
      scenarioRuns: [], aggregatedScenarios: [aggregate("A")],
      averages: { toolCalls: 10, filesTouched: 2, regressionCycles: 0, tokenUsage: 10_000 },
    },
    B: {
      candidateId: "B",
      baseline: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 0, efficiencyRisk: 30, regressionRisk: 0, structuralRisk: 20, overallRisk: 18 },
      scenarioRuns: [], aggregatedScenarios: [aggregate("B")],
      averages: { toolCalls: 15, filesTouched: 4, regressionCycles: 0, tokenUsage: 15_000 },
    },
  },
  ratios: { toolCalls: 1.5, filesTouched: 2, regressionArea: null, tokenUsage: 1.5 },
  ratioLabels: { toolCalls: "1.50x", filesTouched: "2.00x", regressionArea: "n/a", tokenUsage: "1.50x" },
  scenarios: [scenario],
};

const summary = {
  version: 1,
  analysisId,
  status: "completed",
  createdAt: "2026-08-12T01:00:00.000Z",
  updatedAt: "2026-08-12T01:02:00.000Z",
  completedAt: "2026-08-12T01:02:00.000Z",
  provider: "OpenRouter",
  model: "deepseek/deepseek-v4-flash-0731",
  concurrency: 2,
  requestTimeoutMs: 90_000,
  candidateRisk: { A: 8, B: 18 },
};

async function mockHistoryApi(page: Page): Promise<void> {
  await page.route("**/api/analyses", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analyses: [summary] }) });
  });
  await page.route("**/api/analyses/demo", async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ analysisId }) });
  });
  await page.route(`**/api/analyses/${analysisId}/events`, async (route) => {
    const event = { type: "analysis_completed", analysisId, timestampMs: Date.now() };
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify(event)}\n\n` });
  });
  await page.route(`**/api/analyses/${analysisId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "completed", analysisId, report }) });
  });
}

test("completed run remains reopenable after New Analysis", async ({ page }) => {
  await mockHistoryApi(page);
  await page.goto("/");

  await page.getByRole("button", { name: /start analysis/i }).click();
  await expect(page.getByRole("heading", { name: "Analysis Report" })).toBeVisible();

  await page.getByRole("button", { name: /new analysis/i }).click();
  await expect(page.getByRole("heading", { name: /Which implementation is easier to change tomorrow/i })).toBeVisible();

  await page.getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Recent Runs" })).toBeVisible();
  await page.getByRole("button", { name: `Open analysis ${analysisId}` }).click();
  await expect(page.getByRole("heading", { name: "Analysis Report" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open analysis ${analysisId}` })).toHaveAttribute("aria-current", "true");
  await expect.poll(async () => await page.evaluate(() => localStorage.getItem("futureproof.selectedAnalysisId.v1"))).toBe(analysisId);
});

test("Recent Runs and reopened report stay within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockHistoryApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Recent Runs" })).toBeVisible();
  await page.getByRole("button", { name: `Open analysis ${analysisId}` }).click();
  await expect(page.getByRole("heading", { name: "Analysis Report" })).toBeVisible();

  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(bodyOverflow).toBe(false);
});
