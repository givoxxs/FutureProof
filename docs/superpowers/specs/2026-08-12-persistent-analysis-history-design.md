# FutureProof Persistent Analysis History Design

Date: 2026-08-12
Status: Approved design, implementation pending
Branch: `feat/persistent-analysis-history`

## Goal

Make completed FutureProof analyses durable and reopenable instead of tying the visible report to one in-memory React session. A user must be able to complete a run, navigate elsewhere, start a new analysis, refresh the browser, or restart the API process and still reopen prior completed reports from **Reports**.

The top-left **+ New Analysis** action must create a fresh workspace state without deleting prior run history.

## Non-goals

- No distributed job queue or resumable coding-agent execution.
- No cloud database, auth, multi-user tenancy, or remote storage.
- No automatic artifact deletion in this MVP.
- No attempt to reconstruct a full live agent timeline after an API restart.
- No changes to scoring, benchmark scenarios, agent budget, concurrency scheduling, or OpenRouter transport.

## User experience

### New analysis

- **+ New Analysis** is enabled whenever no analysis is actively running.
- Clicking it returns the main workspace to the setup/Overview state.
- It clears only the currently selected workspace state: active analysis id, report selection, live events, drawer state, and transient errors.
- It does **not** delete or mutate any persisted prior run.
- While an analysis is running, the button remains disabled to avoid silently abandoning an active experiment.

### Reports / Recent Runs

The Reports page becomes the durable history surface.

- Show up to 50 most recent analyses, newest first.
- Each row shows only safe metadata:
  - analysis id (short display, full id internally)
  - status
  - created/updated time
  - model
  - provider
  - concurrency
  - Candidate A risk when completed
  - Candidate B risk when completed
- Completed runs are selectable and reopen the existing full `ReportPage` plus scenario evidence/artifact drawers.
- Failed/interrupted runs remain visible in history with their terminal message but do not masquerade as completed reports.
- When the current run completes, it appears at the top of Recent Runs and is selected automatically.
- Starting a second run does not remove the first run from Reports.

### Browser reload

The frontend stores the selected analysis id in local storage under a versioned key such as `futureproof.selectedAnalysisId.v1`.

On app mount:

1. fetch Recent Runs;
2. if the stored selected id still exists, hydrate that analysis;
3. otherwise keep the workspace in setup mode while Reports still exposes history.

A refresh must therefore preserve the selected completed report when possible without persisting secrets or the report body in browser storage.

### API restart

Completed and failed runs survive a process restart because their state is persisted on disk.

A run that was persisted as `running` but is not owned by the current API process is converted to terminal status `interrupted` with a clear message such as `Analysis interrupted by API restart; execution was not resumed.`

FutureProof does not pretend to resume that coding-agent execution.

## Persistence architecture

### Per-analysis state manifest

Use one safe state file per analysis instead of a single global mutable index. This avoids a second mutable global index and reuses the canonical run directory already owned by `analysisArtifactDir()`.

Canonical location:

```text
.futureproof/
  runs/
    <analysisId>/
      analysis-state.json
      report.json
      exports/
      A/
      B/
```

`analysis-state.json` contains only public-safe metadata and terminal state. It never stores filesystem paths, API keys, raw prompts, or bearer tokens.

Suggested shape:

```ts
type PersistedAnalysisStatus = "running" | "completed" | "failed" | "interrupted";

interface PersistedAnalysisSummary {
  version: 1;
  analysisId: string;
  status: PersistedAnalysisStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  provider?: string;
  model?: string;
  concurrency?: number;
  requestTimeoutMs?: number;
  candidateRisk?: { A: number; B: number };
  error?: string;
}
```

### Analysis repository

Add a small API-layer repository responsible for persistence and hydration. It has one concern: translate analysis ids to safe persisted state/report data under the existing canonical run artifact root.

Recommended interface:

```ts
interface AnalysisRepository {
  createRunning(analysisId: string): Promise<PersistedAnalysisSummary>;
  patchRuntime(analysisId: string, runtime: RuntimeMetadata): Promise<void>;
  complete(analysisId: string, report: AnalysisReport): Promise<void>;
  fail(analysisId: string, error: string): Promise<void>;
  interrupt(analysisId: string, error: string): Promise<void>;
  getSummary(analysisId: string): Promise<PersistedAnalysisSummary | null>;
  getReport(analysisId: string): Promise<AnalysisReport | null>;
  list(limit: number): Promise<PersistedAnalysisSummary[]>;
}
```

Writes use the existing artifact root plus an atomic temp-file-then-rename pattern for `analysis-state.json` so a process interruption does not leave partially written JSON.

`list()` scans `.futureproof/runs`, reads valid state manifests, ignores malformed/unrelated directories, sorts by `createdAt` descending, and caps output at 50.

## API changes

### `GET /api/analyses`

Returns recent safe summaries:

```json
{
  "analyses": [
    {
      "analysisId": "...",
      "status": "completed",
      "createdAt": "...",
      "updatedAt": "...",
      "provider": "OpenRouter",
      "model": "...",
      "concurrency": 2,
      "candidateRisk": { "A": 33, "B": 1 }
    }
  ]
}
```

Default/max limit is 50. No client-supplied filesystem roots are accepted.

### `GET /api/analyses/:analysisId`

Lookup order:

1. current-process in-memory state for active runs;
2. persisted `analysis-state.json`;
3. for completed runs, persisted `report.json`.

If a persisted state says `running` but there is no matching current-process active state, convert it to `interrupted`, persist that terminal state, and return it.

Completed responses continue to use the existing `publicReport()` sanitizer.

### Existing scenario/export/artifact routes

These routes must hydrate completed analyses from disk when the analysis is not present in the current in-memory map. Existing path-safety and report sanitization rules remain unchanged.

### POST lifecycle

`POST /api/analyses/demo` performs these durable transitions:

1. generate id;
2. persist `running` summary before responding `202`;
3. launch the existing run;
4. capture safe runtime metadata from `analysis_started` progress;
5. on success, write report/export bundle, then persist `completed` summary with A/B risk;
6. on failure, persist `failed` summary and publish the existing failure event.

The existing in-memory map remains a fast cache for active runs; disk persistence becomes the source of truth for durable history.

## Frontend state model

Separate three concepts that are currently conflated:

- **workspace state**: idle/running/failed for a newly started or active run;
- **selected analysis**: the history item the user is currently inspecting;
- **recent analyses**: summaries returned by `GET /api/analyses`.

Recommended additions:

```ts
const [recentAnalyses, setRecentAnalyses] = useState<AnalysisSummary[]>([]);
const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
const [historyLoading, setHistoryLoading] = useState(false);
```

The currently active run id may also be the selected analysis id, but these are not semantically the same thing.

### Selection flow

- Run completes -> refresh history -> select completed id -> show report.
- User clicks another completed history row -> `GET /api/analyses/:id` -> replace selected report/runtime metadata -> remain in Reports.
- User clicks **+ New Analysis** -> workspace becomes idle/setup and selected analysis becomes null; recent history is preserved and the local-storage selection key is removed.
- User then clicks Reports -> recent list remains available.
- User clicks an old run -> hydrate and show its report.

### Local storage

Persist only the selected analysis id. Do not persist report JSON, runtime secrets, API keys, artifact paths, or raw SSE events.

If hydration returns 404, remove the stale local-storage id and continue normally.

## Reports page composition

Keep the existing evidence report rather than redesigning it again.

Add a compact `RecentRunsPanel` above the selected report:

- desktop: compact full-width history table/strip above the report to preserve report width;
- mobile: stacked cards;
- selected row has indigo focus/selection treatment;
- Candidate A/B risk uses the established indigo/pink identity;
- status uses completed / failed / interrupted semantic chips.

When no run is selected, Reports shows Recent Runs plus an empty-state prompt to select a run or start a new analysis.

## Error handling

- Malformed state manifests are skipped from list responses rather than crashing the API.
- Missing report for a `completed` manifest is treated as a server-side consistency error and returned as unavailable, not fabricated.
- Failed/interrupted runs remain inspectable at summary level.
- Selecting an unavailable old run shows a local error and refreshes Recent Runs.
- A failed history fetch does not destroy the currently selected in-memory report.
- New Analysis never deletes artifacts.

## Security and privacy

History responses may expose only opaque analysis ids and non-secret runtime/report summary metadata.

Never include:

- `projectRoot`
- sandbox roots
- artifact filesystem paths
- OpenRouter API key
- Authorization headers
- raw prompts or hidden model messages

Existing artifact path validation remains authoritative for evidence retrieval.

## Testing strategy

### API persistence tests

1. complete a run using a temporary `projectRoot`;
2. close server A;
3. construct server B with the same root;
4. `GET /api/analyses` returns the completed run;
5. `GET /api/analyses/:id` returns the completed sanitized report;
6. scenario/export/artifact routes still work after server reconstruction.

Additional API tests:

- history is newest-first and capped at 50;
- history payload contains no server filesystem paths/secrets;
- persisted `running` state becomes `interrupted` after process reconstruction;
- malformed history manifests are ignored safely;
- failed analyses survive restart.

### React tests

- complete -> navigate Overview/Settings -> Reports still shows the same report;
- complete -> **+ New Analysis** -> setup appears, then Reports still lists the completed run;
- select a prior run -> full report rehydrates;
- selected analysis id is restored from local storage on mount;
- stale selected id is cleared after 404;
- history state survives starting another run;
- **+ New Analysis** is enabled after completion and disabled only while running.

### Playwright

Add one browser-level history flow with mocked API:

```text
complete Run 1
-> New Analysis
-> Reports
-> select Run 1
-> report visible again
```

Also verify the Recent Runs mobile layout does not introduce horizontal page overflow.

## Acceptance criteria

- A completed run remains reopenable after normal sidebar navigation.
- A completed run remains listed after **+ New Analysis**.
- Multiple completed runs can coexist in Recent Runs.
- Refreshing the browser can restore the previously selected completed run.
- Restarting the API does not erase completed/failed history.
- Stale running entries become `interrupted`, not silently resumed or reported completed.
- Existing report/scenario/export/artifact path-safety guarantees still pass.
- Recent Runs exposes no API key or filesystem path.
- Existing deterministic CI, macOS core gate, React tests, Playwright desktop/mobile tests, Candidate A/B tests, typecheck, and production build remain green.
