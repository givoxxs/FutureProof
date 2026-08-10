import test from "node:test";
import assert from "node:assert/strict";
import { validateScenarioSet } from "../../packages/engine/src/scenario-validator.ts";

function scenario(id: string, difficulty: "easy" | "medium" | "hard", requirement: string) {
  return {
    id,
    title: requirement,
    dimension: id === "FR-01" ? "breadth" : id === "FR-02" ? "policy" : id === "FR-03" ? "reliability" : id === "FR-04" ? "composition" : "extension",
    requirement,
    rationale: "A plausible incremental evolution of shipment notifications.",
    affectedCapability: "shipment notifications",
    difficulty,
    externalDependencies: false,
    provenance: ["current-requirement.md: shipment email notifications"],
    acceptance: [{ name: "works", given: "a shipped order", when: "notification runs", then: "the requested behavior occurs" }],
  };
}

function validSet() {
  return [
    scenario("FR-01", "medium", "Support SMS shipment notifications"),
    scenario("FR-02", "medium", "Respect per-user notification preferences"),
    scenario("FR-03", "medium", "Retry failed notification deliveries"),
    scenario("FR-04", "hard", "Fall back to a secondary email provider"),
    scenario("FR-05", "easy", "Support push shipment notifications"),
  ];
}

test("accepts exactly one easy, three medium, and one hard neutral scenarios", () => {
  assert.equal(validateScenarioSet(validSet()).length, 5);
});

test("rejects implementation prescriptions", () => {
  const cases = ["Create an interface for channels", "Use a factory for providers", "Refactor into services", "Add a class for SMS"];
  for (const requirement of cases) {
    const input = validSet();
    input[0] = scenario("FR-01", "medium", requirement);
    assert.throws(() => validateScenarioSet(input), /implementation prescription/i);
  }
});

test("rejects duplicate normalized requirements", () => {
  const input = validSet();
  input[1] = scenario("FR-02", "medium", "support sms shipment notifications!!!");
  assert.throws(() => validateScenarioSet(input), /duplicate/i);
});

test("rejects external dependencies and empty acceptance contracts", () => {
  const external = validSet();
  external[0] = { ...external[0]!, externalDependencies: true };
  assert.throws(() => validateScenarioSet(external), /external dependencies/i);

  const noAcceptance = validSet();
  noAcceptance[0] = { ...noAcceptance[0]!, acceptance: [] };
  assert.throws(() => validateScenarioSet(noAcceptance), /acceptance/i);
});

test("rejects an unbalanced demo difficulty profile", () => {
  const input = validSet();
  input[4] = scenario("FR-05", "medium", "Support push shipment notifications");
  assert.throws(() => validateScenarioSet(input), /difficulty profile/i);
});
