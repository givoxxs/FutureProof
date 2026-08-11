# Local Live Analysis and Navigation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the live local analysis failure caused by stale npm commands and make the sidebar navigate between meaningful SPA views while preserving the existing controlled experiment flow.

**Architecture:** Keep the existing dependency-light React SPA and Fastify API. The engine command surface remains pnpm-only; the orchestrator final-check must use the same exact commands as the agent tool allowlist. The web app gains explicit `view` state independent from analysis lifecycle state so navigation does not mutate or cancel an in-progress/completed analysis.

**Tech Stack:** Node.js 22, pnpm 11.4.0, TypeScript, React, Vite, Fastify, node:test, Vitest, Playwright.

## Global Constraints

- Do not add a router dependency.
- Keep `README.md` in English.
- Keep the live model configuration OpenRouter-native.
- Do not change benchmark scoring, frozen scenarios, candidate fixtures, or budgets.
- Engine shell access stays limited to exact `pnpm test` and `pnpm run build` commands.
- Preserve Linux full CI and macOS core CI.

---

### Task 1: Align final verification with the pnpm command policy

**Files:**
- Modify: `packages/engine/src/orchestrator.ts`
- Modify: `tests/engine/orchestrator.test.ts`

**Interfaces:**
- Consumes: `runAllowedCommand(root, command, timeoutMs)` from `packages/engine/src/command-runner.ts`.
- Produces: `defaultFinalCheck()` behavior that invokes only `pnpm test` and `pnpm run build`.

- [ ] **Step 1: Write the failing regression test**

Add an orchestrator test that injects a command runner seam or exercises the default final-check path and records commands. Assert that the test/build commands are exactly:

```ts
assert.deepEqual(commands, ["pnpm test", "pnpm run build"]);
```

- [ ] **Step 2: Run the targeted engine test and verify RED**

Run:

```bash
pnpm test -- --test-name-pattern="final check uses pnpm"
```

Expected: FAIL because `defaultFinalCheck()` still invokes `npm test` / `npm run build`.

- [ ] **Step 3: Implement the minimal command fix**

Change the two stale commands in `defaultFinalCheck()`:

```ts
const test = await runAllowedCommand(sandbox.root, "pnpm test", 30_000);
// ...
const build = await runAllowedCommand(sandbox.root, "pnpm run build", 30_000);
```

- [ ] **Step 4: Run the targeted test and engine suite**

Run:

```bash
pnpm test
```

Expected: all root tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/orchestrator.ts tests/engine/orchestrator.test.ts
git commit -m "fix: use pnpm in analysis final checks"
```

---

### Task 2: Add real SPA sidebar navigation without a router dependency

**Files:**
- Modify: `apps/web/src/app.tsx`
- Create: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/responsive.css` only if mobile navigation layout requires it.

**Interfaces:**
- Introduce `type AppView = "overview" | "scenarios" | "experiments" | "comparisons" | "reports" | "settings"`.
- `Sidebar` receives `view: AppView`, `onNavigate(view: AppView)`, `analysisState`, and `onNewAnalysis()`.
- Analysis lifecycle remains `idle | running | completed | failed` and is not reset by navigation.

- [ ] **Step 1: Write failing navigation tests**

Cover these behaviors with React Testing Library:

```ts
it("navigates to every sidebar view without resetting a running analysis", ...);
it("Start Analysis switches to Experiments", ...);
it("a completed analysis switches to Reports", ...);
it("opening Overview after completion keeps the report available", ...);
```

Assert sidebar items are actual `<button>` elements, not static spans.

- [ ] **Step 2: Run the web tests and verify RED**

Run:

```bash
pnpm --dir apps/web test
```

Expected: FAIL because sidebar items are currently non-interactive spans and the app has no independent view state.

- [ ] **Step 3: Implement view state and navigation**

Add:

```ts
type AppView = "overview" | "scenarios" | "experiments" | "comparisons" | "reports" | "settings";
const [view, setView] = useState<AppView>("overview");
```

Navigation rules:

```text
Start Analysis -> experiments
analysis_completed -> reports
analysis_failed -> experiments
New Analysis -> overview + reset analysis
manual sidebar navigation -> change view only; preserve analysis state/data
```

Render meaningful views:

- `overview`: existing setup page before a run; after a run, show a compact status/summary with CTA to Experiments or Reports.
- `scenarios`: list the five frozen future scenarios and their difficulty/dimension from report data when available; otherwise explain that the demo uses five frozen scenarios.
- `experiments`: live `RunProgress`; on failure, show the failure state here; after completion, show completed status and link to Reports.
- `comparisons`: after completion show A/B headline comparison from the report; otherwise an empty-state explaining comparison appears after an analysis.
- `reports`: completed `ReportPage`; otherwise an empty-state with CTA to start/open experiment.
- `settings`: show read-only local configuration guidance (OpenRouter model comes from server env; no API key value is exposed to browser).

- [ ] **Step 4: Preserve scenario evidence behavior**

Ensure `ReportPage` and `ScenarioDrawer` still use the current `analysisId` and opaque artifact routes. Navigation away from Reports must not destroy the completed report or drawer source data.

- [ ] **Step 5: Run component tests and typecheck**

Run:

```bash
pnpm --dir apps/web test
pnpm --dir apps/web run typecheck
pnpm --dir apps/web run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app.tsx apps/web/src/app.test.tsx apps/web/src/styles.css apps/web/src/responsive.css
git commit -m "feat: add navigable analysis workspace"
```

---

### Task 3: Lock the local live-analysis regression in E2E and CI

**Files:**
- Modify: `tests/golden/analysis-golden.test.ts` or add a focused engine integration test if more appropriate.
- Modify: `apps/web/e2e/report-visual.spec.ts` to include navigation assertions without changing visual fixtures unnecessarily.
- Keep: `.github/workflows/ci.yml` with Ubuntu full gate and macOS core gate.

**Interfaces:**
- Live local engine path must never submit `npm test`/`npm run build` to the command surface.
- Sidebar navigation must be testable with buttons/ARIA current state.

- [ ] **Step 1: Add command-policy regression assertion**

Add a repository-level assertion that no executable engine code contains stale command literals:

```ts
assert.doesNotMatch(engineRuntimeSource, /"npm test"|"npm run build"/);
```

Exclude docs/plans from this assertion.

- [ ] **Step 2: Add Playwright navigation flow**

In the browser test, verify:

```text
Overview -> Future Scenarios -> Experiments -> Comparisons -> Reports -> Settings -> Overview
```

and that the main content changes while the app shell remains mounted.

- [ ] **Step 3: Run the complete deterministic gate**

Run in GitHub Actions / equivalent local environment:

```bash
make ci
```

Expected: Ubuntu full job PASS.

- [ ] **Step 4: Verify macOS core gate**

Expected: `macos-core` job running `make test` PASS on `macos-latest`.

- [ ] **Step 5: Manual local acceptance sequence**

With a valid `.env`:

```bash
make smoke
make dev
```

Browser acceptance:

```text
1. Open http://localhost:5173.
2. Sidebar items are clickable.
3. Start Analysis automatically opens Experiments.
4. No "command is not allowed: npm test" error occurs.
5. Completion opens Reports.
6. Navigate to Overview/Scenarios/Experiments/Comparisons/Reports/Settings without losing the completed analysis.
7. Open scenario evidence from Reports.
```

- [ ] **Step 6: Commit**

```bash
git add tests/golden apps/web/e2e .github/workflows/ci.yml
git commit -m "test: cover live analysis navigation flow"
```
