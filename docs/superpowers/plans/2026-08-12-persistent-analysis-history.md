# Persistent Analysis History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist FutureProof analysis summaries/reports so completed and failed runs survive navigation and API restarts, expose a Recent Runs history, and make **+ New Analysis** start a clean workspace without deleting prior results.

**Architecture:** Add a focused disk-backed `AnalysisRepository` in the API layer using the existing `.futureproof/runs/<analysisId>` artifact root. Analysis routes keep the in-memory map only for active-process state, while durable summaries/reports are hydrated from disk for listing and reopening. The React app separates active workspace state from selected history state and persists only the selected analysis id in localStorage.

**Tech Stack:** Node.js 22+, pnpm 11.4.0, TypeScript, Fastify, React/Vite, Vitest, Playwright, existing FutureProof artifact helpers.

## Global Constraints

- Work only on `feat/persistent-analysis-history`; do not write directly to `main`.
- Reuse `.futureproof/runs/<analysisId>`; do not create a second storage tree.
- Recent Runs returns at most 50 analyses, newest first.
- Do not add a database, queue, auth layer, or new runtime dependency.
- Persist no API keys, Authorization headers, filesystem roots, sandbox paths, raw prompts, or hidden model messages.
- A persisted `running` run discovered after API reconstruction becomes `interrupted`; agent execution is not resumed.
- Keep existing scoring, scenarios, concurrency, budgets, OpenRouter transport, report evidence, and path-safety semantics unchanged.
- Preserve current deterministic Linux CI, macOS core gate, Candidate A/B 22/22 behavior tests, TypeScript build, and visual tests.

---

### Task 1: Disk-backed analysis repository

**Files:**
- Create: `apps/api/src/analysis-repository.ts`
- Create: `tests/api/analysis-repository.test.ts`
- Reuse: `packages/core/src/paths.ts`

**Interfaces:**
- Produces `PersistedAnalysisStatus = "running" | "completed" | "failed" | "interrupted"`.
- Produces `PersistedAnalysisSummary` with `version`, `analysisId`, timestamps, safe runtime metadata, `candidateRisk`, and optional `error`.
- Produces `AnalysisRepository` methods: `createRunning`, `patchRuntime`, `complete`, `fail`, `interrupt`, `getSummary`, `getReport`, `list`.

- [ ] **Step 1: Write repository RED tests**

Cover: create/read summary, atomic updates, completed report hydration, newest-first listing, 50-item cap, malformed manifest skip, no path traversal through analysis id.

```ts
const repo = new AnalysisRepository(tempRoot);
await repo.createRunning("run-1");
await repo.patchRuntime("run-1", { provider: "OpenRouter", model: "model-x", concurrency: 2, requestTimeoutMs: 90000 });
const summary = await repo.getSummary("run-1");
assert.equal(summary?.status, "running");
assert.equal(summary?.concurrency, 2);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --experimental-strip-types --test tests/api/analysis-repository.test.ts`

Expected: FAIL because `analysis-repository.ts` does not exist.

- [ ] **Step 3: Implement the repository minimally**

Use `analysisArtifactDir(projectRoot, analysisId)` and `analysis-state.json`. Validate ids as opaque single path segments. Write state with temp-file + rename. `complete()` persists the summary and relies on the existing report writer for the canonical `report.json`; `getReport()` reads that file.

- [ ] **Step 4: Re-run focused tests**

Expected: all repository tests PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: persist analysis summaries on disk`.

---

### Task 2: Durable lifecycle and history API

**Files:**
- Modify: `apps/api/src/analysis-routes.ts`
- Modify: `apps/api/src/server.ts`
- Create: `tests/api/analysis-history.test.ts`
- Update existing API tests only where response unions gain `interrupted`.

**Interfaces:**
- Consumes `AnalysisRepository` from Task 1.
- Produces `GET /api/analyses` -> `{ analyses: PersistedAnalysisSummary[] }`.
- Extends `GET /api/analyses/:analysisId` with disk hydration and `interrupted` state.

- [ ] **Step 1: Write API RED tests**

Construct server A with a temp `projectRoot`, complete/failed runs, close it, construct server B using the same root, then assert list/get/scenario/export/artifact endpoints still work. Add a persisted-running fixture and assert server B returns/persists `interrupted`.

- [ ] **Step 2: Run focused API tests and confirm RED**

Run: `node --experimental-strip-types --test tests/api/analysis-history.test.ts`

Expected: FAIL because `/api/analyses` and disk hydration do not exist.

- [ ] **Step 3: Wire repository into `registerAnalysisRoutes`**

Persist `running` before POST returns `202`; on `analysis_started`, patch safe runtime metadata; on success persist completed metadata after report/export writes; on error persist failed metadata. Keep the in-memory map as the active-process cache.

- [ ] **Step 4: Add list and hydration helpers**

For GET/scenario/export/artifact routes: use active map first, otherwise hydrate summary/report from repository. If disk says `running` and no active map entry exists, call `interrupt(...)` and return `interrupted`.

- [ ] **Step 5: Verify API security contracts**

Assert serialized list/get responses do not contain `projectRoot`, `.futureproof`, sandbox paths, `OPENROUTER_API_KEY`, `Authorization`, or `sk-or-`.

- [ ] **Step 6: Run root API tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: expose durable analysis history api`.

---

### Task 3: Frontend history API and state separation

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Create: `apps/web/src/recent-runs.tsx`

**Interfaces:**
- Produces frontend `AnalysisSummary` and `PersistedAnalysisStatus` types.
- Produces `listAnalyses(): Promise<{ analyses: AnalysisSummary[] }>`.
- Produces selected-history hydration independent from active workspace state.

- [ ] **Step 1: Add React RED tests for the reported bug**

Test exact flows:

```text
complete Run 1 -> Overview -> Settings -> Reports -> same report visible
complete Run 1 -> New Analysis -> setup visible -> Reports -> Run 1 still listed
click Run 1 -> report rehydrates
```

Also assert New Analysis is disabled only during `running`.

- [ ] **Step 2: Add localStorage RED tests**

Set `futureproof.selectedAnalysisId.v1`, mount App, mock list/get, and assert the completed report is restored. A 404 must clear the stale key without clearing Recent Runs.

- [ ] **Step 3: Run web tests and confirm RED**

Run: `pnpm --dir apps/web test`

Expected: new history tests FAIL.

- [ ] **Step 4: Implement frontend API methods and state split**

Keep separate:

```ts
const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
const [recentAnalyses, setRecentAnalyses] = useState<AnalysisSummary[]>([]);
```

`+ New Analysis` clears active/selected transient workspace state but never `recentAnalyses` or server artifacts. Completion refreshes history and selects the completed id.

- [ ] **Step 5: Implement `RecentRunsPanel`**

Show newest-first rows/cards with status, timestamp, short id, provider/model/concurrency, and A/B risk. Completed rows are selectable; failed/interrupted rows show their message and no fabricated report.

- [ ] **Step 6: Re-run web tests**

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add recent analysis history workspace`.

---

### Task 4: Reports integration and responsive styling

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/workspace.css` and/or `apps/web/src/hybrid.css`
- Modify: `apps/web/src/recent-runs.tsx`
- Keep: `apps/web/src/report-page.tsx` evidence logic unchanged except any container composition required.

**Interfaces:**
- Reports always shows Recent Runs.
- Selected completed run renders existing `ReportPage` below the history surface.

- [ ] **Step 1: Add UI contract assertions**

Assert selected row has `aria-current="true"` or equivalent accessible selection state; status chips are text-visible; empty Reports still shows history and CTA.

- [ ] **Step 2: Implement compact history visuals**

Desktop: full-width compact strip/table above report. Mobile: stacked cards. Use established IBM Plex typography, Candidate A indigo, Candidate B pink, semantic completed/failed/interrupted chips. Do not redesign report scoring/evidence.

- [ ] **Step 3: Run web test + typecheck + build**

Run:
- `pnpm --dir apps/web test`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web build`

Expected: all PASS.

- [ ] **Step 4: Commit**

Commit message: `feat: surface recent runs in reports`.

---

### Task 5: Browser-level history regression

**Files:**
- Modify the existing Playwright dashboard/report spec under `apps/web` that currently mocks analysis POST/GET/SSE.

**Interfaces:**
- Browser contract: completed run remains reopenable after New Analysis.

- [ ] **Step 1: Add Playwright RED flow**

Mock Run 1 completion plus `GET /api/analyses`, then exercise:

```text
Start -> complete Run 1 -> + New Analysis -> Reports -> click Run 1 -> Analysis Report visible
```

- [ ] **Step 2: Add mobile overflow assertion**

At the existing mobile viewport, verify `document.documentElement.scrollWidth <= window.innerWidth` with Recent Runs rendered.

- [ ] **Step 3: Run Playwright**

Run: `make visual-test`

Expected: PASS after Task 4 implementation.

- [ ] **Step 4: Commit**

Commit message: `test: cover persistent analysis history flow`.

---

### Task 6: Full verification and integration readiness

**Files:**
- Modify documentation only if implementation changes a command or environment variable; no README rewrite is otherwise required.

- [ ] **Step 1: Run full deterministic developer gate**

Run: `make test`.

Expected: root tests + web tests PASS.

- [ ] **Step 2: Run type/build gate**

Run: `make typecheck && make build`.

Expected: PASS.

- [ ] **Step 3: Run demo/visual gate**

Run: `make demo-verify` and `make visual-test` (or the repository's existing combined `make ci` if it already includes both).

Expected: Candidate A/B baseline 22/22, golden pipeline, React, Playwright desktop/mobile, and production build all PASS.

- [ ] **Step 4: Verify fresh GitHub Actions on branch head**

Require both Ubuntu full gate and macOS core gate to complete successfully before claiming completion.

- [ ] **Step 5: Review branch diff against the approved spec**

Confirm: max 50 recent runs; restart hydration; running->interrupted; New Analysis preserves history; selected id localStorage only; no secrets/paths; scenario/export/artifact hydration works after restart.

- [ ] **Step 6: Prepare PR only after the user requests integration**

Do not merge automatically as part of implementation; report the verified branch head and let the user decide integration.
