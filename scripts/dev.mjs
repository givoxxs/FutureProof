import { spawn } from "node:child_process";
import process from "node:process";

const projectRoot = process.cwd();
const isWindows = process.platform === "win32";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnPnpm(args) {
  return spawn("pnpm", args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    detached: !isWindows,
  });
}

function killChildTree(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (isWindows) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) {
      console.error(`[dev] failed to stop pid ${child.pid}:`, error);
    }
  }
}

function waitForExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

async function waitForApi(apiChild, options = {}) {
  const url = options.url ?? "http://127.0.0.1:3001/api/health";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (apiChild.exitCode !== null || apiChild.signalCode !== null) {
      throw new Error("API process exited before it became ready");
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The API is still booting. Retry until the readiness deadline.
    }

    await sleep(100);
  }

  throw new Error(`API did not become ready at ${url} within ${timeoutMs}ms`);
}

const api = spawnPnpm(["--dir", "apps/api", "dev"]);
let web;
let shuttingDown = false;

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  killChildTree(web);
  killChildTree(api);

  await Promise.race([
    Promise.all([waitForExit(web), waitForExit(api)]),
    sleep(1_500),
  ]);

  killChildTree(web, "SIGKILL");
  killChildTree(api, "SIGKILL");
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

try {
  await waitForApi(api);
  console.log("[dev] API ready on http://127.0.0.1:3001");

  web = spawnPnpm(["--dir", "apps/web", "dev"]);

  await new Promise((resolve) => {
    api.once("exit", (code, signal) => resolve({ name: "API", code, signal }));
    web.once("exit", (code, signal) => resolve({ name: "web", code, signal }));
  }).then(async ({ name, code, signal }) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} process exited (${signal ?? code ?? "unknown"})`);
      await shutdown(typeof code === "number" ? code : 1);
    }
  });
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}
