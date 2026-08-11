import fs from "node:fs/promises";
import path from "node:path";

const KNOWN_SCENARIOS = new Set(["FR-01", "FR-02", "FR-03", "FR-04", "FR-05"]);

export async function injectAcceptanceTest(
  sandboxRoot: string,
  scenarioId: string,
  sourceTestFile: string,
): Promise<string> {
  if (!KNOWN_SCENARIOS.has(scenarioId)) {
    throw new Error(`unknown scenario id: ${scenarioId}`);
  }

  const root = path.resolve(sandboxRoot);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("sandbox root must be a real directory, not a symlink");
  }

  if (path.basename(sourceTestFile) !== `${scenarioId}.test.ts`) {
    throw new Error(`acceptance source must match scenario id ${scenarioId}`);
  }

  const destination = path.join(root, "test", "futureproof", `${scenarioId}.test.ts`);
  const relative = path.relative(root, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("acceptance destination escaped sandbox root");
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(sourceTestFile, destination);
  return destination;
}
