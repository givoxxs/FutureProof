import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { validateScenarioSet } from "../../packages/engine/src/scenario-validator.ts";

const fixtureRoot = path.resolve("fixtures/notification-demo");

test("demo fixture uses the revised five-scenario benchmark", async () => {
  const scenarios = JSON.parse(await fs.readFile(path.join(fixtureRoot, "scenarios.json"), "utf8"));
  const validated = validateScenarioSet(scenarios);

  assert.deepEqual(
    validated.map((scenario) => ({ id: scenario.id, title: scenario.title, dimension: scenario.dimension, difficulty: scenario.difficulty })),
    [
      { id: "FR-01", title: "Add SMS shipment notifications", dimension: "breadth", difficulty: "medium" },
      { id: "FR-02", title: "Retry failed deliveries with exponential backoff", dimension: "reliability", difficulty: "medium" },
      { id: "FR-03", title: "Add per-user notification preferences", dimension: "policy", difficulty: "medium" },
      { id: "FR-04", title: "Make shipment delivery idempotent", dimension: "correctness", difficulty: "hard" },
      { id: "FR-05", title: "Respect notification quiet hours", dimension: "temporal", difficulty: "easy" },
    ],
  );

  const text = JSON.stringify(validated).toLowerCase();
  assert.equal(text.includes("provider fallback"), false);
  assert.equal(text.includes("push notification"), false);

  for (const scenario of validated) {
    const acceptance = await fs.readFile(path.join(fixtureRoot, "acceptance", `${scenario.id}.test.ts`), "utf8");
    assert.match(acceptance, new RegExp(`FR-${scenario.id.slice(3)}`));
  }
});
