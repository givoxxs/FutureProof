export type CandidateId = "A" | "B";
export type AgentActivityAction = "thinking" | "searching" | "reading" | "editing" | "testing" | "repairing" | "done" | "failed";

export interface ProgressDetail extends Record<string, unknown> {
  model?: string;
  provider?: string;
  concurrency?: number;
  requestTimeoutMs?: number;
  agentEventType?: "model_turn" | "tool_call" | "tool_result" | "budget" | "terminal";
  action?: AgentActivityAction;
  tool?: string;
  label?: string;
  toolCallsExecuted?: number;
  maxToolCalls?: number;
  testCycles?: number;
  maxTestCycles?: number;
  totalTokens?: number;
  maxTokens?: number;
  error?: string;
}

export interface ProgressEvent {
  type: "analysis_started" | "scenario_started" | "candidate_started" | "agent_activity" | "candidate_completed" | "scenario_completed" | "analysis_completed" | "analysis_failed";
  analysisId: string;
  scenarioId?: string;
  candidateId?: CandidateId;
  trial?: number;
  timestampMs?: number;
  detail?: ProgressDetail;
}

export type AnalysisState =
  | { status: "running"; analysisId: string }
  | { status: "completed"; analysisId: string; report: any }
  | { status: "failed"; analysisId: string; error: string };

async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Preserve HTTP status when the response is not JSON.
    }
    throw new Error(message);
  }
  return await response.json() as T;
}

export async function startDemoAnalysis(): Promise<{ analysisId: string }> {
  return await json("/api/analyses/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export async function getAnalysis(analysisId: string): Promise<AnalysisState> {
  return await json(`/api/analyses/${encodeURIComponent(analysisId)}`);
}

export async function getScenarioDetail(analysisId: string, scenarioId: string): Promise<any> {
  return await json(`/api/analyses/${encodeURIComponent(analysisId)}/scenarios/${encodeURIComponent(scenarioId)}`);
}

export function subscribeToProgress(
  analysisId: string,
  onEvent: (event: ProgressEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(`/api/analyses/${encodeURIComponent(analysisId)}/events`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as ProgressEvent);
    } catch {
      // Ignore malformed SSE frames; the terminal GET remains the source of truth.
    }
  };
  source.onerror = (error) => onError?.(error);
  return () => source.close();
}

export async function getArtifact(args: {
  analysisId: string;
  scenarioId: string;
  candidateId: CandidateId;
  trial: number;
  kind: "patch" | "events";
}): Promise<string> {
  const url = `/api/analyses/${encodeURIComponent(args.analysisId)}/scenarios/${encodeURIComponent(args.scenarioId)}/candidates/${args.candidateId}/trials/${args.trial}/artifacts/${args.kind}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Artifact unavailable (${response.status})`);
  return await response.text();
}
