import fs from "node:fs/promises";
import type { FutureScenario } from "@futureproof/core";
import { FutureScenarioSchema } from "@futureproof/core";

const FORBIDDEN_PRESCRIPTIONS = [
  /\bcreate\s+(?:an?\s+)?interface\b/i,
  /\buse\s+(?:an?\s+)?factory\b/i,
  /\brefactor\s+into\b/i,
  /\badd\s+(?:an?\s+)?class\b/i,
];

function normalizeRequirement(requirement: string): string {
  return requirement
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateScenarioSet(input: unknown): FutureScenario[] {
  if (!Array.isArray(input) || input.length !== 5) {
    throw new Error("scenario set must contain exactly five scenarios");
  }

  const scenarios = input.map((item, index) => {
    const parsed = FutureScenarioSchema.safeParse(item);
    if (!parsed.success) throw new Error(`scenario ${index + 1} has invalid shape: ${parsed.error}`);
    return parsed.data;
  });

  const normalized = new Set<string>();
  for (const scenario of scenarios) {
    if (scenario.externalDependencies) {
      throw new Error(`scenario ${scenario.id} requires external dependencies`);
    }
    if (scenario.acceptance.length === 0) {
      throw new Error(`scenario ${scenario.id} must include acceptance behavior`);
    }
    if (FORBIDDEN_PRESCRIPTIONS.some((pattern) => pattern.test(scenario.requirement))) {
      throw new Error(`scenario ${scenario.id} contains an implementation prescription`);
    }
    const key = normalizeRequirement(scenario.requirement);
    if (normalized.has(key)) throw new Error(`duplicate normalized requirement: ${scenario.requirement}`);
    normalized.add(key);
  }

  const counts = scenarios.reduce(
    (acc, scenario) => ({ ...acc, [scenario.difficulty]: acc[scenario.difficulty] + 1 }),
    { easy: 0, medium: 0, hard: 0 },
  );
  if (counts.easy !== 1 || counts.medium !== 3 || counts.hard !== 1) {
    throw new Error("demo difficulty profile must be exactly one easy, three medium, and one hard scenario");
  }

  return scenarios;
}

export async function freezeScenarios(file: string, scenarios: FutureScenario[]): Promise<void> {
  const valid = validateScenarioSet(scenarios);
  await fs.writeFile(file, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
}

export async function loadFrozenScenarios(file: string): Promise<FutureScenario[]> {
  return validateScenarioSet(JSON.parse(await fs.readFile(file, "utf8")) as unknown);
}
