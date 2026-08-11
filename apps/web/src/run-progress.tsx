import React, { useMemo } from "react";
import type { CandidateId, ProgressEvent } from "./api";
import { deriveExperimentState, DISPLAY_SCENARIOS, type CandidateExperimentState } from "./experiment-state";

function titleCase(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function StatusBadge({ status }: { status: CandidateExperimentState["status"] }) {
  return <span className={`run-status run-status-${status}`}><span aria-hidden="true" />{titleCase(status)}</span>;
}

function CandidatePanel({ candidateId, state }: { candidateId: CandidateId; state: CandidateExperimentState }) {
  return <article className={`experiment-candidate experiment-candidate-${candidateId.toLowerCase()}`}>
    <header className="experiment-candidate-header">
      <div className="candidate-title-row"><span className={`candidate-avatar candidate-avatar-${candidateId.toLowerCase()}`}>{candidateId}</span><div><strong>Candidate {candidateId}</strong><small>Trial {state.trial}</small></div></div>
      <StatusBadge status={state.status} />
    </header>

    <div className="experiment-metrics">
      <div><span>Tool calls</span><strong>{state.toolCalls}<em> / {state.maxToolCalls}</em></strong></div>
      <div><span>Test cycles</span><strong>{state.testCycles}<em> / {state.maxTestCycles}</em></strong></div>
      <div><span>Tokens</span><strong>{state.totalTokens.toLocaleString()}<em> / {state.maxTokens.toLocaleString()}</em></strong></div>
    </div>

    <div className="budget-progress" aria-label={`Candidate ${candidateId} budget progress ${state.progress}%`}>
      <div className="budget-progress-label"><span>Budget-derived progress</span><strong>{state.progress}%</strong></div>
      <div className="budget-progress-track"><span style={{ width: `${state.progress}%` }} /></div>
    </div>

    <div className="agent-timeline">
      <div className="timeline-heading"><span>Observed agent activity</span><small>latest events</small></div>
      {state.timeline.length === 0 ? <div className="timeline-empty">Waiting for the first model/tool event…</div> : state.timeline.map((entry, index) => <div className="timeline-row" key={`${entry.timestampMs}-${index}`}>
        <time>{formatTime(entry.timestampMs)}</time>
        <span className={`timeline-action timeline-${entry.action}`}><i aria-hidden="true" />{titleCase(entry.action)}</span>
        <code title={entry.label}>{entry.label ?? "—"}</code>
      </div>)}
    </div>
  </article>;
}

export function RunProgress({ analysisId, events }: { analysisId: string; events: ProgressEvent[] }) {
  const model = useMemo(() => deriveExperimentState(events), [events]);
  const activeScenario = model.scenarios[model.activeScenarioId ?? ""]
    ?? DISPLAY_SCENARIOS.map((scenario) => model.scenarios[scenario.id]).find((scenario) => scenario?.status === "running")
    ?? model.scenarios["FR-01"]!;

  return <section className="experiment-page">
    <header className="workspace-page-header experiment-page-header">
      <div><p className="eyebrow">Live controlled experiment</p><h1>Stress-testing future changes</h1><p>Independent sandboxes run the same frozen requirement against both candidates. Progress reflects observed budget usage, not predicted model completion.</p></div>
      <div className="analysis-identity"><span>Analysis</span><code>{analysisId.slice(0, 8)}</code></div>
    </header>

    <div className="experiment-workbench">
      <aside className="scenario-rail" aria-label="Scenario execution status">
        <div className="scenario-rail-heading"><span>Scenarios</span><strong>{model.completedScenarios} / {DISPLAY_SCENARIOS.length}</strong></div>
        {DISPLAY_SCENARIOS.map((definition) => {
          const scenario = model.scenarios[definition.id]!;
          const active = scenario.id === activeScenario.id;
          return <div key={scenario.id} className={`scenario-rail-item ${active ? "active" : ""}`}>
            <span className={`scenario-state-dot scenario-${scenario.status}`} aria-hidden="true" />
            <div><code>{scenario.id}</code><strong>{scenario.shortTitle}</strong><small>{scenario.note}</small></div>
            <span className="scenario-state-text">{titleCase(scenario.status)}</span>
          </div>;
        })}
      </aside>

      <div className="experiment-stage">
        <header className="experiment-scenario-header">
          <div><code>{activeScenario.id}</code><h2>{activeScenario.title}</h2></div>
          <span className={`scenario-stage-status scenario-stage-${activeScenario.status}`}>{titleCase(activeScenario.status)}</span>
        </header>
        <div className="candidate-parallel-grid">
          <CandidatePanel candidateId="A" state={activeScenario.candidates.A} />
          <CandidatePanel candidateId="B" state={activeScenario.candidates.B} />
        </div>
      </div>
    </div>

    <footer className="experiment-runtime-footer">
      <span><i className="runtime-dot" aria-hidden="true" />Concurrency {model.concurrency}</span>
      <span>Active runs {model.activeRuns} / {model.concurrency}</span>
      <span className="runtime-model">Model <code>{model.model}</code></span>
    </footer>
  </section>;
}
