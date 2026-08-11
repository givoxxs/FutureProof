# FutureProof Parallel Analysis + Hybrid UI Design

## Status

Approved for implementation on `feat/futureproof-mvp`.

## Goal

Make FutureProof faster and more legible during live demos by running independent candidate/scenario experiments with bounded concurrency and redesigning the dashboard around a Vercel + Linear + Cursor-inspired product language.

The product must continue to make the same defensible claim: **observed cost of implementing the same plausible future change across candidate implementations under controlled conditions**. Parallelism must not weaken isolation or turn machine/provider contention into the thing being measured.

## Scope

This spec covers two coupled product changes:

1. **Bounded parallel experiment execution** with `FUTUREPROOF_ANALYSIS_CONCURRENCY=1..4`, default `2`.
2. **Hybrid dashboard redesign** that makes A/B execution, live agent actions, risk comparison, and evidence easier to understand during a hackathon demo.

It does not change scenario generation, scoring weights, acceptance criteria, sandbox isolation, agent budgets, model configuration, or the evidence model.

## Parallel Execution Model

### Configuration

Add a server-side environment variable:

```env
FUTUREPROOF_ANALYSIS_CONCURRENCY=2
```

Valid values are integers `1`, `2`, `3`, or `4`.

- `1` — deterministic/debug mode; fully sequential.
- `2` — default and recommended; intended to keep Candidate A and Candidate B for the same scenario active together when possible.
- `3` — faster local/demo mode with one extra slot for the next queued run.
- `4` — aggressive mode for machines/providers that tolerate more simultaneous work.

Values outside `1..4`, non-integers, empty non-default strings, or otherwise invalid values must fail fast with a clear configuration error. There is no unlimited mode.

### Unit of Work

The schedulable unit is one isolated:

```text
Candidate × Scenario × Trial
```

Each unit already owns a unique sandbox and artifact directory. Parallel workers must never share editable candidate workspaces.

### Fairness-Oriented Queue Order

The queue is built in frozen scenario order, then trial order, with A/B adjacent for each trial:

```text
FR-01 T1 A
FR-01 T1 B
FR-02 T1 A
FR-02 T1 B
...
FR-04 T1 A
FR-04 T1 B
FR-04 T2 A
FR-04 T2 B
FR-04 T3 A
FR-04 T3 B
...
```

This preserves pair locality. At concurrency `2`, A and B for the same scenario/trial should normally run side by side. At `3` or `4`, remaining capacity may begin later queued work.

### Baselines

Candidate baselines are validated before the experiment queue starts. Baseline validation may remain sequential because it is cheap, provides a clean precondition, and avoids conflating candidate validity with worker scheduling.

### Worker Pool

The orchestrator must use a bounded worker pool rather than `Promise.all()` over all jobs.

Required properties:

- At most `concurrency` jobs active at once.
- All jobs settle; a single scenario failure is represented as run evidence when possible rather than silently cancelling unrelated jobs.
- Existing artifact paths remain stable.
- Final `AnalysisExecution.runs` is returned in deterministic logical queue order, not completion order.
- Each run records its own wall time exactly as today.
- The same configured model client may be used concurrently because it has no mutable conversation state.

### Error Semantics

Infrastructure/configuration errors that prevent the experiment from being meaningful may still fail the analysis. A normal agent run ending in timeout/tool-budget/build failure remains a terminal scenario result, not a scheduler failure.

The worker pool must not swallow rejected promises. If a job throws an unexpected error, the analysis should fail with the original error after active jobs have been allowed to settle/cleanup safely.

## Progress Event Model

The current progress contract is too coarse for parallel execution. Extend it while preserving existing terminal event names.

Every candidate/scenario run event may include:

```ts
trial?: number;
concurrency?: number;
detail?: {
  agentEventType?: "model_turn" | "tool_call" | "tool_result" | "budget";
  tool?: string;
  toolCallsExecuted?: number;
  maxToolCalls?: number;
  testCycles?: number;
  maxTestCycles?: number;
  totalTokens?: number;
  maxTokens?: number;
  action?: "thinking" | "searching" | "reading" | "editing" | "testing" | "repairing" | "done" | "failed";
  label?: string;
};
```

Required lifecycle events remain:

```text
analysis_started
scenario_started
candidate_started
candidate_completed
scenario_completed
analysis_completed
analysis_failed
```

Add a live event type:

```text
agent_activity
```

`agent_activity` is emitted from coding-agent events with candidate/scenario/trial context. It is observational only and must not affect scoring.

### Action Mapping

Map agent tool activity to UI-friendly actions deterministically:

- model turn without tool execution yet → `thinking`
- `search`/grep-like repository tools → `searching`
- `read_file`/list-like tools → `reading`
- patch/write/edit tools → `editing`
- `run_command: pnpm test` → `testing`
- an edit after at least one failed test cycle → `repairing`
- candidate completion → `done`
- unexpected run failure/budget terminal state → `failed` where appropriate

The UI must label these as observed agent actions, not hidden reasoning.

## UI Design Direction

### Design Sources

Use a hybrid rather than cloning one brand:

- **Vercel foundation:** light canvas, strong information hierarchy, thin borders, restrained decoration, compact technical metrics.
- **Linear precision:** dark sidebar, indigo/lavender identity, engineering-tool feel, crisp low-noise surfaces.
- **Cursor timeline:** live action timeline for AI/code-agent behavior.

FutureProof remains its own product. No copied logos, proprietary fonts, or brand-specific visual assets.

### Typography

Use:

- **IBM Plex Sans** for navigation, headings, labels, body text, and metric UI.
- **IBM Plex Mono** for scenario IDs, timestamps, model names, tool counts, code, patches, logs, and tabular technical values.

Prefer system-hosted/fallback-safe loading. Do not commit font binaries. If web fonts are used, load them through CSS from a public provider with sensible fallbacks; tests and builds must not depend on the network.

Typography should feel like an engineering/research instrument:

- headings mostly weight `500–600`, not oversized extra-bold SaaS display type;
- tabular numbers for risk/metrics;
- compact mono captions for evidence metadata;
- high legibility at 1280–1600px demo widths.

### Color System

Core surfaces:

- light page canvas: near-white;
- white cards;
- dark navy/near-black sidebar;
- subtle gray hairlines;
- minimal/no decorative shadows.

Identity and semantic colors:

- Candidate A / FutureProof identity: indigo-lavender.
- Candidate B comparison accent: pink/magenta.
- success: green.
- warning/repair: amber.
- failure: red.
- timeline read/search may use blue/teal variants while remaining accessible.

Pink is comparison semantics, not general decoration.

### Sidebar

Keep the six navigation destinations:

```text
Overview
Future Scenarios
Experiments
Comparisons
Reports
Settings
```

Add an analysis runtime card near the bottom when an analysis exists:

```text
Analysis     da46bcc5
Status       Running
Concurrency  2
Model        deepseek-v4-flash
Active runs  2 / 2
```

The API key must never be exposed to the browser.

### Overview

Overview should answer four questions immediately:

1. Do both candidates pass today? (`22 / 22`, `22 / 22`)
2. Is analysis running/completed?
3. Which candidate has lower observed future risk after completion?
4. How many scenarios are complete?

Use compact metric cards and risk dimension bars. Avoid giant empty hero space once an analysis exists.

### Experiments

Experiments is the signature live-demo screen.

Layout:

- left rail: five frozen scenarios with queued/running/completed state;
- center/right: Candidate A and Candidate B panels side by side for the selected/active scenario;
- each candidate panel shows status, tool calls, tests, files/edits when known, budget-derived progress, and a live action timeline;
- footer shows configured concurrency and active worker count.

Example:

```text
FR-03 · User preferences                         Running

Candidate A                         Candidate B
● Running                           ● Running
Tool calls  14 / 35                 Tool calls  11 / 35
Tests        2 / 8                  Tests        3 / 8

09:42:12 Reading notification.ts    09:42:12 Reading notification.ts
09:42:14 Searching tracker          09:42:15 Editing notification.ts
09:42:18 Editing preference.ts      09:42:22 Testing pnpm test
09:42:25 Testing pnpm test          09:42:31 Repairing notification.ts
```

Progress percentage must be explicitly budget-derived, not presented as model completion prediction. A suitable deterministic display is the maximum of normalized tool-call and test-cycle usage, capped below 100% until terminal completion, then 100%.

### Timeline Semantics

Use a small semantic dot + label system:

```text
Thinking   neutral/warm gray
Searching  teal
Reading    blue
Editing    indigo
Testing    violet
Repairing  amber
Done       green
Failed     red
```

Timeline rows use IBM Plex Mono for timestamps and file/command detail.

### Comparisons

Comparison page should prioritize direct A/B evidence:

- Overall Future Risk A vs B.
- Four risk dimensions.
- Change-effort ratios.
- Regression cycles.
- Clear winner wording only when supported by score/evidence.

### Reports

Preserve the existing evidence drawer and artifact safety model. Redesign report hierarchy to match the new light technical system:

- summary first;
- scenario breakdown;
- deterministic evidence metrics;
- patch/tests/logs in evidence drawer;
- export actions remain available.

### Settings

Show server-side configuration names and effective non-secret runtime values where safe:

- provider;
- model;
- request timeout;
- analysis concurrency;
- API key: `Server-side only`.

No secret value reaches the browser.

## Scenario Labels

Use the revised benchmark set consistently in UI copy:

1. `FR-01` — SMS alternative channel.
2. `FR-02` — Retry with exponential backoff.
3. `FR-03` — Per-user notification preferences.
4. `FR-04` — Idempotent duplicate order-shipped delivery (`3 trials`).
5. `FR-05` — Scheduled delivery / quiet hours.

Do not preserve the older provider-fallback/push scenario labels in live UI fallback constants.

## Responsive Behavior

Primary target is desktop demo width (`1280px+`).

- At medium widths, candidate experiment panels may stack while scenario rail remains usable.
- Sidebar may collapse to a compact rail at tablet widths.
- Mobile is supported functionally, but desktop information density is the priority for the hackathon demo.

## Accessibility

- Navigation remains real buttons with `aria-current`.
- Running state cannot rely on color alone.
- Timeline actions include text labels.
- Risk bars expose textual values.
- Focus rings remain visible on dark and light surfaces.
- Candidate A/B colors meet usable contrast requirements against card backgrounds.

## Testing Requirements

### Engine

Add tests proving:

- concurrency parser defaults to `2`;
- only `1..4` are accepted;
- worker pool never exceeds configured concurrency;
- concurrency `2` starts A/B pair work concurrently when both are queued;
- result ordering remains deterministic even when completion order differs;
- sandboxes/artifact paths stay unique;
- unexpected worker errors clean up and reject the analysis rather than hanging;
- concurrency `1` preserves sequential behavior.

### API / Progress

Add tests proving:

- `agent_activity` events carry candidate/scenario/trial context;
- runtime concurrency is emitted or retrievable without exposing secrets;
- existing SSE terminal behavior still works.

### Web

Add React tests proving:

- parallel A/B active states render simultaneously;
- tool/test budget metrics update from activity events;
- timeline rows map deterministic action labels;
- sidebar runtime card shows concurrency/model/status without API key;
- revised scenario labels are used;
- switching views does not lose in-progress or completed state.

### Browser / Visual

Update Playwright coverage/screenshots for:

- redesigned Overview;
- parallel Experiments state with both A/B active;
- completed Report;
- navigation preservation.

## Documentation

Update `.env.example` and README with:

```env
FUTUREPROOF_ANALYSIS_CONCURRENCY=2
```

Explain `1..4` and recommend `2` for fair local demos.

Keep `OPENROUTER_REQUEST_TIMEOUT_MS` independent from concurrency.

## Non-Goals

- No distributed queue.
- No worker threads/process pool solely for CPU parallelism; async bounded jobs are sufficient for this I/O-heavy workflow.
- No unlimited concurrency.
- No changes to risk weights or score formulas.
- No exposing chain-of-thought or hidden model reasoning.
- No API key in frontend state or SSE.
- No proprietary font files committed to the repository.
