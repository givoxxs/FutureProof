import type { AgentActivityAction, CandidateId, ProgressEvent } from "./api";

export const DISPLAY_SCENARIOS = [
  { id: "FR-01", title: "SMS alternative channel", shortTitle: "SMS channel", note: "Breadth · 1 trial" },
  { id: "FR-02", title: "Retry with exponential backoff", shortTitle: "Retry & backoff", note: "Reliability · 1 trial" },
  { id: "FR-03", title: "Per-user notification preferences", shortTitle: "User preferences", note: "Policy · 1 trial" },
  { id: "FR-04", title: "Idempotent duplicate delivery", shortTitle: "Idempotent delivery", note: "Correctness · 3 trials" },
  { id: "FR-05", title: "Scheduled delivery / quiet hours", shortTitle: "Quiet hours", note: "Temporal · 1 trial" },
] as const;

export type ExperimentRunStatus = "queued" | "running" | "done" | "failed";
export type ExperimentScenarioStatus = "queued" | "running" | "completed";

export interface TimelineEntry {
  action: AgentActivityAction;
  label?: string;
  timestampMs: number;
  trial: number;
}

export interface CandidateExperimentState {
  status: ExperimentRunStatus;
  trial: number;
  toolCalls: number;
  maxToolCalls: number;
  testCycles: number;
  maxTestCycles: number;
  totalTokens: number;
  maxTokens: number;
  progress: number;
  timeline: TimelineEntry[];
}

export interface ScenarioExperimentState {
  id: string;
  title: string;
  shortTitle: string;
  note: string;
  status: ExperimentScenarioStatus;
  candidates: Record<CandidateId, CandidateExperimentState>;
}

export interface ExperimentViewModel {
  concurrency: number;
  model: string;
  provider: string;
  requestTimeoutMs?: number;
  activeRuns: number;
  completedScenarios: number;
  activeScenarioId?: string;
  scenarios: Record<string, ScenarioExperimentState>;
}

function candidateInitial(): CandidateExperimentState {
  return {
    status: "queued",
    trial: 1,
    toolCalls: 0,
    maxToolCalls: 35,
    testCycles: 0,
    maxTestCycles: 8,
    totalTokens: 0,
    maxTokens: 30_000,
    progress: 0,
    timeline: [],
  };
}

function scenarioInitial(scenario: (typeof DISPLAY_SCENARIOS)[number]): ScenarioExperimentState {
  return {
    ...scenario,
    status: "queued",
    candidates: { A: candidateInitial(), B: candidateInitial() },
  };
}

function numberDetail(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function runningProgress(candidate: CandidateExperimentState): number {
  const toolRatio = candidate.maxToolCalls > 0 ? candidate.toolCalls / candidate.maxToolCalls : 0;
  const testRatio = candidate.maxTestCycles > 0 ? candidate.testCycles / candidate.maxTestCycles : 0;
  return Math.min(96, Math.max(0, Math.round(Math.max(toolRatio, testRatio) * 100)));
}

function refreshProgress(candidate: CandidateExperimentState) {
  candidate.progress = candidate.status === "done" || candidate.status === "failed"
    ? 100
    : candidate.status === "running"
      ? runningProgress(candidate)
      : 0;
}

export function deriveExperimentState(events: ProgressEvent[]): ExperimentViewModel {
  const scenarios = Object.fromEntries(DISPLAY_SCENARIOS.map((scenario) => [scenario.id, scenarioInitial(scenario)])) as Record<string, ScenarioExperimentState>;
  let concurrency = 2;
  let model = "Configured on server";
  let provider = "OpenRouter";
  let requestTimeoutMs: number | undefined;
  let activeScenarioId: string | undefined;

  for (const event of events) {
    if (event.type === "analysis_started") {
      concurrency = numberDetail(event.detail?.concurrency, concurrency);
      if (typeof event.detail?.model === "string") model = event.detail.model;
      if (typeof event.detail?.provider === "string") provider = event.detail.provider;
      if (typeof event.detail?.requestTimeoutMs === "number") requestTimeoutMs = event.detail.requestTimeoutMs;
      continue;
    }

    const scenario = event.scenarioId ? scenarios[event.scenarioId] : undefined;
    if (!scenario) continue;

    if (event.type === "scenario_started") {
      scenario.status = "running";
      activeScenarioId = scenario.id;
      continue;
    }

    if (event.type === "scenario_completed") {
      scenario.status = "completed";
      if (activeScenarioId === scenario.id) {
        activeScenarioId = DISPLAY_SCENARIOS.find((item) => scenarios[item.id].status === "running")?.id;
      }
      continue;
    }

    const candidateId = event.candidateId;
    if (!candidateId) continue;
    const candidate = scenario.candidates[candidateId];
    candidate.trial = event.trial ?? candidate.trial;

    if (event.type === "candidate_started") {
      candidate.status = "running";
      scenario.status = "running";
      activeScenarioId = scenario.id;
      refreshProgress(candidate);
      continue;
    }

    if (event.type === "agent_activity") {
      candidate.toolCalls = numberDetail(event.detail?.toolCallsExecuted, candidate.toolCalls);
      candidate.maxToolCalls = numberDetail(event.detail?.maxToolCalls, candidate.maxToolCalls);
      candidate.testCycles = numberDetail(event.detail?.testCycles, candidate.testCycles);
      candidate.maxTestCycles = numberDetail(event.detail?.maxTestCycles, candidate.maxTestCycles);
      candidate.totalTokens = numberDetail(event.detail?.totalTokens, candidate.totalTokens);
      candidate.maxTokens = numberDetail(event.detail?.maxTokens, candidate.maxTokens);
      const action = event.detail?.action;
      if (typeof action === "string") {
        const typedAction = action as AgentActivityAction;
        if (typedAction === "done") candidate.status = "done";
        else if (typedAction === "failed") candidate.status = "failed";
        else if (candidate.status === "queued") candidate.status = "running";
        candidate.timeline.push({
          action: typedAction,
          label: typeof event.detail?.label === "string" ? event.detail.label : undefined,
          timestampMs: event.timestampMs ?? Date.now(),
          trial: event.trial ?? candidate.trial,
        });
        if (candidate.timeline.length > 12) candidate.timeline.splice(0, candidate.timeline.length - 12);
      }
      scenario.status = scenario.status === "completed" ? "completed" : "running";
      activeScenarioId = scenario.status === "running" ? scenario.id : activeScenarioId;
      refreshProgress(candidate);
      continue;
    }

    if (event.type === "candidate_completed") {
      if (candidate.status !== "failed") candidate.status = "done";
      refreshProgress(candidate);
    }
  }

  let activeRuns = 0;
  let completedScenarios = 0;
  for (const scenario of Object.values(scenarios)) {
    if (scenario.status === "completed") completedScenarios += 1;
    for (const candidate of Object.values(scenario.candidates)) {
      if (candidate.status === "running") activeRuns += 1;
      refreshProgress(candidate);
    }
  }

  return { concurrency, model, provider, requestTimeoutMs, activeRuns, completedScenarios, activeScenarioId, scenarios };
}
