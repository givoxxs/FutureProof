import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function exists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(root, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test("repository is a single pnpm 11.4.0 workspace", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");

  assert.equal(packageJson.packageManager, "pnpm@11.4.0");
  assert.equal("workspaces" in packageJson, false);
  for (const entry of [
    "apps/*",
    "packages/*",
    "fixtures/notification-demo/base",
    "fixtures/notification-demo/candidate-a",
    "fixtures/notification-demo/candidate-b",
  ]) {
    assert.match(workspace, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(await exists("pnpm-lock.yaml"), true);
});

test("npm lockfiles are not committed after pnpm migration", async () => {
  for (const lockfile of [
    "fixtures/notification-demo/base/package-lock.json",
    "fixtures/notification-demo/candidate-a/package-lock.json",
    "fixtures/notification-demo/candidate-b/package-lock.json",
  ]) {
    assert.equal(await exists(lockfile), false, `${lockfile} must be removed`);
  }
});

test("gitignore protects local secrets and generated pnpm/test state", async () => {
  const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
  for (const pattern of [
    ".env\n",
    ".env.*\n",
    "!.env.example\n",
    ".pnpm-store/\n",
    "node_modules/\n",
    ".futureproof/\n",
    "dist/\n",
    "coverage/\n",
    "playwright-report/\n",
    "test-results/\n",
    "*.log\n",
    ".DS_Store\n",
    ".idea/\n",
    ".vscode/\n",
  ]) {
    assert.ok(gitignore.includes(pattern), `missing ignore rule: ${JSON.stringify(pattern.trim())}`);
  }
});
