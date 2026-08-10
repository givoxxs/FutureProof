import React, { useEffect, useMemo, useState, type RefObject } from "react";

export interface ScenarioDrawerProps {
  analysisId: string;
  detail: any;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  loadArtifact: (candidate: "A" | "B", kind: "patch" | "events") => Promise<string>;
}

function tokens(value: number): string {
  return value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`;
}

function RegressionLine({ run }: { run: any }) {
  const snapshots = run?.metrics?.regressionSnapshots ?? [];
  if (snapshots.length === 0) return <span>n/a</span>;
  const first = snapshots[0]?.failed ?? 0;
  const last = snapshots[snapshots.length - 1]?.failed ?? 0;
  return <span>{first} → {last}</span>;
}

function EvidenceColumn({ label, aggregate, raw }: { label: "A" | "B"; aggregate: any; raw: any }) {
  return <section className={`drawer-candidate drawer-candidate-${label.toLowerCase()}`}>
    <div className="drawer-candidate-head"><strong>Candidate {label}</strong><span className={`scenario-status ${aggregate.status === "SUCCESS" ? "status-pass" : aggregate.status === "PARTIAL" ? "status-warn" : "status-fail"}`}>{aggregate.status}</span></div>
    <dl className="drawer-metrics">
      <div><dt>Tool calls</dt><dd>{aggregate.metrics.toolCalls}</dd></div>
      <div><dt>Files touched</dt><dd>{aggregate.metrics.filesTouched}</dd></div>
      <div><dt>Token usage</dt><dd>{tokens(aggregate.metrics.tokenUsage)}</dd></div>
      <div><dt>Regression pressure</dt><dd><RegressionLine run={raw?.[0]} /></dd></div>
      <div><dt>Structural change</dt><dd>{aggregate.metrics.structuralDelta ? `${aggregate.metrics.structuralDelta.cyclomaticComplexity >= 0 ? "+" : ""}${aggregate.metrics.structuralDelta.cyclomaticComplexity} complexity` : "n/a"}</dd></div>
    </dl>
    {raw?.[0]?.remainingFailures?.length ? <div className="remaining-failure"><span>Remaining failure</span><strong>{raw[0].remainingFailures[0]}</strong></div> : null}
  </section>;
}

export function ScenarioDrawer({ analysisId, detail, triggerRef, onClose, loadArtifact }: ScenarioDrawerProps) {
  const [artifact, setArtifact] = useState<{ title: string; body: string } | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        queueMicrotask(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, triggerRef]);

  const provenance = useMemo(() => detail.scenario.provenance ?? [], [detail]);
  const acceptance = useMemo(() => detail.scenario.acceptance ?? [], [detail]);

  const close = () => {
    onClose();
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const openArtifact = async (candidate: "A" | "B", kind: "patch" | "events") => {
    setArtifactError(null);
    try {
      const body = await loadArtifact(candidate, kind);
      setArtifact({ title: `Candidate ${candidate} ${kind === "patch" ? "patch" : "tool events"}`, body });
    } catch (error) {
      setArtifact(null);
      setArtifactError(error instanceof Error ? error.message : String(error));
    }
  };

  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <aside className="scenario-drawer" role="dialog" aria-modal="true" aria-label="Scenario detail">
      <header className="drawer-header">
        <div><p className="eyebrow">{detail.scenario.id} · {detail.scenario.difficulty}</p><h2>{detail.scenario.title}</h2></div>
        <button type="button" className="icon-button" aria-label="Close scenario detail" onClick={close}>×</button>
      </header>

      <div className="drawer-scroll">
        <section className="drawer-block">
          <h3>Future requirement</h3>
          <p>{detail.scenario.requirement}</p>
          <p className="muted-copy">{detail.scenario.rationale}</p>
        </section>

        <section className="drawer-block">
          <h3>Why this scenario?</h3>
          <ul className="evidence-list">{provenance.map((item: string) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section className="drawer-block">
          <h3>Acceptance contract</h3>
          <ol className="acceptance-list">{acceptance.map((item: any) => <li key={item.name}><strong>{item.name}</strong><span>{item.given} → {item.when} → {item.then}</span></li>)}</ol>
        </section>

        <section className="drawer-block">
          <div className="drawer-block-head"><h3>Observed evidence</h3><span className="opaque-note">Artifacts served by opaque IDs · {analysisId.slice(0, 8)}</span></div>
          <div className="drawer-compare">
            <EvidenceColumn label="A" aggregate={detail.candidates.A} raw={detail.rawRuns.A} />
            <EvidenceColumn label="B" aggregate={detail.candidates.B} raw={detail.rawRuns.B} />
          </div>
          <div className="artifact-actions">
            <button type="button" className="secondary-button" onClick={() => void openArtifact("A", "patch")}>View Candidate A patch</button>
            <button type="button" className="secondary-button" onClick={() => void openArtifact("B", "patch")}>View Candidate B patch</button>
            <button type="button" className="secondary-button" onClick={() => void openArtifact("B", "events")}>View Candidate B events</button>
          </div>
          {artifactError ? <p role="alert" className="artifact-error">{artifactError}</p> : null}
          {artifact ? <div className="artifact-viewer"><div className="artifact-viewer-title">{artifact.title}</div><pre>{artifact.body}</pre></div> : null}
        </section>
      </div>
    </aside>
  </div>;
}
