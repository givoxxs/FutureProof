import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function readWorkflow(name: string): Promise<string> {
  return readFile(path.join(root, ".github", "workflows", name), "utf8");
}

test("CI uses GitHub Actions majors that run on Node 24", async () => {
  const workflow = await readWorkflow("ci.yml");

  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node|upload-artifact)@v4/);
});

test("real-model smoke uses Node 24 GitHub Actions majors", async () => {
  const workflow = await readWorkflow("real-model-smoke.yml");

  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/);
});
