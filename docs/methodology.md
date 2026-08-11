# FutureProof Methodology

FutureProof compares the **observed cost of changing two currently-correct implementations** under a controlled set of future requirements.

The benchmark is intentionally split into two roles:

1. **Generative role:** an LLM may propose future scenarios and a coding agent may attempt the changes.
2. **Measurement role:** deterministic code records outcomes, effort, regression pressure, structural deltas, and resource use. The LLM does not assign the final score.

This separation is the central methodological rule: **LLMs propose and act; the system measures.**

## 1. Experimental question

Given:

- one current requirement,
- two candidate implementations that both pass the current test suite,
- the same future requirements,
- the same coding-agent configuration and resource budget,

which candidate creates less observed friction when the system evolves?

FutureProof does not claim to measure universal maintainability. It measures comparative future-change friction for a defined scenario set and execution protocol.

## 2. Baseline validity

A candidate is scoreable only if its current baseline is valid:

- current tests complete successfully,
- current test failures are zero,
- build/typecheck succeeds.

An invalid candidate produces `INVALID` runs and is not assigned a Future Risk score.

The included notification fixture starts both Candidate A and Candidate B at **22/22 passing current tests**.

## 3. Blind scenario generation

Scenario generation is designed to avoid choosing futures that favor one implementation.

The generator receives base-domain/current-requirement context, not Candidate A/B implementation details. Tests enforce that prompts do not contain candidate names, candidate paths, candidate implementation symbols, or diff context.

A critic/validator rejects scenarios that are:

- implementation-prescriptive,
- duplicates after requirement normalization,
- dependent on unavailable external systems,
- missing behavioral acceptance contracts,
- outside the configured difficulty profile.

For the hackathon demo the accepted profile is frozen to:

- **1 easy** scenario,
- **3 medium** scenarios,
- **1 hard** scenario.

## 4. Frozen demo scenarios

The repository freezes five scenarios in `fixtures/notification-demo/scenarios.json`:

| ID | Future requirement | Dimension | Difficulty |
| --- | --- | --- | --- |
| FR-01 | Add SMS shipment notifications | breadth | medium |
| FR-02 | Add per-user notification preferences | policy | medium |
| FR-03 | Retry failed deliveries | reliability | medium |
| FR-04 | Add provider fallback | composition | hard |
| FR-05 | Add push notifications | extension | easy |

Each scenario contains provenance and an acceptance contract expressed as `given / when / then` behavior. Acceptance tests are injected from the frozen fixture rather than generated after observing a candidate's implementation.

## 5. Fair execution protocol

A single shuffled scenario order is produced for an analysis and reused for both candidates.

For each `Candidate × Scenario × Trial`:

1. create a fresh isolated sandbox from the candidate,
2. verify the baseline,
3. inject the frozen acceptance test,
4. run the same coding-agent loop with the same model and budget,
5. record every agent/tool event,
6. probe current regression pressure after edits,
7. run final current + future checks,
8. collect deterministic metrics,
9. persist run artifacts.

The coding agent has a deliberately narrow tool surface. File operations reject absolute paths, traversal, and symlink escapes. Reads are size-capped. Patch operations require exactly one expected match. Command execution is limited to the exact configured test/build commands.

## 6. Trial policy

The demo uses:

- FR-01: 1 trial per candidate,
- FR-02: 1 trial per candidate,
- FR-03: 1 trial per candidate,
- FR-04: **3 trials per candidate**,
- FR-05: 1 trial per candidate.

That yields **7 executions per candidate, 14 total executions** for one complete analysis.

FR-04 is repeated because it is the hard composition scenario and therefore the most likely to show model/run variance.

### Repeated-trial aggregation

For a repeated scenario:

- scalar metrics use the **median** across valid trials,
- scenario status uses **majority status**,
- ties are broken toward the more severe status,
- all raw trials remain persisted and inspectable.

Severity ordering for ties is:

`BUILD_BROKEN > BUDGET_EXHAUSTED > FAIL > PARTIAL > SUCCESS`.

## 7. Status semantics

Valid run statuses include:

- `SUCCESS`
- `PARTIAL`
- `FAIL`
- `BUDGET_EXHAUSTED`
- `BUILD_BROKEN`

For resilience scoring their success weights are:

| Status | Weight |
| --- | ---: |
| SUCCESS | 1.0 |
| PARTIAL | 0.5 |
| FAIL | 0.0 |
| BUDGET_EXHAUSTED | 0.0 |
| BUILD_BROKEN | 0.0 |

`INVALID` is not a scoreable status.

## 8. Evidence collected

### 8.1 Change/agent effort

Per run FutureProof records:

- tool calls,
- read operations,
- search operations,
- edit operations,
- test runs,
- token use,
- wall time.

It also records change surface:

- files touched,
- modules touched,
- lines added/deleted,
- public-API files touched.

### 8.2 Regression pressure

After an edit, the regression probe runs the current test suite and records snapshots:

```text
cycle, passed tests, failed tests, timestamp
```

Two aggregate signals are used:

- **regression area:** sum of failed current tests across snapshots,
- **failed regression snapshots:** number of snapshots with at least one failure.

If a run contains edits but no valid regression snapshots, regression evidence is treated as unavailable rather than zero.

The agent is not fed the hidden regression score, reducing the opportunity to optimize specifically for the benchmark metric.

### 8.3 Structural delta

FutureProof parses code structure and records deltas for:

- cyclomatic complexity,
- duplicate line windows,
- dependency fan-out,
- file-size lines.

Structural changes may be negative when a refactor improves a measure. For risk magnitude, only positive increases contribute:

```text
max(0, complexity delta)
+ max(0, duplicate-window delta)
+ max(0, fan-out delta)
+ max(0, file-size-line delta) / 20
```

If structural parsing is unavailable, structural evidence is `null`, never silently converted to zero.

## 9. Deterministic scoring

FutureProof computes four risk dimensions on a `0–100` scale.

### 9.1 Resilience risk

For each candidate:

```text
resilience risk
= 100 - average(scenario status weight) × 100
```

A candidate that succeeds every future scenario has resilience risk `0`. Partial or failed outcomes increase risk.

### 9.2 Relative penalty curve

Efficiency, regression, and structural risk compare a candidate to the better observed value between A and B.

For a non-negative metric value `v` and the better value `b`:

```text
ratio = v / b
penalty = clamp(((ratio - 1) / 2) × 100, 0, 100)
```

Therefore:

- `1×` the better value → `0` risk,
- `2×` → `50` risk,
- `3×` or worse → `100` risk.

A tiny denominator floor prevents division by zero inside the penalty function.

### 9.3 Efficiency risk

Efficiency risk is the average relative penalty across five metrics:

1. tool calls,
2. files touched,
3. edit operations,
4. test runs,
5. token use.

### 9.4 Regression risk

When regression evidence is available for both candidates, regression risk averages two relative penalties:

- total regression area,
- total failed regression snapshots.

If either side lacks valid regression evidence, regression risk is `null`.

### 9.5 Structural risk

When structural evidence is available for both candidates, structural risk is the relative penalty of total structural magnitude.

If structural evidence is unavailable, structural risk is `null`.

### 9.6 Overall Future Risk

Default weights are:

| Dimension | Weight |
| --- | ---: |
| Resilience | 40% |
| Efficiency | 25% |
| Regression | 20% |
| Structural | 15% |

Overall risk is the weighted average of available dimensions.

**Missing evidence is not zero risk.** If a nullable dimension is missing, its weight is removed and the remaining weights are renormalized.

## 10. Reported A/B ratios

The report also exposes direct B-to-A ratios for judge-readable evidence:

- tool calls,
- files touched,
- regression area,
- token usage.

When Candidate A's denominator is zero, the ratio is represented as `null` / `not comparable` rather than inventing an infinite or zero value.

## 11. LLM explanations are numerically grounded

FutureProof may ask an LLM to turn evidence into prose, but it validates numeric claims against the evidence supplied to that explanation step.

If an explanation invents an unsupported number, the system rejects it and falls back to deterministic evidence-only prose. The LLM is therefore not an authority for scores or measurements.

## 12. Artifacts and reproducibility

Every run persists evidence under:

```text
.futureproof/runs/<analysisId>/<candidate>/<scenario>/trial-<n>/
```

The run artifact set includes:

- `metadata.json`
- `tool-events.jsonl`
- `test-results.json`
- `patch.diff`
- `metrics.json`
- `summary.json`

A completed analysis also creates:

```text
.futureproof/runs/<analysisId>/exports/
  report.json
  report.md
  manifest.json
```

The manifest contains SHA-256 checksums for the public JSON and Markdown reports.

The deterministic golden test runs the full 14-execution orchestration path with injected deterministic agent behavior, verifies artifacts, builds the scored A/B report, and verifies the export checksums. It intentionally avoids external model calls so CI is reproducible.

## 13. Real-model validation

Real-model validation is separated from deterministic CI.

`npm run smoke:real-model` validates one OpenAI-compatible JSON completion contract. The GitHub Actions workflow **FutureProof Real Model Smoke** is manual and sets `REQUIRE_REAL_MODEL=1`, so it fails if required credentials are absent.

This smoke test demonstrates that the adapter can reach a real compatible model endpoint; it does **not** replace the deterministic golden benchmark and it is not evidence that every 14-run experiment will be identical across model executions.

## 14. Threats to validity

FutureProof reduces several forms of benchmark bias, but does not eliminate all of them.

### Scenario validity

A plausible future set is still a sample, not the true future. Different valid scenario sets can change comparative results.

### Acceptance-test validity

The benchmark only measures behavior encoded in its acceptance contracts. Weak or over-specific tests can distort the comparison.

### Model variance

A coding model may solve the same task differently across runs. Repeating the hard scenario and retaining raw trials reduces but does not eliminate variance.

### Budget sensitivity

A candidate may look worse under a strict tool/token/test budget but converge under a larger one. The budget is part of the experimental definition.

### Metric sensitivity

Tool calls, files touched, regression pressure, and structural deltas are useful signals, not universal definitions of maintainability.

### Fixture scope

The included notification fixture is intentionally small for a hackathon-quality controlled demonstration. Supporting arbitrary repositories requires more build systems, package managers, languages, dependency isolation strategies, and domain-specific acceptance-test generation.

## 15. Interpretation rule

The safest way to read a FutureProof result is:

> Under these frozen future requirements, this agent, this budget, and these acceptance tests, Candidate X showed more or less observed change friction than Candidate Y.

It should not be read as:

> Candidate X has an objectively universal maintainability score of N.
