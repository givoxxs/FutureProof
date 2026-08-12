import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnalysisRepository } from "../../apps/api/src/analysis-repository.ts";

async function tempRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-history-"));
}

test("analysis repository persists safe lifecycle metadata and hydrates completed reports", async () => {
  const root = await tempRoot();
  const repository = new AnalysisRepository(root);

  const created = await repository.createRunning("run-1");
  assert.equal(created.status, "running");
  assert.equal(created.version, 1);
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  await repository.patchRuntime("run-1", {
    provider: "OpenRouter",
    model: "deepseek/test-model",
    concurrency: 2,
    requestTimeoutMs: 90_000,
  });

  const report = {
    analysisId: "run-1",
    candidates: {
      A: { dimensions: { overallRisk: 33 } },
      B: { dimensions: { overallRisk: 1 } },
    },
    scenarios: [],
  } as any;
  const runDir = path.join(root, ".futureproof", "runs", "run-1");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "report.json"), JSON.stringify(report), "utf8");
  await repository.complete("run-1", report);

  const summary = await repository.getSummary("run-1");
  assert.equal(summary?.status, "completed");
  assert.equal(summary?.provider, "OpenRouter");
  assert.equal(summary?.model, "deepseek/test-model");
  assert.deepEqual(summary?.candidateRisk, { A: 33, B: 1 });
  assert.ok(summary?.completedAt);
  assert.deepEqual(await repository.getReport("run-1"), report);

  const manifest = await fs.readFile(path.join(runDir, "analysis-state.json"), "utf8");
  assert.doesNotMatch(manifest, /OPENROUTER_API_KEY|Authorization|sk-or-|projectRoot|sandbox/i);
});

test("analysis repository lists newest valid runs first, caps at fifty, and skips malformed manifests", async () => {
  const root = await tempRoot();
  const repository = new AnalysisRepository(root);

  for (let index = 0; index < 55; index += 1) {
    const id = `run-${String(index).padStart(2, "0")}`;
    await repository.createRunning(id);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  const malformedDir = path.join(root, ".futureproof", "runs", "broken");
  await fs.mkdir(malformedDir, { recursive: true });
  await fs.writeFile(path.join(malformedDir, "analysis-state.json"), "{ definitely-not-json", "utf8");

  const listed = await repository.list(50);
  assert.equal(listed.length, 50);
  assert.equal(listed[0]?.analysisId, "run-54");
  assert.equal(listed.at(-1)?.analysisId, "run-05");
  assert.equal(listed.some((item) => item.analysisId === "broken"), false);
});

test("analysis repository persists failed and interrupted terminal states", async () => {
  const root = await tempRoot();
  const repository = new AnalysisRepository(root);

  await repository.createRunning("failed-run");
  await repository.fail("failed-run", "provider unavailable");
  assert.deepEqual(
    { status: (await repository.getSummary("failed-run"))?.status, error: (await repository.getSummary("failed-run"))?.error },
    { status: "failed", error: "provider unavailable" },
  );

  await repository.createRunning("interrupted-run");
  await repository.interrupt("interrupted-run", "Analysis interrupted by API restart; execution was not resumed.");
  assert.equal((await repository.getSummary("interrupted-run"))?.status, "interrupted");
});

test("analysis repository rejects unsafe analysis ids", async () => {
  const root = await tempRoot();
  const repository = new AnalysisRepository(root);

  for (const id of ["../escape", "/absolute", "nested/run", "nested\\run", "", ".", ".."]) {
    await assert.rejects(() => repository.createRunning(id), /analysis id/i);
  }
});
