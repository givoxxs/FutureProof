import React, { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScenarioDrawer } from "./scenario-drawer";

afterEach(cleanup);

const detail = {
  scenario: {
    id: "FR-04",
    title: "Provider Fallback (Email → SMS)",
    difficulty: "hard",
    dimension: "composition",
    requirement: "If the primary email provider fails, automatically fall back to the secondary provider.",
    rationale: "Provider failure already exists in the current requirement.",
    affectedCapability: "email delivery",
    externalDependencies: false,
    provenance: ["current-requirement.md: provider failures propagate", "base/src/index.ts: one email provider"],
    acceptance: [
      { name: "fallback", given: "primary provider is unavailable", when: "shipment notification runs", then: "secondary provider sends the message" },
      { name: "primary", given: "primary provider is available", when: "shipment notification runs", then: "secondary provider is not called" },
    ],
  },
  candidates: {
    A: { scenarioId: "FR-04", status: "SUCCESS", trialCount: 1, metrics: { toolCalls: 11, filesTouched: 3, editOps: 2, testRuns: 2, tokenUsage: 9_100, regressionArea: 1, failedRegressionSnapshots: 1, structuralDelta: { cyclomaticComplexity: 3, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 2 }, structuralMagnitude: 3.1 } },
    B: { scenarioId: "FR-04", status: "FAIL", trialCount: 1, metrics: { toolCalls: 35, filesTouched: 9, editOps: 7, testRuns: 8, tokenUsage: 26_300, regressionArea: 9, failedRegressionSnapshots: 7, structuralDelta: { cyclomaticComplexity: 12, duplicateLineWindows: 1, dependencyFanOut: 1, fileSizeLines: 14 }, structuralMagnitude: 13.7 } },
  },
  rawRuns: {
    A: [{ trial: 1, status: "SUCCESS", remainingFailures: [], metrics: { regressionSnapshots: [{ cycle: 1, passed: 23, failed: 1 }, { cycle: 2, passed: 24, failed: 0 }] } }],
    B: [{ trial: 1, status: "FAIL", remainingFailures: ["FR-04 uses secondary provider after primary failure"], metrics: { regressionSnapshots: [{ cycle: 1, passed: 17, failed: 7 }, { cycle: 2, passed: 22, failed: 2 }] } }],
  },
};

function Harness({ loader = vi.fn(async () => "artifact body") }: { loader?: (candidate: "A" | "B", kind: "patch" | "events") => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={triggerRef} onClick={() => setOpen(true)}>Open FR-04</button>
    {open ? <ScenarioDrawer analysisId="analysis-ui" detail={detail as any} triggerRef={triggerRef} onClose={() => setOpen(false)} loadArtifact={loader} /> : null}
  </>;
}

describe("ScenarioDrawer", () => {
  it("shows requirement, provenance, acceptance evidence, A/B metrics, regressions, and remaining failures", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open FR-04" }));

    expect(screen.getByRole("dialog", { name: /scenario detail/i })).toBeTruthy();
    expect(screen.getByText(/primary email provider fails/i)).toBeTruthy();
    expect(screen.getByText(/current-requirement.md/i)).toBeTruthy();
    expect(screen.getByText(/secondary provider sends/i)).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText("35")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("9.1k")).toBeTruthy();
    expect(screen.getByText("26.3k")).toBeTruthy();
    expect(screen.getByText(/7 → 2/)).toBeTruthy();
    expect(screen.getByText(/uses secondary provider after primary failure/i)).toBeTruthy();
  });

  it("closes on Escape and returns focus to the triggering button", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open FR-04" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("loads patch and tool-event artifacts through opaque identifiers, never filesystem paths", async () => {
    const loader = vi.fn(async () => "artifact body");
    render(<Harness loader={loader} />);
    fireEvent.click(screen.getByRole("button", { name: "Open FR-04" }));
    fireEvent.click(screen.getByRole("button", { name: /view candidate b patch/i }));
    expect(await screen.findByText("artifact body")).toBeTruthy();
    expect(loader).toHaveBeenCalledWith("B", "patch");
  });
});
