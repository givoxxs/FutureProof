import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../../src/index.ts";

const order = { id: "future-preferences", customer: { email: "student@example.com" } };
function deps() {
  const messages: unknown[] = [];
  return {
    messages,
    value: {
      email: { async send(message: unknown) { messages.push(message); } },
      tracker: { async record() {} },
    },
  };
}

test("FR-03 honors a disabled email preference", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any, { preferences: { email: false } } as any);
  assert.equal(d.messages.length, 0);
});

test("FR-03 keeps email enabled by default", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any);
  assert.equal(d.messages.length, 1);
});
