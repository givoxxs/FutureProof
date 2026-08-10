# FutureProof pnpm + OpenRouter Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate FutureProof to pnpm 11.4.0, add a Makefile and stronger ignore policy, and make all live-model configuration OpenRouter-native while preserving experiment behavior.

**Architecture:** Keep package-local scripts and the existing OpenAI-compatible transport, but move orchestration to a single pnpm workspace plus a thin Makefile. Runtime configuration is normalized at the boundary to `OPENROUTER_*`; deterministic CI remains credential-free, while the manual smoke workflow is the only live-model gate.

**Tech Stack:** Node.js 22, TypeScript, pnpm 11.4.0, GNU Make, Fastify, Vite/React, Playwright, GitHub Actions, OpenRouter chat-completions compatibility.

## Global Constraints

- Pin `packageManager` exactly to `pnpm@11.4.0`.
- Use one root `pnpm-lock.yaml`; remove all committed `package-lock.json` files.
- `pnpm-workspace.yaml` is the only workspace definition.
- Ignore `.env`/`.env.*` but keep `.env.example` tracked.
- Default OpenRouter base URL is `https://openrouter.ai/api/v1`.
- Default model is `deepseek/deepseek-v4-flash-0731`; alternative is `openai/gpt-5.6-luna-pro`.
- A live OpenRouter call must require `OPENROUTER_API_KEY`; deterministic CI must not require credentials.
- No scoring, scenario, sandbox, API-response, or UI behavior changes.

---

### Task 1: Convert the repository to one pnpm workspace and harden ignores

**Files:**
- Modify: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Delete: `fixtures/notification-demo/base/package-lock.json`
- Delete: `fixtures/notification-demo/candidate-a/package-lock.json`
- Delete: `fixtures/notification-demo/candidate-b/package-lock.json`

**Interfaces:**
- Produces: a root pnpm workspace that resolves `apps/*`, `packages/*`, and all three notification-demo packages.
- Produces: one lockfile accepted by `pnpm install --frozen-lockfile`.

- [ ] **Step 1: Write a migration verification script/test first**

Add a temporary assertion in the implementation workspace (or a shell check in the task execution notes) that fails until the migration exists:

```bash
test -f pnpm-workspace.yaml
test -f pnpm-lock.yaml
test ! -f fixtures/notification-demo/base/package-lock.json
test ! -f fixtures/notification-demo/candidate-a/package-lock.json
test ! -f fixtures/notification-demo/candidate-b/package-lock.json
grep -q '"packageManager": "pnpm@11.4.0"' package.json
git check-ignore -q .env
git check-ignore -q .pnpm-store/cache
test "$(git check-ignore .env.example || true)" = ""
```

- [ ] **Step 2: Run the checks and verify RED**

Expected: fail because `pnpm-workspace.yaml`, `pnpm-lock.yaml`, packageManager pin, and ignore rules are absent.

- [ ] **Step 3: Update `package.json`**

Remove the root `workspaces` field, keep existing scripts, add:

```json
"packageManager": "pnpm@11.4.0"
```

Update `demo:verify` to:

```json
"demo:verify": "pnpm --dir fixtures/notification-demo/candidate-a test && pnpm --dir fixtures/notification-demo/candidate-b test"
```

- [ ] **Step 4: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*
  - fixtures/notification-demo/base
  - fixtures/notification-demo/candidate-a
  - fixtures/notification-demo/candidate-b
```

- [ ] **Step 5: Expand `.gitignore`**

Use exactly this intent:

```gitignore
# Secrets / local environment
.env
.env.*
!.env.example

# Dependencies / package-manager state
node_modules/
.pnpm-store/

# FutureProof run artifacts
.futureproof/

# Build / test output
dist/
coverage/
playwright-report/
test-results/

# Logs
*.log
npm-debug.log*
pnpm-debug.log*
yarn-debug.log*
yarn-error.log*

# Editor / OS
.DS_Store
Thumbs.db
.idea/
.vscode/
*.swp
```

- [ ] **Step 6: Generate the pnpm lockfile and remove npm lockfiles**

Run:

```bash
corepack enable
corepack prepare pnpm@11.4.0 --activate
rm -f fixtures/notification-demo/{base,candidate-a,candidate-b}/package-lock.json
pnpm install --lockfile-only
pnpm install --frozen-lockfile
```

Expected: install succeeds without modifying `pnpm-lock.yaml` on the frozen pass.

- [ ] **Step 7: Re-run migration verification**

Expected: all checks pass.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .gitignore fixtures/notification-demo
git commit -m "build: migrate workspace to pnpm"
```

---

### Task 2: Add Makefile developer and CI entrypoints

**Files:**
- Create: `Makefile`
- Modify: `package.json`

**Interfaces:**
- Produces targets: `install`, `test`, `typecheck`, `build`, `dev`, `dev-api`, `dev-web`, `visual-test`, `demo-verify`, `smoke`, `ci`.

- [ ] **Step 1: Write a target-existence check**

```bash
for target in install test typecheck build dev dev-api dev-web visual-test demo-verify smoke ci; do
  make -n "$target" >/dev/null
done
```

- [ ] **Step 2: Run it and verify RED**

Expected: fail because `Makefile` does not exist.

- [ ] **Step 3: Create the Makefile**

```make
SHELL := /bin/bash
PNPM := pnpm

.PHONY: install test typecheck build dev dev-api dev-web visual-test demo-verify smoke ci

install:
	$(PNPM) install --frozen-lockfile

test:
	$(PNPM) test
	$(PNPM) --dir apps/web test

typecheck:
	$(PNPM) run typecheck
	$(PNPM) --dir apps/web run typecheck
	$(PNPM) --dir fixtures/notification-demo/candidate-a run build
	$(PNPM) --dir fixtures/notification-demo/candidate-b run build

build:
	$(PNPM) --dir apps/web run build
	$(PNPM) --dir fixtures/notification-demo/candidate-a run build
	$(PNPM) --dir fixtures/notification-demo/candidate-b run build

dev-api:
	set -a; test ! -f .env || source ./.env; set +a; $(PNPM) --dir apps/api dev

dev-web:
	$(PNPM) --dir apps/web dev

dev:
	@trap 'kill 0' INT TERM EXIT; \
	  $(MAKE) dev-api & \
	  $(MAKE) dev-web & \
	  wait

visual-test:
	$(PNPM) --dir apps/web exec playwright install --with-deps chromium
	$(PNPM) --dir apps/web run visual:test

demo-verify:
	$(PNPM) run demo:verify

smoke:
	set -a; test ! -f .env || source ./.env; set +a; $(PNPM) run smoke:real-model

ci: test typecheck build demo-verify
	$(PNPM) --dir apps/web run visual:test
```

- [ ] **Step 4: Keep root scripts package-focused**

Do not duplicate Make orchestration into package scripts. Preserve `test`, `typecheck`, `demo:verify`, and `smoke:real-model` as callable pnpm scripts.

- [ ] **Step 5: Verify Make targets**

Run:

```bash
make -n install
make -n test
make -n typecheck
make -n build
make -n dev
make -n visual-test
make -n ci
```

Expected: each expands to pnpm commands only; no npm/npx command appears.

- [ ] **Step 6: Commit**

```bash
git add Makefile package.json
git commit -m "build: add Makefile developer workflow"
```

---

### Task 3: Normalize runtime and smoke configuration to OpenRouter

**Files:**
- Modify: `.env.example`
- Modify: `apps/api/src/server.ts`
- Modify: `packages/engine/src/real-model-smoke.ts`
- Modify: `tests/engine/real-model-smoke.test.ts`
- Modify: `.github/workflows/real-model-smoke.yml`

**Interfaces:**
- Consumes: `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`.
- Produces: the same `ModelConfig` consumed by `OpenAiCompatibleClient`.

- [ ] **Step 1: Update smoke tests first**

Change the test environment fixtures to use:

```ts
{
  OPENROUTER_API_KEY: "sk-or-test",
  OPENROUTER_MODEL: "deepseek/deepseek-v4-flash-0731",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
}
```

Add assertions that:

```ts
assert.equal(resolved.config.model, "deepseek/deepseek-v4-flash-0731");
assert.equal(resolved.config.baseUrl, "https://openrouter.ai/api/v1");
```

and that `REQUIRE_REAL_MODEL=1` without `OPENROUTER_API_KEY` throws a message naming `OPENROUTER_API_KEY`.

- [ ] **Step 2: Run targeted tests and verify RED**

Run:

```bash
pnpm test -- tests/engine/real-model-smoke.test.ts
```

Expected: fail because production code still reads `OPENAI_*`.

- [ ] **Step 3: Update `resolveRealModelSmokeConfig`**

Read `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `OPENROUTER_BASE_URL`; default base URL to `https://openrouter.ai/api/v1`; keep `REQUIRE_REAL_MODEL` behavior unchanged.

- [ ] **Step 4: Update API runtime config**

Replace `requireEnv("LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL")` with OpenRouter names. Make only the API key strictly required; use these defaults when unset:

```ts
const baseUrl = process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
const modelName = process.env.OPENROUTER_MODEL?.trim() || "deepseek/deepseek-v4-flash-0731";
```

Require:

```ts
const apiKey = requireEnv("OPENROUTER_API_KEY");
```

- [ ] **Step 5: Update `.env.example`**

```env
OPENROUTER_API_KEY=sk-or-v1-replace-me
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731

# Alternative:
# OPENROUTER_MODEL=openai/gpt-5.6-luna-pro
```

- [ ] **Step 6: Update manual smoke workflow**

Use `OPENROUTER_API_KEY` secret and `OPENROUTER_MODEL`/`OPENROUTER_BASE_URL` repository variables. Shell-resolve defaults before running smoke so absent variables use the documented values.

- [ ] **Step 7: Run tests**

```bash
pnpm test
```

Expected: all engine/core/API/golden/smoke-contract tests pass.

- [ ] **Step 8: Commit**

```bash
git add .env.example apps/api/src/server.ts packages/engine/src/real-model-smoke.ts tests/engine/real-model-smoke.test.ts .github/workflows/real-model-smoke.yml
git commit -m "feat: configure live models through OpenRouter"
```

---

### Task 4: Migrate GitHub Actions to pnpm and Make

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `pnpm-lock.yaml`, pnpm 11.4.0, Makefile targets.
- Produces: the same deterministic CI gates and visual-QA artifact as before.

- [ ] **Step 1: Change install bootstrap**

Use Node 22 plus Corepack:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- name: Enable pnpm 11.4.0
  run: |
    corepack enable
    corepack prepare pnpm@11.4.0 --activate
- name: Install workspace dependencies
  run: pnpm install --frozen-lockfile
```

- [ ] **Step 2: Replace npm/npx commands**

Use pnpm/Make equivalents. Keep screenshot upload as a separate `actions/upload-artifact` step. Install Chromium with:

```yaml
run: pnpm --dir apps/web exec playwright install --with-deps chromium
```

- [ ] **Step 3: Keep deterministic gates explicit**

The workflow must still run root tests, web tests, web typecheck/build, Playwright visual QA, demo verification, and both candidate typechecks. It must not call `make smoke`.

- [ ] **Step 4: Push and inspect GitHub Actions RED/GREEN if needed**

Expected final CI: all previous gates pass using pnpm only.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run FutureProof with pnpm"
```

---

### Task 5: Update developer documentation and perform final migration verification

**Files:**
- Modify: `README.md`
- Modify if old names occur: `docs/architecture.md`
- Modify if old names occur: `docs/methodology.md`
- Modify if old names occur: `docs/demo-script.md`

**Interfaces:**
- Produces: one documented local path: `corepack -> make install -> cp .env.example .env -> make dev`.

- [ ] **Step 1: Search for stale commands/config names**

Run:

```bash
grep -RInE 'npm |npx |OPENAI_|LLM_' README.md docs .github apps packages scripts package.json Makefile || true
```

Expected before docs migration: stale references remain.

- [ ] **Step 2: Update README**

Document:

```bash
corepack enable
corepack prepare pnpm@11.4.0 --activate
make install
cp .env.example .env
make dev
```

Document model switching as changing one line:

```env
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731
# or
OPENROUTER_MODEL=openai/gpt-5.6-luna-pro
```

List the Make targets and state that `make ci` is deterministic while `make smoke` is a paid/live OpenRouter call when credentials are present.

- [ ] **Step 3: Remove stale configuration names in relevant docs**

Do not rewrite methodology/scoring sections unless they contain `OPENAI_*`, `LLM_*`, npm, or npx instructions.

- [ ] **Step 4: Run the full local deterministic gate**

```bash
make ci
```

Expected:
- 76 engine/core/API/golden/smoke-contract tests pass.
- 6 React tests pass.
- web typecheck and production build pass.
- 2 Playwright visual tests pass (after Chromium is installed).
- Candidate A remains 22/22.
- Candidate B remains 22/22.
- both candidate builds pass.

- [ ] **Step 5: Run migration hygiene checks**

```bash
find . -name package-lock.json -print
test -f pnpm-lock.yaml
grep -RInE 'OPENAI_|LLM_' .env.example README.md apps/api packages/engine scripts .github || true
grep -RInE 'npm |npx ' README.md .github package.json Makefile || true
git check-ignore .env
git check-ignore .env.local
test "$(git check-ignore .env.example || true)" = ""
```

Expected: no package-lock paths, no stale live-model variable names, no repository-owned npm/npx instructions, `.env` and `.env.local` ignored, `.env.example` tracked.

- [ ] **Step 6: Verify the final GitHub Actions run on the exact final SHA**

The branch's latest `FutureProof CI` run must complete successfully with pnpm installation, deterministic tests, web build/typecheck, Playwright, demo verification, and candidate typechecks.

- [ ] **Step 7: Commit documentation**

```bash
git add README.md docs
git commit -m "docs: document pnpm and OpenRouter workflow"
```
