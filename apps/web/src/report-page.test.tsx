import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReportPage } from "./report-page";

afterEach(cleanup);

const scenarios = ([
  ["FR-01", "Add SMS Notifications", "medium"],
  ["FR-02", "User Notification Preferences", "medium"],
  ["FR-03", "Retry Failed Delivery", "medium"],
  ["FR-04", "Provider Fallback (Email → SMS)", "hard"],
  ["FR-05", "Add Push Notifications", "easy"],
] as const).map(([id, title, difficulty]) => ({
  id,
  title,
  difficulty,
  dimension: "breadth",
  requirement: title,
  rationale: "Plausible future evolution",
  affectedCapability: "notifications",
  externalDependencies: false,
  provenance: ["current requirement"],
  acceptance: [{ name: "works", given: "a shipment", when: "notification runs", then: "behavior passes" }],
}));

function aggregate(scenarioId: string, status: string, toolCalls: number, filesTouched: number, regressionCycles: number, tokenUsage: number, structural: number) {
  return {
    scenarioId,
    status,
    trialCount: 1,
    metrics: {
      toolCalls,
      filesTouched,
      editOps: 2,
      testRuns: regressionCycles + 1,
      tokenUsage,
      regressionArea: regressionCycles,
      failedRegressionSnapshots: regressionCycles,
      structuralDelta: { cyclomaticComplexity: structural, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 0 },
      structuralMagnitude: structural,
    },
  };
}

const report = {
  analysisId: "analysis-ui",
  candidates: {
    A: {
      candidateId: "A",
      baseline: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 4, efficiencyRisk: 18, regressionRisk: 10, structuralRisk: 12, overallRisk: 18 },
      scenarioRuns: [],
      aggregatedScenarios: scenarios.map((scenario, index) => aggregate(scenario.id, "SUCCESS", 10 + index, 3 + (index % 2), index % 2, 10_000 + index * 700, index === 3 ? 5 : 2)),
      averages: { toolCalls: 12.6, filesTouched: 3.6, regressionCycles: 1.2, tokenUsage: 11_400 },
    },
    B: {
      candidateId: "B",
      baseline: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 60, efficiencyRisk: 82, regressionRisk: 77, structuralRisk: 76, overallRisk: 74 },
      scenarioRuns: [],
      aggregatedScenarios: [
        aggregate("FR-01", "SUCCESS", 20, 7, 2, 21_000, 8),
        aggregate("FR-02", "PARTIAL", 24, 8, 3, 23_000, 10),
        aggregate("FR-03", "FAIL", 30, 9, 5, 29_000, 13),
        aggregate("FR-04", "FAIL", 35, 12, 7, 31_000, 18),
        aggregate("FR-05", "SUCCESS", 24, 8, 4, 25_000, 14),
      ],
      averages: { toolCalls: 26.7, filesTouched: 8.9, regressionCycles: 4.3, tokenUsage: 25_800 },
    },
  },
  ratios: { toolCalls: 2.12, filesTouched: 2.47, regressionArea: 3.58, tokenUsage: 2.26 },
  ratioLabels: { toolCalls: "2.12x", filesTouched: "2.47x", regressionArea: "3.58x", tokenUsage: "2.26x" },
  scenarios,
};

describe("ReportPage", () => {
  it("renders current-test evidence, risks, six evidence metrics, and all five future scenarios", () => {
    render(<ReportPage report={report as any} onOpenScenario={vi.fn()} />);

    expect(screen.getAllByText(/PR #42/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PR #84/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("22/22 tests")).toHaveLength(2);
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("74")).toBeTruthy();
    expect(screen.getByText("5 / 5")).toBeTruthy();
    expect(screen.getByText("2 / 5")).toBeTruthy();
    expect(screen.getByText("12.6")).toBeTruthy();
    expect(screen.getByText("26.7")).toBeTruthy();
    expect(screen.getByText("3.6")).toBeTruthy();
    expect(screen.getByText("8.9")).toBeTruthy();
    expect(screen.getByText("1.2")).toBeTruthy();
    expect(screen.getByText("4.3")).toBeTruthy();
    expect(screen.getByText("11.4k")).toBeTruthy();
    expect(screen.getByText("25.8k")).toBeTruthy();
    expect(screen.getByText(/Structural Delta/i)).toBeTruthy();
    for (const scenario of scenarios) expect(screen.getByText(scenario.title)).toBeTruthy();
  });

  it("uses real buttons for scenario detail interactions", () => {
    const onOpenScenario = vi.fn();
    render(<ReportPage report={report as any} onOpenScenario={onOpenScenario} />);
    fireEvent.click(screen.getByRole("button", { name: /view details for provider fallback/i }));
    expect(onOpenScenario).toHaveBeenCalledWith("FR-04", expect.anything());
  });

  it("downloads the deterministic server report bundle instead of rebuilding a browser blob", () => {
    render(<ReportPage report={report as any} onOpenScenario={vi.fn()} />);
    const exportLink = screen.getByRole("link", { name: "Export" });
    expect(exportLink.getAttribute("href")).toBe("/api/analyses/analysis-ui/exports/report.json");
    expect(exportLink.getAttribute("download")).toBe("futureproof-analysis-ui.json");
  });
});
