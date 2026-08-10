import React, { useCallback, useEffect, useRef, useState } from "react";
import { getAnalysis, getArtifact, getScenarioDetail, startDemoAnalysis, subscribeToProgress, type ProgressEvent } from "./api";
import { ReportPage } from "./report-page";
import { RunProgress } from "./run-progress";
import { ScenarioDrawer } from "./scenario-drawer";

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>;
}

const navigation = [
  ["Overview", "⌂"],
  ["Future Scenarios", "◈"],
  ["Experiments", "▣"],
  ["Comparisons", "⌁"],
  ["Reports", "▤"],
  ["Settings", "⚙"],
] as const;

function Sidebar({ active, onNewAnalysis }: { active: "setup" | "run" | "report"; onNewAnalysis: () => void }) {
  const activeLabel = active === "run" ? "Experiments" : active === "report" ? "Reports" : "Overview";
  return <aside className="app-sidebar">
    <div className="brand"><BrandMark /><div><strong>FutureProof</strong></div></div>
    <button className="new-analysis-button" type="button" disabled={active === "run"} onClick={onNewAnalysis}>＋ New Analysis</button>
    <nav aria-label="Primary navigation">
      {navigation.map(([label, icon]) => <span key={label} className={label === activeLabel ? "nav-item active" : "nav-item"} aria-current={label === activeLabel ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</span>)}
    </nav>
    <div className="sidebar-analysis">
      <span className="sidebar-method-label">Active analysis</span>
      <strong>Notification System PR</strong>
      <p>PR #42 vs PR #84</p>
      <span className="analysis-live"><span aria-hidden="true" />same base requirement</span>
    </div>
    <div className="sidebar-footer"><span className="shield-icon" aria-hidden="true">✓</span><span>Frozen scenarios<br />Evidence-backed results</span></div>
  </aside>;
}

function SetupPage({ onStart, busy, error }: { onStart: () => void; busy: boolean; error: string | null }) {
  return <div className="setup-page">
    <header className="setup-header"><p className="eyebrow">Reverie Hacks 2026 · Software Engineering</p><h1>Which implementation will age better?</h1><p>Both candidate PRs pass today's tests. FutureProof applies plausible future requirements and measures which architecture makes tomorrow's work harder.</p></header>
    <section className="setup-grid">
      <div className="setup-panel">
        <div className="panel-number">01</div><div><span className="panel-label">Base requirement</span><h2>Shipment notification delivery tracking</h2><p>Send shipment email and record whether delivery succeeded or failed.</p></div>
      </div>
      <div className="candidate-setup candidate-a">
        <div className="candidate-setup-head"><span>Candidate A</span><strong>PR #42</strong></div><h3>Decoupled delivery tracking</h3><p>Sending and tracking responsibilities remain separate while preserving current behavior.</p><div className="setup-proof"><span>Current tests</span><strong>22 / 22 ✓</strong></div>
      </div>
      <div className="candidate-setup candidate-b">
        <div className="candidate-setup-head"><span>Candidate B</span><strong>PR #84</strong></div><h3>Inline coupled tracking</h3><p>A plausible small-feature implementation couples delivery, provider identity, tracking and failure flow.</p><div className="setup-proof"><span>Current tests</span><strong>22 / 22 ✓</strong></div>
      </div>
    </section>
    <section className="experiment-contract">
      <div><span>Future scenarios</span><strong>5 frozen tasks</strong></div>
      <div><span>Fairness</span><strong>Same model + budget</strong></div>
      <div><span>Evidence</span><strong>Tests + edits + regression</strong></div>
      <div><span>Hard scenario</span><strong>3 repeated trials</strong></div>
    </section>
    <div className="start-row"><div><strong>Ready to run the controlled experiment</strong><span>Live execution requires configured LLM credentials on the API server.</span>{error ? <span role="alert" className="setup-error">{error}</span> : null}</div><button className="primary-button start-button" type="button" disabled={busy} onClick={onStart}>{busy ? "Starting…" : "Start Analysis →"}</button></div>
  </div>;
}

export function App() {
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [report, setReport] = useState<any>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<any>(null);
  const [drawerScenarioId, setDrawerScenarioId] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const refreshTerminalState = useCallback(async (id: string) => {
    const next = await getAnalysis(id);
    if (next.status === "completed") {
      setReport(next.report);
      setState("completed");
    } else if (next.status === "failed") {
      setError(next.error);
      setState("failed");
    }
  }, []);

  useEffect(() => {
    if (!analysisId || state !== "running") return;
    const unsubscribe = subscribeToProgress(analysisId, (event) => {
      setEvents((current) => [...current, event]);
      if (event.type === "analysis_completed" || event.type === "analysis_failed") {
        void refreshTerminalState(analysisId);
      }
    }, () => {
      window.setTimeout(() => void refreshTerminalState(analysisId), 500);
    });
    return unsubscribe;
  }, [analysisId, refreshTerminalState, state]);

  const reset = () => {
    setAnalysisId(null);
    setState("idle");
    setReport(null);
    setEvents([]);
    setError(null);
    setDrawerDetail(null);
    setDrawerScenarioId(null);
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    setEvents([]);
    setReport(null);
    setDrawerDetail(null);
    setDrawerScenarioId(null);
    try {
      const created = await startDemoAnalysis();
      setAnalysisId(created.analysisId);
      setState("running");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
      setState("idle");
    } finally {
      setStarting(false);
    }
  };

  const openScenario = async (scenarioId: string, trigger: HTMLButtonElement) => {
    if (!analysisId) return;
    triggerRef.current = trigger;
    setDrawerScenarioId(scenarioId);
    setDrawerLoading(true);
    setDrawerDetail(null);
    try {
      setDrawerDetail(await getScenarioDetail(analysisId, scenarioId));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : String(detailError));
      setDrawerScenarioId(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const closeDrawer = () => {
    setDrawerScenarioId(null);
    setDrawerDetail(null);
  };

  const active = state === "running" ? "run" : state === "completed" ? "report" : "setup";
  return <div className="app-shell">
    <Sidebar active={active} onNewAnalysis={reset} />
    <main className="app-main">
      {state === "idle" ? <SetupPage onStart={() => void start()} busy={starting} error={error} /> : null}
      {state === "running" && analysisId ? <RunProgress analysisId={analysisId} events={events} /> : null}
      {state === "failed" ? <div className="failure-page"><p className="eyebrow">Analysis stopped</p><h1>The experiment could not complete.</h1><p>{error}</p><button className="primary-button" type="button" onClick={reset}>Return to setup</button></div> : null}
      {state === "completed" && report ? <ReportPage report={report} onRerun={() => void start()} onOpenScenario={(scenarioId, trigger) => void openScenario(scenarioId, trigger)} /> : null}
    </main>
    {drawerLoading && drawerScenarioId ? <div className="drawer-loading" role="status">Loading scenario evidence…</div> : null}
    {analysisId && drawerScenarioId && drawerDetail ? <ScenarioDrawer
      analysisId={analysisId}
      detail={drawerDetail}
      triggerRef={triggerRef}
      onClose={closeDrawer}
      loadArtifact={async (candidateId, kind) => {
        const trial = drawerDetail.rawRuns?.[candidateId]?.[0]?.trial ?? 1;
        return await getArtifact({ analysisId, scenarioId: drawerScenarioId, candidateId, trial, kind });
      }}
    /> : null}
  </div>;
}
