# FutureProof pnpm + OpenRouter Migration Design

Date: 2026-08-10
Branch: `feat/futureproof-mvp`

## Goal

Migrate FutureProof from npm-oriented workspace commands to pnpm, add a Makefile as the primary developer entrypoint, and make the live model configuration explicitly OpenRouter-native.

This migration must not change FutureProof's experiment semantics, scenario set, scoring formula, sandbox controls, API contracts, or UI behavior.

## Package manager

### Version

Pin pnpm through the root manifest:

```json
{
  "packageManager": "pnpm@11.4.0"
}
```

Node.js remains pinned to Node 22 in CI.

### Workspace definition

Use a single `pnpm-workspace.yaml` as the workspace source of truth. It includes:

- `apps/*`
- `packages/*`
- `fixtures/notification-demo/base`
- `fixtures/notification-demo/candidate-a`
- `fixtures/notification-demo/candidate-b`

Remove the root npm `workspaces` field so the repository does not have two workspace definitions.

### Lockfiles

- Commit one root `pnpm-lock.yaml`.
- Remove all committed `package-lock.json` files from demo fixtures.
- CI uses `pnpm install --frozen-lockfile` after the migration lockfile is committed.
- Do not retain npm and pnpm lockfiles side-by-side.

### Script migration

All repository-owned commands move from npm invocation syntax to pnpm syntax. Examples:

- `npm test` -> `pnpm test`
- `npm --prefix apps/web test` -> `pnpm --dir apps/web test`
- `npm --prefix fixtures/notification-demo/candidate-a test` -> `pnpm --dir fixtures/notification-demo/candidate-a test`
- `npx playwright ...` -> `pnpm --dir apps/web exec playwright ...`

The underlying package scripts remain focused on package-local behavior.

## Makefile

Add a root `Makefile` as the ergonomic developer interface.

Required targets:

```text
make install
make test
make typecheck
make build
make dev
make dev-api
make dev-web
make visual-test
make demo-verify
make smoke
make ci
```

Semantics:

- `install`: `pnpm install --frozen-lockfile`
- `test`: engine/core/API tests plus web component tests
- `typecheck`: root TypeScript check, web typecheck, Candidate A build/typecheck, Candidate B build/typecheck
- `build`: production web build plus candidate typechecks
- `dev-api`: load `.env` when present, then run the API dev process
- `dev-web`: run the Vite dev process
- `dev`: launch API and web development processes through a simple shell trap/wait orchestration; do not add a process-manager dependency solely for this target
- `visual-test`: install/use Playwright browser prerequisites as documented and run visual tests
- `demo-verify`: run Candidate A and Candidate B current-behavior tests
- `smoke`: run the real-model smoke command
- `ci`: run the deterministic local equivalent of the repository's CI checks, excluding live model calls

The Makefile delegates to pnpm/package scripts rather than duplicating business logic.

## OpenRouter configuration

### Environment contract

Replace the mixed `LLM_*` and `OPENAI_*` runtime configuration with OpenRouter-native names:

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731

# Alternative model:
# OPENROUTER_MODEL=openai/gpt-5.6-luna-pro
```

The dated DeepSeek page linked for the July 31 revision identifies the model as `deepseek/deepseek-v4-flash-0731`. The GPT alternative remains `openai/gpt-5.6-luna-pro`.

### Defaults

- Base URL default: `https://openrouter.ai/api/v1`
- Default model: `deepseek/deepseek-v4-flash-0731`
- Alternative documented model: `openai/gpt-5.6-luna-pro`
- API key remains required for live execution.

The runtime should permit switching between the two models by changing only `OPENROUTER_MODEL`.

### Client implementation

Keep the existing `OpenAiCompatibleClient` abstraction because OpenRouter exposes an OpenAI-compatible chat-completions interface. Do not rename the generic transport class solely for branding.

Update only the configuration boundary:

- API server reads `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`.
- Real-model smoke reads the same names.
- GitHub manual smoke workflow uses the same secret/variable names.
- README and `.env.example` use only OpenRouter-native names.

No provider-specific routing policy is added in this migration. OpenRouter provider selection remains at its default unless configured later.

## `.env` behavior and ignore policy

`.env.example` is safe to commit and contains placeholders only.

Developer flow:

```text
cp .env.example .env
# fill OPENROUTER_API_KEY
make dev
```

The Makefile may source `.env` for local commands that need model credentials. `.env` remains ignored by Git.

The root `.gitignore` must explicitly cover local secrets and generated artifacts without hiding committed examples or source files:

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

Do not ignore `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `Makefile`, `.env.example`, source maps embedded in committed source, or any fixture source/test files.

## GitHub Actions

### Main CI

Update CI to:

1. checkout
2. setup Node 22
3. enable/install pnpm 11.4.0 using Corepack or the official pnpm setup action
4. `pnpm install --frozen-lockfile`
5. run deterministic checks through pnpm/Make targets
6. install Playwright Chromium through pnpm
7. run visual QA
8. upload screenshots

CI must stay credential-free and deterministic.

### Real-model smoke

The manual workflow uses:

```text
OPENROUTER_API_KEY   <- GitHub Actions secret
OPENROUTER_MODEL     <- repository variable, falling back to deepseek/deepseek-v4-flash-0731
OPENROUTER_BASE_URL  <- repository variable, falling back to https://openrouter.ai/api/v1
```

The workflow must fail clearly when `OPENROUTER_API_KEY` is absent. It must never substitute a fake credential and report success.

## Documentation

Update README command examples from npm to pnpm/Makefile and document both model choices. Keep methodology/architecture content unchanged unless it references old environment variable names or npm commands.

## Testing and acceptance criteria

The migration is accepted only if all of the following are true on the final branch head:

1. No committed `package-lock.json` remains.
2. A root `pnpm-lock.yaml` exists and `pnpm install --frozen-lockfile` succeeds.
3. `packageManager` pins pnpm 11.4.0.
4. `pnpm-workspace.yaml` contains all application/package/demo workspaces.
5. `.gitignore` ignores `.env`, `.env.*` except `.env.example`, `.pnpm-store`, dependencies, generated FutureProof artifacts, build/test output, logs, and common editor/OS junk.
6. `make ci` succeeds without model credentials.
7. Existing 76 engine/core/API/golden/smoke-contract tests still pass.
8. Existing 6 React component tests still pass.
9. Web typecheck and Vite production build pass.
10. Existing 2 Playwright visual tests pass.
11. Candidate A remains 22/22 and Candidate B remains 22/22 for current behavior.
12. Both candidate TypeScript builds/typechecks pass.
13. `.env.example`, API runtime, smoke helper, workflow, and README consistently use `OPENROUTER_*` names.
14. Changing `OPENROUTER_MODEL` between `deepseek/deepseek-v4-flash-0731` and `openai/gpt-5.6-luna-pro` requires no code change.

## Non-goals

This migration does not:

- change the LLM client protocol from chat completions to Responses API;
- add OpenRouter provider pinning/routing preferences;
- add another process manager;
- change scoring weights or benchmark methodology;
- introduce a second package manager fallback;
- run paid/live-model calls in deterministic CI.
