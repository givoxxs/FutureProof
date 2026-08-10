export type ProgressEventType =
  | "analysis_started"
  | "scenario_started"
  | "candidate_started"
  | "candidate_completed"
  | "scenario_completed"
  | "analysis_completed"
  | "analysis_failed";

export interface ProgressEvent {
  type: ProgressEventType;
  analysisId: string;
  scenarioId?: string;
  candidateId?: "A" | "B";
  timestampMs?: number;
  detail?: Record<string, unknown>;
}

type Listener = (event: ProgressEvent) => void;

export class ProgressBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly history = new Map<string, ProgressEvent[]>();
  private readonly maxHistory: number;

  constructor(maxHistory = 500) {
    this.maxHistory = maxHistory;
  }

  publish(input: ProgressEvent): ProgressEvent {
    const event = { ...input, timestampMs: input.timestampMs ?? Date.now() };
    const events = this.history.get(event.analysisId) ?? [];
    events.push(event);
    if (events.length > this.maxHistory) events.splice(0, events.length - this.maxHistory);
    this.history.set(event.analysisId, events);
    for (const listener of this.listeners.get(event.analysisId) ?? []) listener(event);
    return event;
  }

  events(analysisId: string): ProgressEvent[] {
    return [...(this.history.get(analysisId) ?? [])];
  }

  subscribe(analysisId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(analysisId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(analysisId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(analysisId);
    };
  }
}
