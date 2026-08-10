import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../../src/index.ts";

const order = { id: "future-push", customer: { email: "student@example.com" } };
function deps() {
  const emailMessages: unknown[] = [];
  const pushMessages: unknown[] = [];
  return {
    emailMessages,
    pushMessages,
    value: {
      email: { async send(message: unknown) { emailMessages.push(message); } },
      push: { async send(message: unknown) { pushMessages.push(message); } },
      tracker: { async record() {} },
    },
  };
}

test("FR-05 sends push when selected", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any, { channel: "push" } as any);
  assert.equal(d.pushMessages.length, 1);
  assert.equal(d.emailMessages.length, 0);
});

test("FR-05 preserves email as default", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any);
  assert.equal(d.emailMessages.length, 1);
});
