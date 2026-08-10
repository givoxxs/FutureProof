import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeRepo, UnsupportedRepositoryError } from "../../packages/engine/src/repo-analyzer.ts";

const fixtureRoot = path.resolve("fixtures/notification-demo");

test("summarizes the notification fixture without an LLM", async () => {
  const summary = await analyzeRepo(path.join(fixtureRoot, "candidate-a"));
  assert.equal(summary.packageManager, "npm");
  assert.equal(summary.language, "typescript");
  assert.match(summary.scripts.test ?? "", /node|test/);
  assert.ok(summary.sourceFiles.includes("src/notification-service.ts"));
  assert.ok(summary.testFiles.includes("test/notify-shipment.test.ts"));
  assert.ok(summary.publicExports.includes("NotificationService"));
  assert.ok(summary.importEdges.some((edge) => edge.from === "src/notification-service.ts" && edge.to === "./email-sender.ts"));
});

test("summarizes base and candidate B as npm TypeScript repositories", async () => {
  for (const name of ["base", "candidate-b"]) {
    const summary = await analyzeRepo(path.join(fixtureRoot, name));
    assert.equal(summary.packageManager, "npm");
    assert.equal(summary.language, "typescript");
    assert.ok(summary.sourceFiles.length >= 1);
    assert.ok(summary.testFiles.length >= 1);
  }
});

test("rejects unsupported package managers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-yarn-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ packageManager: "yarn@4.1.0" }), "utf8");
  await assert.rejects(() => analyzeRepo(root), UnsupportedRepositoryError);
});
