import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { injectAcceptanceTest } from "../../packages/engine/src/acceptance-injector.ts";

test("injects a known frozen acceptance test inside the sandbox", async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-sandbox-"));
  const source = path.resolve("fixtures/notification-demo/acceptance/FR-01.test.ts");
  const destination = await injectAcceptanceTest(sandbox, "FR-01", source);
  assert.equal(destination, path.join(sandbox, "test", "futureproof", "FR-01.test.ts"));
  assert.equal(await fs.readFile(destination, "utf8"), await fs.readFile(source, "utf8"));
});

test("rejects unknown scenario ids", async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-sandbox-"));
  await assert.rejects(() => injectAcceptanceTest(sandbox, "FR-99", "/tmp/missing.ts"), /unknown scenario/i);
});

test("rejects a sandbox root that resolves through a symlink escape", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-parent-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-outside-"));
  const linked = path.join(parent, "linked");
  await fs.symlink(outside, linked);
  const source = path.resolve("fixtures/notification-demo/acceptance/FR-01.test.ts");
  await assert.rejects(() => injectAcceptanceTest(linked, "FR-01", source), /sandbox root/i);
});
