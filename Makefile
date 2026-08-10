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
	@set -m; \
	$(MAKE) dev-api & api_pid=$$!; \
	$(MAKE) dev-web & web_pid=$$!; \
	trap 'kill $$api_pid $$web_pid 2>/dev/null || true' INT TERM EXIT; \
	wait $$api_pid $$web_pid

visual-test:
	$(PNPM) --dir apps/web exec playwright install --with-deps chromium
	$(PNPM) --dir apps/web run visual:test

demo-verify:
	$(PNPM) run demo:verify

smoke:
	set -a; test ! -f .env || source ./.env; set +a; $(PNPM) run smoke:real-model

ci: test typecheck build demo-verify visual-test
