import React from "react";
import type { ProgressEvent } from "./api";

const SCENARIOS = [
  { id: "FR-01", title: "Add SMS notifications", difficulty: "Medium" },
  { id: "FR-02", title: "User notification preferences", difficulty: "Medium" },
  { id: "FR-03", title: "Retry failed delivery", difficulty: "Medium" },
  { id: "FR-04", title: "Provider fallback", difficulty: "Hard · 3 trials" },
  { id: "FR-05", title: "Add push notifications", difficulty: "Easy" },
];

function stateFor(events: ProgressEvent[], scenarioId: string, candidateId: "A" | "B") {
  if (events.some((event) => event.type === "candidate_completed" && event.scenarioId === scenarioId && event.candidateId === candidateId)) return "done";
  if (events.some((event) => event.type === "candidate_started" && event.scenarioId === scenarioId && event.candidateId === candidateId)) return "running";
  return "pending";
}

function RunState({ state }: { state: "pending" | "running" | "done" }) {
  if (state === "done") return <span className="run-state done"><span aria-hidden="true">✓</span> Complete</span>;
  if (state === "running") return <span className="run-state running"><span className="mini-spinner" aria-hidden="true" /> Running</span>;
  return <span className="run-state pending">Queued</span>;
}

export function RunProgress({ analysisId, events }: { analysisId: string; events: ProgressEvent[] }) {
  const completedScenarios = new Set(events.filter((event) => event.type === "scenario_completed").map((event) => event.scenarioId)).size;
  return <div className="run-progress-page">
    <header className="run-progress-header">
      <div><p className="eyebrow">Analysis {analysisId.slice(0, 8)}</p><h1>Stress-testing future changes</h1><p>FutureProof is applying the same frozen requirements to both candidate implementations under the same execution budget.</p></div>
      <div className="progress-ring" aria-label={`${completedScenarios} of ${SCENARIOS.length} scenarios complete`}><strong>{completedScenarios}</strong><span>/ {SCENARIOS.length}</span></div>
    </header>

    <section className="control-proof">
      <div><span>Scenario source</span><strong>Blind · base only</strong></div>
      <div><span>Agent model</span><strong>Same model A/B</strong></div>
      <div><span>Tool budget</span><strong>35 calls</strong></div>
      <div><span>Token budget</span><strong>30k tokens</strong></div>
      <div><span>Current tests</span><strong>22/22 both candidates</strong></div>
    </section>

    <section className="progress-table-card">
      <div className="section-heading"><div><p className="eyebrow">Controlled execution</p><h2>Frozen future scenarios</h2></div><p>Candidate A and B are isolated; one run never inherits edits from another.</p></div>
      <div className="scenario-table-wrap">
        <table className="scenario-table progress-table">
          <thead><tr><th>Scenario</th><th>Difficulty</th><th>Candidate A</th><th>Candidate B</th></tr></thead>
          <tbody>{SCENARIOS.map((scenario) => <tr key={scenario.id}>
            <td><strong>{scenario.title}</strong><span className="scenario-id">{scenario.id}</span></td>
            <td><span className="difficulty">{scenario.difficulty}</span></td>
            <td><RunState state={stateFor(events, scenario.id, "A")} /></td>
            <td><RunState state={stateFor(events, scenario.id, "B")} /></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <div className="run-footnote"><span className="live-dot" aria-hidden="true" /> Live experiment evidence is recorded to immutable run artifacts.</div>
  </div>;
}
