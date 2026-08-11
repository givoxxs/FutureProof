import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Sandbox } from "../../packages/engine/src/sandbox-manager.ts";
import { parseNodeTestCounts, probeRegression } from "../../packages/engine/src/regression-probe.ts";

async function makeFourTestSandbox(): Promise<Sandbox> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-regression-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "test"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    type: "module",
    scripts: { test: "node --test \"test/**/*.test.js\"" },
  }), "utf8");
  await fs.writeFile(path.join(root, "src", "value.js"), "export const value = 2;\n", "utf8");
  await fs.writeFile(path.join(root, "test", "value.test.js"), `
import test from "node:test";
import assert from "node:assert/strict";
import { value } from "../src/value.js";
test("positive", () => assert.ok(value > 0));
test("even", () => assert.equal(value % 2, 0));
test("equals two", () => assert.equal(value, 2));
test("below four", () => assert.ok(value < 4));
`, "utf8");
  return { root, candidateId: "A", scenarioId: "FR-01", trial: 1 };
}

test("parseNodeTestCounts accepts TAP summaries", () => {
  assert.deepEqual(parseNodeTestCounts("# tests 22\n# pass 22\n# fail 0\n"), { passed: 22, failed: 0 });
});

test("parseNodeTestCounts accepts ANSI spec-reporter summaries used by local Node", () => {
  const output = "\u001b[34mℹ tests 22\u001b[39m\n\u001b[34mℹ pass 20\u001b[39m\n\u001b[34mℹ fail 2\u001b[39m\n";
  assert.deepEqual(parseNodeTestCounts(output), { passed: 20, failed: 2 });
});

test("probeRegression records failed pressure and recovery by edit cycle", async () => {
  const sandbox = await makeFourTestSandbox();
  await fs.writeFile(path.join(sandbox.root, "src", "value.js"), "export const value = 3;\n", "utf8");
  const broken = await probeRegression(sandbox, 1);
  assert.equal(broken.cycle, 1);
  assert.equal(broken.passed, 2);
  assert.equal(broken.failed, 2);
  assert.ok(broken.timestampMs > 0);

  await fs.writeFile(path.join(sandbox.root, "src", "value.js"), "export const value = 2;\n", "utf8");
  const restored = await probeRegression(sandbox, 2);
  assert.deepEqual({ cycle: restored.cycle, passed: restored.passed, failed: restored.failed }, { cycle: 2, passed: 4, failed: 0 });
});

test("probeRegression treats missing test totals as infrastructure failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-regression-bad-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(2)\"" } }), "utf8");
  const sandbox: Sandbox = { root, candidateId: "A", scenarioId: "FR-01", trial: 1 };
  await assert.rejects(() => probeRegression(sandbox, 1), /test totals/i);
});
