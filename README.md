# FutureProof

FutureProof asks a different code-review question:

> **Both pull requests pass today's tests. Which implementation will be easier to change tomorrow?**

It freezes plausible future requirements, gives the same coding agent the same budget for both candidates, runs every candidate/scenario pair in an isolated sandbox, and scores only observed evidence: task outcome, agent effort, regression pressure, and structural change.

**LLMs propose and act. FutureProof measures.**

## Hackathon demo

The repository includes a controlled notification-system fixture with two behaviorally equivalent candidates:

- **Candidate A — decoupled** delivery/tracking responsibilities.
- **Candidate B — coupled** delivery/tracking/provider logic.
- Both candidates start at **22/22 passing tests**.
- Five frozen future scenarios are applied to both candidates.
- The hard scenario, `FR-04`, is repeated **3 times per candidate**; the other scenarios run once.
- A complete deterministic golden run therefore contains **14 candidate executions**.

The dashboard shows current-test parity, overall future risk, measured effort, regression evidence, structural deltas, per-scenario outcomes, and an evidence drawer with tool-event/patch access through opaque API identifiers.

## What is controlled

FutureProof is designed to compare implementations rather than prompts or luck:

- Future scenarios are frozen before candidate execution.
- Scenario generation is blind to Candidate A/B implementation details.
- Both candidates use the same model, agent tool surface, command allowlist, budgets, and scenario order.
- Each `Candidate × Scenario × Trial` runs in an isolated sandbox.
- Agent commands are restricted to the exact allowed test/build commands.
- Regression probes run after edits without exposing their hidden score to the agent.
- Repeated trials use scalar medians and majority status.
- Scores are deterministic; the LLM does not grade itself.

See [Methodology](docs/methodology.md) for the complete scoring and fairness rules.

## Repository layout

```text
apps/
  api/        Fastify API, SSE progress, safe artifact/export routes
  web/        React + Vite experiment dashboard
packages/
  core/       schemas, artifact/path helpers
  engine/     analyzer, scenario validation, sandbox/agent loop,
              metrics, scoring, report exports, model adapters
fixtures/
  notification-demo/
              base requirement, equivalent A/B candidates,
              frozen scenarios and acceptance tests
tests/
  api/        lifecycle, SSE, path-safety and export contracts
  engine/     analyzer, agent, metrics, scoring and smoke contracts
  golden/     deterministic end-to-end analysis vertical slice
```

See [Architecture](docs/architecture.md) for the data flow and trust boundaries.

## Quick start

Requirements: Node.js 22+ and npm.

```bash
npm install
npm test
npm run demo:verify
npm --prefix apps/web test
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
```

The two fixture candidates can also be checked directly:

```bash
npm --prefix fixtures/notification-demo/candidate-a test
npm --prefix fixtures/notification-demo/candidate-b test
```

## Run the live demo

The default API runner is intentionally credential-gated. Configure an OpenAI-compatible endpoint:

```bash
export LLM_BASE_URL="https://api.example.com/v1"
export LLM_API_KEY="..."
export LLM_MODEL="your-model"
```

Start the API and web app in separate terminals:

```bash
npm --prefix apps/api run dev
npm --prefix apps/web run dev
```

Open the Vite URL (normally `http://localhost:5173`). Vite proxies `/api` to the Fastify server on port `3001`.

The browser never submits candidate filesystem paths. The hackathon endpoint owns the fixture paths server-side.

## Deterministic CI vs. real-model smoke

Normal CI does **not** spend model tokens. It uses injected fake clients for deterministic tests while still exercising the real orchestrator, artifact persistence, scoring, export, API, and browser flows.

A separate manual GitHub Actions workflow, **FutureProof Real Model Smoke**, exists for a real OpenAI-compatible JSON completion. It requires:

- repository secret `OPENAI_API_KEY`
- repository variable `OPENAI_MODEL`
- optional repository variable `OPENAI_BASE_URL` (defaults to `https://api.openai.com/v1`)

The manual workflow sets `REQUIRE_REAL_MODEL=1`, so missing credentials fail explicitly instead of silently reporting a fake success.

Local smoke behavior is intentionally softer:

```bash
OPENAI_API_KEY="..." OPENAI_MODEL="..." npm run smoke:real-model
```

Without credentials, that local command reports `SKIPPED`.

## Reports and reproducibility

A completed analysis is persisted under:

```text
.futureproof/runs/<analysisId>/
```

Per-run evidence contains metadata, tool events, test results, patch, metrics, and summary artifacts. The safe export bundle is written to:

```text
.futureproof/runs/<analysisId>/exports/
  report.json
  report.md
  manifest.json
```

`manifest.json` includes SHA-256 checksums for the JSON and Markdown reports. Public report/export responses strip server-only `patchPath` and `artifactDir` fields. Raw patch/event evidence is fetched only through allowlisted opaque routes.

The dashboard's **Export** action downloads the server-generated `report.json`; it does not rebuild a separate client-side report.

## Risk model

FutureProof produces four deterministic dimensions:

- **Resilience risk** — scenario success/partial/failure outcomes.
- **Efficiency risk** — tool calls, files touched, edits, test runs, and token use relative to the better candidate.
- **Regression risk** — failed-test pressure and failed regression snapshots during edits.
- **Structural risk** — positive structural-delta magnitude from complexity, duplication, dependency fan-out, and file growth.

Overall risk uses weights `40% / 25% / 20% / 15%` respectively. Missing regression or structural evidence stays `null`; available dimensions are reweighted rather than treating missing evidence as zero risk.

## Security boundaries

- Browser requests cannot supply filesystem paths for the demo.
- Sandbox file tools reject absolute paths, traversal, and symlink escapes.
- Reads are size-capped.
- Patches must match exactly one expected occurrence.
- Shell access is not exposed; only exact allowlisted commands can spawn.
- Export filenames are an exact allowlist: `report.json`, `report.md`, `manifest.json`.
- Public analysis/scenario payloads strip internal artifact paths.

## Verification surfaces

The project contains automated checks for:

- 22/22 current behavior in both candidates
- scenario neutrality and frozen acceptance contracts
- sandbox/path/command isolation
- coding-agent budgets and event persistence
- regression and structural metrics
- repeated-trial aggregation and deterministic scoring
- API lifecycle, SSE progress and artifact security
- safe reproducible exports with checksums
- a 14-run golden vertical slice
- React component behavior and keyboard-accessible evidence drawer
- desktop/mobile Playwright visual QA and mobile overflow checks
- real-model smoke configuration/response contracts

## Demo

For a judge-friendly walkthrough, use the [2-minute demo script](docs/demo-script.md).

## Limitations

FutureProof is a controlled stress test, not a proof of long-term maintainability. Scenario quality, model capability, budget choices, acceptance-test quality, and the chosen metrics all shape the result. Scores are comparative evidence for a defined experiment; they should not be interpreted as universal code-quality scores.

The included fixture is deliberately small enough for a reproducible hackathon demonstration. Generalizing to arbitrary repositories would require broader package-manager/build-system support, stronger dependency isolation, and more domain-specific acceptance-test generation.
