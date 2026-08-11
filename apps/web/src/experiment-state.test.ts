import { describe, expect, it } from "vitest";
import type { ProgressEvent } from "./api";
import { deriveExperimentState } from "./experiment-state";

const events: ProgressEvent[] = [
  { type: "analysis_started", analysisId: "analysis-ui", timestampMs: 1, detail: { concurrency: 2, model: "deepseek/deepseek-v4-flash-0731", provider: "OpenRouter", requestTimeoutMs: 90_000 } },
  { type: "scenario_started", analysisId: "analysis-ui", scenarioId: "FR-03", timestampMs: 2 },
  { type: "candidate_started", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 3 },
  { type: "candidate_started", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "B", trial: 1, timestampMs: 4 },
  { type: "agent_activity", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 5, detail: { action: "reading", label: "src/notification.ts", toolCallsExecuted: 6, maxToolCalls: 35, testCycles: 1, maxTestCycles: 8, totalTokens: 4000, maxTokens: 30_000 } },
  { type: "agent_activity", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 6, detail: { action: "editing", label: "src/preferences.ts", toolCallsExecuted: 14, maxToolCalls: 35, testCycles: 2, maxTestCycles: 8, totalTokens: 8000, maxTokens: 30_000 } },
  { type: "agent_activity", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "B", trial: 1, timestampMs: 7, detail: { action: "testing", label: "pnpm test", toolCallsExecuted: 11, maxToolCalls: 35, testCycles: 3, maxTestCycles: 8, totalTokens: 9000, maxTokens: 30_000 } },
  { type: "agent_activity", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "B", trial: 1, timestampMs: 8, detail: { action: "repairing", label: "src/notification.ts", toolCallsExecuted: 12, maxToolCalls: 35, testCycles: 3, maxTestCycles: 8, totalTokens: 9500, maxTokens: 30_000 } },
];

describe("deriveExperimentState", () => {
  it("keeps both candidates active and derives budget/timeline state from interleaved SSE", () => {
    const model = deriveExperimentState(events);
    const fr03 = model.scenarios["FR-03"]!;

    expect(model.concurrency).toBe(2);
    expect(model.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(model.activeRuns).toBe(2);
    expect(fr03.candidates.A.status).toBe("running");
    expect(fr03.candidates.B.status).toBe("running");
    expect(fr03.candidates.A.toolCalls).toBe(14);
    expect(fr03.candidates.B.testCycles).toBe(3);
    expect(fr03.candidates.B.timeline.at(-1)?.action).toBe("repairing");
    expect(fr03.candidates.A.progress).toBeLessThan(100);
  });

  it("marks a completed run at one hundred percent", () => {
    const model = deriveExperimentState([
      ...events,
      { type: "agent_activity", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 9, detail: { action: "done", toolCallsExecuted: 15, maxToolCalls: 35, testCycles: 2, maxTestCycles: 8, totalTokens: 10_000, maxTokens: 30_000 } },
      { type: "candidate_completed", analysisId: "analysis-ui", scenarioId: "FR-03", candidateId: "A", trial: 1, timestampMs: 10 },
    ]);
    const fr03 = model.scenarios["FR-03"]!;

    expect(fr03.candidates.A.status).toBe("done");
    expect(fr03.candidates.A.progress).toBe(100);
    expect(model.activeRuns).toBe(1);
  });
});
