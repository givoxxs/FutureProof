import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSandbox, validateBaseline } from "../../packages/engine/src/sandbox-manager.ts";

const source = path.resolve("fixtures/notification-demo/candidate-a");

test("creates byte-isolated sandboxes from the same candidate", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-runs-"));
  const sourceFile = path.join(source, "src", "notification-service.ts");
  const before = await fs.readFile(sourceFile, "utf8");

  const first = await createSandbox({ sourceRoot: source, runRoot, analysisId: "a1", candidateId: "A", scenarioId: "FR-01", trial: 1 });
  const second = await createSandbox({ sourceRoot: source, runRoot, analysisId: "a1", candidateId: "A", scenarioId: "FR-01", trial: 2 });
  const firstFile = path.join(first.root, "src", "notification-service.ts");
  const secondFile = path.join(second.root, "src", "notification-service.ts");

  await fs.appendFile(firstFile, "\n// sandbox-one-only\n", "utf8");
  assert.equal(await fs.readFile(secondFile, "utf8"), before);
  assert.equal(await fs.readFile(sourceFile, "utf8"), before);
});

test("baseline validation reports current tests and build as valid", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-runs-"));
  const sandbox = await createSandbox({ sourceRoot: source, runRoot, analysisId: "a2", candidateId: "A", scenarioId: "FR-01", trial: 1 });
  const baseline = await validateBaseline(sandbox);
  assert.deepEqual(baseline, {
    candidateId: "A",
    testsPassed: 22,
    testsFailed: 0,
    buildPassed: true,
    valid: true,
  });
});

test("baseline validation fails closed when a successful test command has no summary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-baseline-bad-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node -e \"process.exit(0)\"",
      build: "node -e \"process.exit(0)\"",
    },
  }), "utf8");
  const sandbox = { root, candidateId: "A" as const, scenarioId: "FR-01", trial: 1 };
  await assert.rejects(() => validateBaseline(sandbox), /test totals/i);
});

test("sandbox copy excludes node_modules and generated FutureProof artifacts", async () => {
  const decorated = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-source-"));
  await fs.cp(source, decorated, { recursive: true });
  await fs.mkdir(path.join(decorated, "node_modules", "fake"), { recursive: true });
  await fs.writeFile(path.join(decorated, "node_modules", "fake", "x.js"), "x", "utf8");
  await fs.mkdir(path.join(decorated, ".futureproof"), { recursive: true });
  await fs.writeFile(path.join(decorated, ".futureproof", "old.json"), "{}", "utf8");

  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-runs-"));
  const sandbox = await createSandbox({ sourceRoot: decorated, runRoot, analysisId: "a3", candidateId: "A", scenarioId: "FR-02", trial: 1 });
  await assert.rejects(() => fs.access(path.join(sandbox.root, "node_modules", "fake", "x.js")));
  await assert.rejects(() => fs.access(path.join(sandbox.root, ".futureproof", "old.json")));
});
