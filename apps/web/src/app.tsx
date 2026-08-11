import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAnalysis, getArtifact, getScenarioDetail, startDemoAnalysis, subscribeToProgress, type ProgressEvent } from "./api";
import { deriveExperimentState, DISPLAY_SCENARIOS, type ExperimentViewModel } from "./experiment-state";
import { ReportPage } from "./report-page";
import { RunProgress } from "./run-progress";
import { ScenarioDrawer } from "./scenario-drawer";
import "./workspace.css";

export type AppView = "overview" | "scenarios" | "experiments" | "comparisons" | "reports" | "settings";
type AnalysisState = "idle" | "running" | "completed" | "failed";

const navigation: ReadonlyArray<{ view: AppView; label: string; icon: string }> = [
  { view: "overview", label: "Overview", icon: "⌂" },
  { view: "scenarios", label: "Future Scenarios", icon: "◇" },
  { view: "experiments", label: "Experiments", icon: "▣" },
  { view: "comparisons", label: "Comparisons", icon: "⌁" },
  { view: "reports", label: "Reports", icon: "▤" },
  { view: "settings", label: "Settings", icon: "⚙" },
];

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span /></div>;
}

function shortModel(model: string): string {
  const parts = model.split("/");
  return parts.at(-1) ?? model;
}

function Sidebar({
  view,
  analysisState,
  analysisId,
  runtime,
  onNavigate,
  onNewAnalysis,
}: {
  view: AppView;
  analysisState: AnalysisState;
  analysisId: string | null;
  runtime: ExperimentViewModel;
  onNavigate: (next: AppView) => void;
  onNewAnalysis: () => void;
}) {
  return <aside className="app-sidebar">
    <div className="brand"><BrandMark /><strong>FutureProof</strong></div>
    <button className="new-analysis-button" type="button" disabled={analysisState === "running"} onClick={onNewAnalysis}>＋ New Analysis</button>
    <nav aria-label="Primary navigation">
      {navigation.map((item) => <button key={item.view} type="button" className={item.view === view ? "nav-item active" : "nav-item"} aria-current={item.view === view ? "page" : undefined} onClick={() => onNavigate(item.view)}>
        <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
      </button>)}
    </nav>

    {analysisId ? <section className="sidebar-runtime" aria-label="Analysis runtime">
      <div className="sidebar-runtime-head"><span>Analysis</span><span className={`runtime-state runtime-state-${analysisState}`}>{analysisState}</span></div>
      <code className="runtime-id">{analysisId.slice(0, 8)}</code>
      <dl>
        <div><dt>Concurrency</dt><dd>{runtime.concurrency}</dd></div>
        <div><dt>Active runs</dt><dd>{runtime.activeRuns} / {runtime.concurrency}</dd></div>
        <div><dt>Model</dt><dd title={runtime.model}>{shortModel(runtime.model)}</dd></div>
      </dl>
    </section> : <section className="sidebar-runtime sidebar-runtime-idle"><span>Method</span><strong>Controlled A/B stress test</strong><p>Frozen scenarios · isolated sandboxes · deterministic scoring</p></section>}

    <div className="sidebar-footer"><span className="shield-icon" aria-hidden="true">✓</span><span>Observed evidence<br />No self-grading</span></div>
  </aside>;
}

function SetupPage({ onStart, busy, error }: { onStart: () => void; busy: boolean; error: string | null }) {
  return <section className="setup-page">
    <header className="workspace-page-header setup-header"><div><p className="eyebrow">Controlled architecture experiment</p><h1>Which implementation is easier to change tomorrow?</h1><p>Both candidates pass today. FutureProof applies the same plausible future requirements and measures observed modification cost under controlled conditions.</p></div><span className="method-chip">14 isolated executions</span></header>

    <div className="overview-metric-grid setup-metrics">
      <article className="overview-card"><span>Current tests · Candidate A</span><strong className="metric-success">22 / 22</strong><small>All passing</small></article>
      <article className="overview-card"><span>Current tests · Candidate B</span><strong className="metric-success">22 / 22</strong><small>All passing</small></article>
      <article className="overview-card"><span>Frozen future scenarios</span><strong>5</strong><small>Same set for A & B</small></article>
      <article className="overview-card"><span>Hard scenario</span><strong>3×</strong><small>Repeated trials</small></article>
    </div>

    <div className="candidate-intro-grid">
      <article className="candidate-intro candidate-intro-a"><div><span className="candidate-avatar candidate-avatar-a">A</span><div><small>Candidate A</small><h2>Decoupled tracking</h2></div></div><p>Delivery and tracking responsibilities remain separated while preserving current behavior.</p></article>
      <article className="candidate-intro candidate-intro-b"><div><span className="candidate-avatar candidate-avatar-b">B</span><div><small>Candidate B</small><h2>Inline coupled tracking</h2></div></div><p>Delivery, provider identity, tracking, and failure flow are implemented together in a plausible compact change.</p></article>
    </div>

    <div className="experiment-contract compact-contract"><div><span>Scenario source</span><strong>Blind · base only</strong></div><div><span>Agent</span><strong>Same model + budget</strong></div><div><span>Evidence</span><strong>Tests · edits · regressions</strong></div><div><span>Scoring</span><strong>Deterministic</strong></div></div>

    <div className="start-row"><div><strong>Ready to run the controlled experiment</strong><span>Default bounded concurrency is 2 so A/B pairs can execute side by side.</span>{error ? <span role="alert" className="setup-error">{error}</span> : null}</div><button className="primary-button start-button" type="button" disabled={busy} onClick={onStart}>{busy ? "Starting…" : "Start Analysis →"}</button></div>
  </section>;
}

function OverviewPage({ state, report, runtime, onNavigate, onStart }: { state: AnalysisState; report: any; runtime: ExperimentViewModel; onNavigate: (view: AppView) => void; onStart: () => void }) {
  if (state === "failed") return <section className="workspace-page"><p className="eyebrow">Overview</p><h1>Analysis stopped</h1><p>The last experiment did not finish. Open Experiments for the failure detail, then retry when ready.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={() => onNavigate("experiments")}>Open failure detail</button><button className="secondary-button" type="button" onClick={onStart}>Retry analysis</button></div></section>;

  const riskA = Math.round(report?.candidates?.A?.dimensions?.overallRisk ?? 0);
  const riskB = Math.round(report?.candidates?.B?.dimensions?.overallRisk ?? 0);
  const winner = report ? (riskA <= riskB ? "A" : "B") : null;
  return <section className="overview-page">
    <header className="workspace-page-header"><div><p className="eyebrow">Overview</p><h1>{state === "completed" ? "Analysis complete" : "Analysis in progress"}</h1><p>{state === "completed" ? "The controlled experiment finished. Compare observed future-change cost and inspect evidence without losing the run." : "Candidate runs are executing in isolated sandboxes. Navigate freely while the experiment continues."}</p></div><span className={`method-chip method-chip-${state}`}>{state === "running" ? "● Live" : "✓ Completed"}</span></header>

    <div className="overview-metric-grid">
      <article className="overview-card parity-card"><span>Current tests · parity</span><div className="parity-values"><strong>A&nbsp; 22 / 22</strong><strong>B&nbsp; 22 / 22</strong></div><small>Same passing baseline</small></article>
      <article className="overview-card"><span>Scenario progress</span><strong>{runtime.completedScenarios} / 5</strong><small>{runtime.activeRuns} active run{runtime.activeRuns === 1 ? "" : "s"}</small></article>
      <article className="overview-card"><span>Concurrency</span><strong>{runtime.concurrency}</strong><small>Bounded worker pool</small></article>
      <article className="overview-card"><span>{report ? "Winner · lower is better" : "Model"}</span>{report ? <strong className={`winner-value winner-${winner?.toLowerCase()}`}>Candidate {winner}</strong> : <strong className="runtime-model-value" title={runtime.model}>{shortModel(runtime.model)}</strong>}<small>{report ? `${Math.abs(riskB - riskA)} point risk gap` : runtime.provider}</small></article>
    </div>

    {report ? <div className="risk-summary-grid"><article className="risk-summary-card risk-a"><span>Candidate A · Future Risk</span><strong>{riskA}<small>/100</small></strong><div className="risk-line"><i style={{ width: `${riskA}%` }} /></div></article><article className="risk-summary-card risk-b"><span>Candidate B · Future Risk</span><strong>{riskB}<small>/100</small></strong><div className="risk-line"><i style={{ width: `${riskB}%` }} /></div></article></div> : <div className="live-overview-callout"><span className="runtime-dot" aria-hidden="true" /><div><strong>Parallel experiment running</strong><p>Open Experiments to watch observed Reading, Editing, Testing, and Repairing actions for A and B.</p></div></div>}

    <div className="workspace-actions"><button className="primary-button" type="button" onClick={() => onNavigate(report ? "reports" : "experiments")}>{report ? "Open report" : "View live experiment"}</button>{report ? <button className="secondary-button" type="button" onClick={() => onNavigate("comparisons")}>Compare candidates</button> : null}</div>
  </section>;
}

function FutureScenariosPage({ report }: { report: any }) {
  const reportScenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
  const scenarios = DISPLAY_SCENARIOS.map((fallback) => reportScenarios.find((item: any) => item.id === fallback.id) ?? fallback);
  return <section className="workspace-page"><header className="workspace-page-header"><div><p className="eyebrow">Frozen benchmark</p><h1>Future Scenarios</h1><p>These requirements are fixed before candidate execution, so both implementations face the same future-change pressure.</p></div><span className="method-chip">5 scenarios</span></header><div className="workspace-scenario-list">{scenarios.map((scenario: any, index) => <article key={scenario.id} className="workspace-scenario-card"><span className="scenario-index">0{index + 1}</span><div className="scenario-copy"><code>{scenario.id}</code><strong>{scenario.title}</strong><p>{scenario.requirement ?? DISPLAY_SCENARIOS[index]?.note}</p></div><dl><div><dt>Difficulty</dt><dd>{scenario.difficulty ?? (scenario.id === "FR-04" ? "hard" : scenario.id === "FR-05" ? "easy" : "medium")}</dd></div><div><dt>Dimension</dt><dd>{scenario.dimension ?? DISPLAY_SCENARIOS[index]?.note.split(" · ")[0]}</dd></div></dl></article>)}</div></section>;
}

function ExperimentPage({ state, analysisId, events, error, onStart }: { state: AnalysisState; analysisId: string | null; events: ProgressEvent[]; error: string | null; onStart: () => void }) {
  if ((state === "running" || state === "completed") && analysisId) return <RunProgress analysisId={analysisId} events={events} />;
  if (state === "failed") return <div className="failure-page"><p className="eyebrow">Analysis stopped</p><h1>The experiment could not complete.</h1><p>{error}</p><button className="primary-button" type="button" onClick={onStart}>Retry analysis</button></div>;
  return <section className="workspace-page"><p className="eyebrow">Experiment</p><h1>Experiments</h1><p>No analysis is running yet. Start the controlled A/B experiment to populate the live timeline.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={onStart}>Start Analysis →</button></div></section>;
}

function ComparisonPage({ report, onNavigate }: { report: any; onNavigate: (view: AppView) => void }) {
  if (!report) return <section className="workspace-page"><p className="eyebrow">Comparison</p><h1>Candidate Comparison</h1><p>Run an analysis first. FutureProof will compare both implementations using observed future-change evidence.</p></section>;
  const a = report.candidates?.A;
  const b = report.candidates?.B;
  const dimensions = [
    ["Resilience", a?.dimensions?.resilienceRisk, b?.dimensions?.resilienceRisk],
    ["Efficiency", a?.dimensions?.efficiencyRisk, b?.dimensions?.efficiencyRisk],
    ["Regression", a?.dimensions?.regressionRisk, b?.dimensions?.regressionRisk],
    ["Structural", a?.dimensions?.structuralRisk, b?.dimensions?.structuralRisk],
  ];
  return <section className="workspace-page"><header className="workspace-page-header"><div><p className="eyebrow">Observed evidence</p><h1>Candidate Comparison</h1><p>Lower risk is better. Both candidates began with the same passing baseline and frozen scenario set.</p></div></header><div className="workspace-comparison"><article className="comparison-a"><span>Candidate A</span><strong>{Math.round(a?.dimensions?.overallRisk ?? 0)}<small>/100</small></strong><small>Future Risk</small></article><article className="comparison-b"><span>Candidate B</span><strong>{Math.round(b?.dimensions?.overallRisk ?? 0)}<small>/100</small></strong><small>Future Risk</small></article></div><div className="dimension-list">{dimensions.map(([label, av, bv]) => <div key={String(label)}><span>{label}</span><code>A {av ?? "n/a"}</code><div className="dimension-track"><i className="dimension-a" style={{ width: `${Number(av ?? 0)}%` }} /><i className="dimension-b" style={{ width: `${Number(bv ?? 0)}%` }} /></div><code>B {bv ?? "n/a"}</code></div>)}</div><div className="workspace-actions"><button className="primary-button" type="button" onClick={() => onNavigate("reports")}>Inspect full report</button></div></section>;
}

function EmptyReportsPage({ onStart }: { onStart: () => void }) {
  return <section className="workspace-page"><p className="eyebrow">Reports</p><h1>Reports</h1><p>A report appears after the controlled experiment completes.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={onStart}>Start Analysis →</button></div></section>;
}

function SettingsPage({ runtime }: { runtime: ExperimentViewModel }) {
  return <section className="workspace-page"><header className="workspace-page-header"><div><p className="eyebrow">Local runtime</p><h1>Runtime Settings</h1><p>Effective non-secret runtime values come from the Fastify process. Credentials never enter browser state or progress events.</p></div></header><div className="workspace-settings"><div><span>Provider</span><strong>{runtime.provider}</strong></div><div><span>Model</span><strong><code>{runtime.model}</code></strong></div><div><span>Request timeout</span><strong>{runtime.requestTimeoutMs ? `${runtime.requestTimeoutMs.toLocaleString()} ms` : <code>OPENROUTER_REQUEST_TIMEOUT_MS</code>}</strong></div><div><span>Analysis concurrency</span><strong>{runtime.concurrency}</strong></div><div><span>API key</span><strong>Server-side only</strong></div></div></section>;
}

export function App() {
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [state, setState] = useState<AnalysisState>("idle");
  const [view, setView] = useState<AppView>("overview");
  const [report, setReport] = useState<any>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<any>(null);
  const [drawerScenarioId, setDrawerScenarioId] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const runtime = useMemo(() => deriveExperimentState(events), [events]);

  const refreshTerminalState = useCallback(async (id: string) => {
    const next = await getAnalysis(id);
    if (next.status === "completed") {
      setReport(next.report);
      setState("completed");
      setView("reports");
    } else if (next.status === "failed") {
      setError(next.error);
      setState("failed");
      setView("experiments");
    }
  }, []);

  useEffect(() => {
    if (!analysisId || state !== "running") return;
    const unsubscribe = subscribeToProgress(analysisId, (event) => {
      setEvents((current) => [...current, event]);
      if (event.type === "analysis_completed" || event.type === "analysis_failed") void refreshTerminalState(analysisId);
    }, () => window.setTimeout(() => void refreshTerminalState(analysisId), 500));
    return unsubscribe;
  }, [analysisId, refreshTerminalState, state]);

  const reset = () => {
    setAnalysisId(null); setState("idle"); setView("overview"); setReport(null); setEvents([]); setError(null); setDrawerDetail(null); setDrawerScenarioId(null);
  };

  const start = async () => {
    setStarting(true); setView("experiments"); setError(null); setEvents([]); setReport(null); setDrawerDetail(null); setDrawerScenarioId(null);
    try {
      const created = await startDemoAnalysis();
      setAnalysisId(created.analysisId);
      setState("running");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
      setState("failed");
    } finally { setStarting(false); }
  };

  const navigate = (next: AppView) => {
    setView(next);
    if (next !== "reports") { setDrawerScenarioId(null); setDrawerDetail(null); }
  };

  const openScenario = async (scenarioId: string, trigger: HTMLButtonElement) => {
    if (!analysisId) return;
    triggerRef.current = trigger; setDrawerScenarioId(scenarioId); setDrawerLoading(true); setDrawerDetail(null);
    try { setDrawerDetail(await getScenarioDetail(analysisId, scenarioId)); }
    catch (detailError) { setError(detailError instanceof Error ? detailError.message : String(detailError)); setDrawerScenarioId(null); }
    finally { setDrawerLoading(false); }
  };

  const closeDrawer = () => { setDrawerScenarioId(null); setDrawerDetail(null); };

  let content: React.ReactNode;
  if (view === "overview") content = state === "idle" ? <SetupPage onStart={() => void start()} busy={starting} error={error} /> : <OverviewPage state={state} report={report} runtime={runtime} onNavigate={navigate} onStart={() => void start()} />;
  else if (view === "scenarios") content = <FutureScenariosPage report={report} />;
  else if (view === "experiments") content = <ExperimentPage state={state} analysisId={analysisId} events={events} error={error} onStart={() => void start()} />;
  else if (view === "comparisons") content = <ComparisonPage report={report} onNavigate={navigate} />;
  else if (view === "reports") content = state === "completed" && report ? <ReportPage report={report} onRerun={() => void start()} onOpenScenario={(scenarioId, trigger) => void openScenario(scenarioId, trigger)} /> : <EmptyReportsPage onStart={() => void start()} />;
  else content = <SettingsPage runtime={runtime} />;

  return <div className="app-shell">
    <Sidebar view={view} analysisState={state} analysisId={analysisId} runtime={runtime} onNavigate={navigate} onNewAnalysis={reset} />
    <main className="app-main">{content}</main>
    {drawerLoading && drawerScenarioId ? <div className="drawer-loading" role="status">Loading scenario evidence…</div> : null}
    {analysisId && view === "reports" && drawerScenarioId && drawerDetail ? <ScenarioDrawer analysisId={analysisId} detail={drawerDetail} triggerRef={triggerRef} onClose={closeDrawer} loadArtifact={async (candidateId, kind) => {
      const trial = drawerDetail.rawRuns?.[candidateId]?.[0]?.trial ?? 1;
      return await getArtifact({ analysisId, scenarioId: drawerScenarioId, candidateId, trial, kind });
    }} /> : null}
  </div>;
}
