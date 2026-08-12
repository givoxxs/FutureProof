import { expect, test, type Page } from "@playwright/test";

async function mockRunningAnalysis(page: Page) {
  await page.route("**/api/analyses", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analyses: [] }) });
  });
  await page.route("**/api/analyses/demo", async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ analysisId: "parallel-analysis" }) });
  });
  await page.route("**/api/analyses/parallel-analysis", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "running", analysisId: "parallel-analysis" }) });
  });
  await page.route("**/api/analyses/parallel-analysis/events", async (route) => {
    const events = [
      { type: "analysis_started", analysisId: "parallel-analysis", timestampMs: 1, detail: { concurrency: 2, model: "deepseek/deepseek-v4-flash-0731", provider: "OpenRouter", requestTimeoutMs: 90_000 } },
      { type: "scenario_started", analysisId: "parallel-analysis", scenarioId: "FR-03", timestampMs: 2 },
      { type: "candidate_started", analysisId: "parallel-analysis", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 3 },
      { type: "candidate_started", analysisId: "parallel-analysis", scenarioId: "FR-03", candidateId: "B", trial: 1, timestampMs: 4 },
      { type: "agent_activity", analysisId: "parallel-analysis", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 5, detail: { action: "reading", label: "src/notification.ts", toolCallsExecuted: 14, maxToolCalls: 35, testCycles: 2, maxTestCycles: 8, totalTokens: 8_000, maxTokens: 30_000 } },
      { type: "agent_activity", analysisId: "parallel-analysis", scenarioId: "FR-03", candidateId: "B", trial: 1, timestampMs: 6, detail: { action: "testing", label: "pnpm test", toolCallsExecuted: 11, maxToolCalls: 35, testCycles: 3, maxTestCycles: 8, totalTokens: 9_000, maxTokens: 30_000 } },
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
}

test("shows two parallel candidates and observed agent activity", async ({ page }, testInfo) => {
  await mockRunningAnalysis(page);
  await page.goto("/");
  await page.getByRole("button", { name: /start analysis/i }).click();

  await expect(page.getByRole("heading", { name: "Stress-testing future changes" })).toBeVisible();
  await expect(page.getByText("Concurrency 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Active runs 2 / 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Candidate A", { exact: true })).toBeVisible();
  await expect(page.getByText("Candidate B", { exact: true })).toBeVisible();
  await expect(page.getByText("Per-user notification preferences", { exact: true })).toBeVisible();
  await expect(page.getByText("Reading", { exact: true })).toBeVisible();
  await expect(page.getByText("Testing", { exact: true })).toBeVisible();
  await expect(page.getByText(/sk-or-/i)).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath("futureproof-parallel-experiments.png"), fullPage: true });
});
