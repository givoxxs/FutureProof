import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../../src/index.ts";

const order = { id: "future-fallback", customer: { email: "student@example.com" } };

function deps(primaryFails: boolean) {
  const primary: unknown[] = [];
  const secondary: unknown[] = [];
  return {
    primary,
    secondary,
    value: {
      email: {
        async send(message: unknown) {
          primary.push(message);
          if (primaryFails) throw new Error("primary down");
        },
      },
      secondaryEmail: { async send(message: unknown) { secondary.push(message); } },
      tracker: { async record() {} },
    },
  };
}

test("FR-04 uses secondary provider after primary failure", async () => {
  const d = deps(true);
  await notifyShipment(order, d.value as any, { fallbackToSecondary: true } as any);
  assert.equal(d.primary.length, 1);
  assert.equal(d.secondary.length, 1);
});

test("FR-04 does not call secondary after primary success", async () => {
  const d = deps(false);
  await notifyShipment(order, d.value as any, { fallbackToSecondary: true } as any);
  assert.equal(d.primary.length, 1);
  assert.equal(d.secondary.length, 0);
});
