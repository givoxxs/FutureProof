SHELL := /bin/bash
PNPM := pnpm

.PHONY: help install test typecheck build dev dev-api dev-web visual-test demo-verify smoke ci

help:
	@printf '%s\n' \
		'FutureProof developer commands:' \
		'  make install       Install the frozen pnpm workspace' \
		'  make test          Run engine/core/API and React tests' \
		'  make typecheck     Typecheck web and demo candidates' \
		'  make build         Build web and verify demo candidates' \
		'  make dev           Run API first, wait until ready, then run the web dashboard' \
		'  make dev-api       Run the Fastify API' \
		'  make dev-web       Run the Vite dashboard' \
		'  make visual-test   Run Playwright visual QA' \
		'  make demo-verify   Verify Candidate A/B current behavior' \
		'  make smoke         Run the live OpenRouter smoke check' \
		'  make ci            Run the complete deterministic gate'

install:
	$(PNPM) install --frozen-lockfile

test:
	$(PNPM) test
	$(PNPM) --dir apps/web test

typecheck:
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
	@node scripts/dev.mjs

visual-test:
	$(PNPM) --dir apps/web exec playwright install --with-deps chromium
	$(PNPM) --dir apps/web run visual:test

demo-verify:
	$(PNPM) run demo:verify

smoke:
	set -a; test ! -f .env || source ./.env; set +a; $(PNPM) run smoke:real-model

ci: test typecheck build demo-verify visual-test
