import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import type { ProgressEvent } from "./api";

const api = vi.hoisted(() => ({
  startDemoAnalysis: vi.fn(),
  getAnalysis: vi.fn(),
  subscribeToProgress: vi.fn(),
  getScenarioDetail: vi.fn(),
  getArtifact: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, ...api };
});

afterEach(cleanup);

const scenario = {
  id: "FR-01",
  title: "Add SMS shipment notifications",
  difficulty: "medium",
  dimension: "breadth",
  requirement: "Support SMS shipment notifications as an alternative to email.",
  rationale: "Plausible future evolution",
  affectedCapability: "notifications",
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
      toolCalls: candidateId === "A" ? 10 : 20,
      filesTouched: candidateId === "A" ? 3 : 6,
      editOps: 2,
      testRuns: 2,
      tokenUsage: candidateId === "A" ? 10_000 : 20_000,
      regressionArea: 0,
      failedRegressionSnapshots: 0,
      structuralDelta: { cyclomaticComplexity: 1, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 0 },
      structuralMagnitude: 1,
    },
  };
}

const completedReport = {
  analysisId: "analysis-ui",
  candidates: {
    A: {
      candidateId: "A",
      baseline: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 0, efficiencyRisk: 0, regressionRisk: 0, structuralRisk: 10, overallRisk: 5 },
      scenarioRuns: [],
      aggregatedScenarios: [aggregate("A")],
      averages: { toolCalls: 10, filesTouched: 3, regressionCycles: 0, tokenUsage: 10_000 },
    },
    B: {
      candidateId: "B",
      baseline: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 0, efficiencyRisk: 50, regressionRisk: 0, structuralRisk: 30, overallRisk: 18 },
      scenarioRuns: [],
      aggregatedScenarios: [aggregate("B")],
      averages: { toolCalls: 20, filesTouched: 6, regressionCycles: 0, tokenUsage: 20_000 },
    },
  },
  ratios: { toolCalls: 2, filesTouched: 2, regressionArea: null, tokenUsage: 2 },
  ratioLabels: { toolCalls: "2.00x", filesTouched: "2.00x", regressionArea: "n/a", tokenUsage: "2.00x" },
  scenarios: [scenario],
};

let progressHandler: ((event: ProgressEvent) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  progressHandler = null;
  api.startDemoAnalysis.mockResolvedValue({ analysisId: "analysis-ui" });
  api.getAnalysis.mockResolvedValue({ status: "running", analysisId: "analysis-ui" });
  api.subscribeToProgress.mockImplementation((_analysisId: string, onEvent: (event: ProgressEvent) => void) => {
    progressHandler = onEvent;
    return () => undefined;
  });
});

describe("App workspace navigation", () => {
  it("renders real sidebar buttons and changes the main view without starting an analysis", () => {
    render(<App />);

    for (const label of ["Overview", "Future Scenarios", "Experiments", "Comparisons", "Reports", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "Future Scenarios" }));
    expect(screen.getByRole("heading", { name: "Future Scenarios" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Future Scenarios" }).getAttribute("aria-current")).toBe("page");
  });

  it("switches to Experiments when an analysis starts", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start Analysis/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Stress-testing future changes" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Experiments" }).getAttribute("aria-current")).toBe("page");
  });

  it("renders two simultaneous candidate runs, runtime concurrency, and observed action timelines", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start Analysis/i }));
    await waitFor(() => expect(progressHandler).not.toBeNull());

    act(() => {
      progressHandler?.({ type: "analysis_started", analysisId: "analysis-ui", timestampMs: 1, detail: { concurrency: 2, model: "deepseek/deepseek-v4-flash-0731", provider: "OpenRouter", requestTimeoutMs: 90_000 } });
      progressHandler?.({ type: "scenario_started", analysisId: "analysis-ui", scenarioId: "FR-03", timestampMs: 2 });
      progressHandler?.({ type: "candidate_started", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 3 });
      progressHandler?.({ type: "candidate_started", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "B", trial: 1, timestampMs: 4 });
      progressHandler?.({ type: "agent_activity", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 5, detail: { action: "reading", label: "src/notification-service.ts", toolCallsExecuted: 14, maxToolCalls: 35, testCycles: 2, maxTestCycles: 8 } });
      progressHandler?.({ type: "agent_activity", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "B", trial: 1, timestampMs: 6, detail: { action: "testing", label: "pnpm test", toolCallsExecuted: 11, maxToolCalls: 35, testCycles: 3, maxTestCycles: 8 } });
    });

    expect(screen.getByText("Concurrency 2")).toBeTruthy();
    expect(screen.getByText("Active runs 2 / 2")).toBeTruthy();
    expect(screen.getAllByText("Candidate A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Candidate B").length).toBeGreaterThan(0);
    expect(screen.getByText("Reading")).toBeTruthy();
    expect(screen.getByText("Testing")).toBeTruthy();
    expect(screen.getByText("Per-user notification preferences")).toBeTruthy();
    expect(screen.queryByText(/sk-or-/i)).toBeNull();
  });

  it("switches to Reports on completion and preserves the report across manual navigation", async () => {
    api.getAnalysis.mockResolvedValue({ status: "completed", analysisId: "analysis-ui", report: completedReport });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start Analysis/i }));
    await waitFor(() => expect(progressHandler).not.toBeNull());

    act(() => progressHandler?.({ type: "analysis_completed", analysisId: "analysis-ui" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Analysis Report" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Reports" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByRole("heading", { name: "Analysis complete" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reports" }));
    expect(screen.getByRole("heading", { name: "Analysis Report" })).toBeTruthy();
  });
});
