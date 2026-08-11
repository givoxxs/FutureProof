# FutureProof Parallel Analysis + Hybrid UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded parallel Candidate×Scenario×Trial execution (default concurrency 2) and redesign FutureProof into a Vercel-light + Linear-precision + Cursor-timeline dashboard using IBM Plex typography.

**Architecture:** Keep baseline validation sequential, build a deterministic queue with A/B adjacent per scenario/trial, and run that queue through a bounded async worker pool. Enrich the existing progress bus with contextual `agent_activity` events, then derive live per-candidate UI state in the web app without changing scoring or artifact formats. The frontend remains React/Vite with no new router or state-management dependency.

**Tech Stack:** Node.js 22+, TypeScript, pnpm 11.4.0, Fastify, React 18, Vite 6, Vitest, Playwright, Node test runner, existing OpenAI-compatible/OpenRouter client.

## Global Constraints

- `FUTUREPROOF_ANALYSIS_CONCURRENCY` accepts integers `1..4`; default is exactly `2`.
- No unlimited concurrency and no worker-thread/process pool solely for this feature.
- Baseline validation remains sequential.
- Final run ordering remains deterministic logical queue order, not completion order.
- Sandbox/artifact isolation and scoring formulas do not change.
- Progress events are observational only and must not affect scoring.
- No chain-of-thought or hidden reasoning is exposed; UI shows only model/tool activity emitted by the coding agent.
- No API key is ever returned to the browser or SSE stream.
- UI uses IBM Plex Sans + IBM Plex Mono via CSS/fallbacks; no font binaries are committed.
- UI scenario labels use the revised five-scenario benchmark set from the approved spec.

---

### Task 1: Concurrency Configuration Contract

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Test: `tests/api/server-config.test.ts`

**Interfaces:**
- Produces: `resolveAnalysisConcurrency(env: Record<string, string | undefined>): number`
- Consumes later: `createDefaultRunner()` passes the resolved value into `runAnalysis({ concurrency })`.

- [ ] **Step 1: Write the failing configuration tests**

Add tests equivalent to:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveAnalysisConcurrency } from "../../apps/api/src/server.ts";

test("analysis concurrency defaults to two", () => {
  assert.equal(resolveAnalysisConcurrency({}), 2);
});

test("analysis concurrency accepts only integers one through four", () => {
  for (const value of ["1", "2", "3", "4"]) {
    assert.equal(resolveAnalysisConcurrency({ FUTUREPROOF_ANALYSIS_CONCURRENCY: value }), Number(value));
  }
  for (const value of ["0", "5", "2.5", "abc", "-1"]) {
    assert.throws(() => resolveAnalysisConcurrency({ FUTUREPROOF_ANALYSIS_CONCURRENCY: value }), /1 through 4/);
  }
});
```

- [ ] **Step 2: Run CI and verify RED**

Expected: the new test fails because `resolveAnalysisConcurrency` does not exist.

- [ ] **Step 3: Implement the resolver and wire it into the live request**

Use:

```ts
export function resolveAnalysisConcurrency(env: Record<string, string | undefined>): number {
  const raw = env.FUTUREPROOF_ANALYSIS_CONCURRENCY?.trim();
  if (!raw) return 2;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error("FUTUREPROOF_ANALYSIS_CONCURRENCY must be an integer from 1 through 4");
  }
  return value;
}
```

Pass `concurrency: resolveAnalysisConcurrency(process.env)` into `runAnalysis`.

- [ ] **Step 4: Document the environment variable**

Add to `.env.example`:

```env
FUTUREPROOF_ANALYSIS_CONCURRENCY=2
```

README: document `1=debug`, `2=recommended A/B pair`, `3=faster`, `4=aggressive`, and explicitly state that `2` is the recommended demo value.

- [ ] **Step 5: Verify GREEN and commit**

Expected: root tests pass and config tests are green.

---

### Task 2: Deterministic Bounded Worker Pool

**Files:**
- Modify: `packages/engine/src/orchestrator.ts`
- Test: `tests/engine/orchestrator.test.ts`

**Interfaces:**
- Modify `AnalysisRequest` to include `concurrency: number`.
- Extend `OrchestratorProgressEvent` with `trial?: number`, `detail?: Record<string, unknown>`, and type `agent_activity`.
- Preserve `AnalysisExecution` and persisted summary/artifact shapes.

- [ ] **Step 1: Add RED tests for concurrency and ordering**

Create test instrumentation with deferred run agents:

```ts
let active = 0;
let maxActive = 0;
const starts: string[] = [];
const releases: Array<() => void> = [];

deps.runAgent = async (args) => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  starts.push(`${args.sandbox.scenarioId}:${args.sandbox.trial}:${args.sandbox.candidateId}`);
  await new Promise<void>((resolve) => releases.push(resolve));
  active -= 1;
  return { stopReason: "completed" };
};
```

Assert:

```ts
request.concurrency = 2;
const pending = runAnalysis(request, deps);
await waitUntil(() => starts.length === 2);
assert.deepEqual(starts.slice(0, 2).map(stripCandidate), [sameScenarioTrial, sameScenarioTrial]);
assert.equal(maxActive, 2);
```

Add a second test where jobs finish out of order but returned `execution.runs` follows deterministic queue order.

Add a `concurrency=1` test proving no overlap.

- [ ] **Step 2: Run CI and verify RED**

Expected: tests fail because the current nested loops are sequential and `AnalysisRequest` has no concurrency field.

- [ ] **Step 3: Extract one isolated run operation**

Refactor the existing per-trial body into:

```ts
async function executeRun(args: {
  request: AnalysisRequest;
  deps: OrchestratorDeps;
  candidateId: CandidateId;
  candidateBaseline: CandidateBaseline;
  scenario: FutureScenario;
  trial: number;
  logicalIndex: number;
}): Promise<{ logicalIndex: number; summary: ScenarioRunSummary }>;
```

Keep all existing sandbox creation, acceptance injection, agent execution, final check, metrics, artifact persistence, and cleanup inside this function.

- [ ] **Step 4: Build the deterministic queue**

After baseline validation, construct:

```ts
const jobs: RunJob[] = [];
for (const scenario of scenarioOrder) {
  const trials = request.trialsByScenario[scenario.id] ?? 1;
  for (let trial = 1; trial <= trials; trial += 1) {
    for (const candidateId of CANDIDATES) {
      jobs.push({ logicalIndex: jobs.length, candidateId, scenario, trial });
    }
  }
}
```

This is the fairness-oriented A/B adjacency contract.

- [ ] **Step 5: Implement a bounded async worker loop**

Use a shared index without launching all promises at once:

```ts
let nextIndex = 0;
const completed = new Array<ScenarioRunSummary | undefined>(jobs.length);
const worker = async () => {
  while (true) {
    const index = nextIndex++;
    if (index >= jobs.length) return;
    const result = await executeRun({ ...jobs[index]!, logicalIndex: index, request, deps, candidateBaseline: baselines[jobs[index]!.candidateId] });
    completed[result.logicalIndex] = result.summary;
  }
};
await Promise.all(Array.from({ length: Math.min(request.concurrency, jobs.length) }, () => worker()));
const runs = completed.map((run, index) => {
  if (!run) throw new Error(`missing run result at logical index ${index}`);
  return run;
});
```

If any worker rejects, allow `executeRun` `finally` cleanup to run and let `Promise.all` reject with the original error.

- [ ] **Step 6: Preserve scenario lifecycle semantics under overlap**

Emit `candidate_started`/`candidate_completed` per run with `trial`.
Track active/completed run counts per scenario and emit:

- `scenario_started` once when the first run for that scenario begins.
- `scenario_completed` once when all A/B/trials for that scenario are terminal.

- [ ] **Step 7: Verify GREEN and commit**

Expected: original orchestrator artifact/fairness tests pass plus concurrency/order tests.

---

### Task 3: Live Agent Activity Through API/SSE

**Files:**
- Modify: `packages/engine/src/orchestrator.ts`
- Modify: `apps/api/src/progress-bus.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/api.ts`
- Test: `tests/api/analysis-routes.test.ts`
- Test: `tests/engine/orchestrator.test.ts`

**Interfaces:**
- Add progress type `agent_activity`.
- Event context: `analysisId`, `scenarioId`, `candidateId`, `trial`, optional `concurrency`.
- `detail.action` is one of `thinking|searching|reading|editing|testing|repairing|done|failed`.

- [ ] **Step 1: Add RED tests for activity propagation**

Assert an `AgentEvent` such as:

```ts
{ type: "tool_call", tool: "read_file", payload: { arguments: { path: "src/x.ts" } } }
```

produces an orchestrator `agent_activity` event with candidate/scenario/trial context and `detail.action === "reading"`.

At API level, publish an `agent_activity` frame and assert the SSE endpoint includes it while terminal events remain unchanged.

- [ ] **Step 2: Run CI and verify RED**

Expected: `agent_activity` is not accepted/emitted yet.

- [ ] **Step 3: Add deterministic action mapping**

Implement a small pure helper in `orchestrator.ts`:

```ts
function activityFromAgentEvent(event: AgentEvent, state: { failedTestSeen: boolean }): Record<string, unknown> | null
```

Rules:

- `model_turn` → thinking
- `search_files`/`grep` tool variants → searching
- read/list tools → reading
- edit/patch tools → editing, or repairing after failed test evidence is known
- `run_command` with `pnpm test` → testing
- budget terminal → failed when terminal reason is not completed

Never infer hidden reasoning text.

- [ ] **Step 4: Forward activity from `runAgent.onEvent`**

After appending the artifact event, call `deps.onProgress?.({ type: "agent_activity", candidateId, scenarioId, trial, detail })`.

- [ ] **Step 5: Extend API/server progress shape**

Update `ProgressBus` and `apps/web/src/api.ts` types to accept `agent_activity`, `trial`, and safe detail metadata. In `server.ts`, forward orchestrator events directly with `analysisId` and include configured concurrency on `analysis_started` or activity metadata.

- [ ] **Step 6: Verify GREEN and commit**

Expected: root/API/SSE tests green and no secret configuration appears in event payloads.

---

### Task 4: Parallel Experiment State Model + Hybrid Dashboard UI

**Files:**
- Create: `apps/web/src/experiment-state.ts`
- Create: `apps/web/src/experiment-state.test.ts`
- Modify: `apps/web/src/run-progress.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/report-page.tsx`
- Modify: `apps/web/src/scenario-drawer.tsx` only if needed for styling hooks
- Modify: `apps/web/src/workspace.css`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/responsive.css`

**Interfaces:**
- `deriveExperimentState(events: ProgressEvent[], concurrency: number): ExperimentViewModel`
- `ExperimentViewModel` exposes per-scenario and per-candidate status, tool calls, test cycles, action timeline, active run count, and budget-derived progress.

- [ ] **Step 1: Invoke frontend redesign guidance before implementation**

Use the frontend-app-builder skill for the approved redesign, while preserving the approved spec rather than re-brainstorming visual direction.

- [ ] **Step 2: Write RED reducer/model tests**

Given two concurrent candidate activity streams for `FR-03`, assert:

```ts
const model = deriveExperimentState(events, 2);
assert.equal(model.activeRuns, 2);
assert.equal(model.scenarios["FR-03"].candidates.A.status, "running");
assert.equal(model.scenarios["FR-03"].candidates.B.status, "running");
assert.equal(model.scenarios["FR-03"].candidates.A.toolCalls, 14);
assert.equal(model.scenarios["FR-03"].candidates.B.testCycles, 3);
assert.equal(model.scenarios["FR-03"].candidates.B.timeline.at(-1)?.action, "repairing");
```

Assert terminal completion sets progress to `100`, while running progress is capped below `100` and derives from tool/test budgets.

- [ ] **Step 3: Implement `experiment-state.ts` as a pure reducer**

Keep React components presentation-focused. Use constants `maxToolCalls=35`, `maxTestCycles=8` matching the live budget until the API exposes them explicitly.

- [ ] **Step 4: Replace `RunProgress` with the approved parallel layout**

Desktop structure:

```text
Experiments header
┌ scenario rail ┬ Candidate A ┬ Candidate B ┐
│ FR-01 ...     │ status      │ status      │
│ FR-02 ...     │ budgets     │ budgets     │
│ FR-03 active  │ progress    │ progress    │
│ FR-04 ...     │ timeline    │ timeline    │
└───────────────┴──────────────┴──────────────┘
Concurrency 2 · Active runs 2/2
```

Use explicit timeline text labels and mono timestamps/details.

- [ ] **Step 5: Redesign shell/sidebar/overview/settings**

- Dark navy sidebar with indigo FutureProof identity.
- Light near-white main canvas and white cards.
- Thin gray hairlines; minimal shadows.
- IBM Plex Sans stack for UI and IBM Plex Mono stack for technical data.
- Runtime card displays analysis ID, state, concurrency, model, active runs.
- Settings displays provider/model/request timeout/concurrency names without API key value.
- Replace old fallback scenarios with the revised five-scenario set.

- [ ] **Step 6: Redesign comparison/report surfaces without changing report data contracts**

Keep evidence drawer behavior and export/artifact actions. Apply new visual hierarchy to risk scores, ratios, scenario evidence, and code/evidence surfaces.

- [ ] **Step 7: Update React tests**

Add assertions for:

- both A/B simultaneously running;
- runtime card concurrency/model/status;
- revised scenario labels;
- timeline action labels;
- report persistence across navigation;
- no text containing API-key values.

- [ ] **Step 8: Verify component tests/typecheck/build and commit**

Expected: web tests green, `pnpm --dir apps/web run typecheck` green, Vite build green.

---

### Task 5: Browser/Visual Regression for the New Demo Story

**Files:**
- Modify: `apps/web/e2e/report-visual.spec.ts`
- Modify: `apps/web/e2e/workspace-navigation.spec.ts`

**Interfaces:**
- Browser tests use deterministic mocked API/SSE fixtures; they do not spend OpenRouter tokens.

- [ ] **Step 1: Add a RED Playwright case for parallel Experiments**

Mock an analysis where both A and B are active for the same scenario and assert visible text:

```text
Candidate A
Candidate B
Concurrency 2
Active runs 2 / 2
Reading
Editing
Testing
```

- [ ] **Step 2: Update visual fixture expectations**

Capture/verify the redesigned Overview/Report surfaces using the existing screenshot artifact workflow.

- [ ] **Step 3: Preserve navigation regression**

Click all six sidebar destinations during/after an analysis and ensure state/report is retained.

- [ ] **Step 4: Run Playwright and commit**

Expected: all browser tests pass without live model credentials.

---

### Task 6: Full Verification and Documentation Gate

**Files:**
- Modify only if verification exposes defects.

**Interfaces:**
- No new production interface; this task verifies the integrated contract.

- [ ] **Step 1: Run deterministic full CI gate**

Run via GitHub Actions on final head and require:

```text
root tests PASS
web tests PASS
web typecheck PASS
Candidate A/B builds PASS
Vite production build PASS
Candidate A/B 22/22 behavior PASS
Playwright PASS
macOS core PASS
Ubuntu full gate PASS
```

- [ ] **Step 2: Inspect final run logs for concurrency regression**

Confirm no unexpected unhandled rejection, artifact collision, path collision, or action runtime warning appears.

- [ ] **Step 3: Verify docs/env**

Confirm `.env.example` and README include `FUTUREPROOF_ANALYSIS_CONCURRENCY=2` and the valid `1..4` range.

- [ ] **Step 4: Record final head SHA and verification run ID**

Use these as the completion evidence in the handoff.
