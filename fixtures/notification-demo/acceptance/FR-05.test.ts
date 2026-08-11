import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../../src/index.ts";

const order = { id: "future-quiet-hours", customer: { email: "student@example.com" } };

function deps() {
  const emailMessages: unknown[] = [];
  return {
    emailMessages,
    value: {
      email: { async send(message: unknown) { emailMessages.push(message); } },
      tracker: { async record() {} },
    },
  };
}

test("FR-05 does not deliver immediately during configured quiet hours", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any, {
    quietHours: { startHour: 22, endHour: 7 },
    currentHour: 23,
  } as any);
  assert.equal(d.emailMessages.length, 0);
});

test("FR-05 preserves immediate delivery outside configured quiet hours", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any, {
    quietHours: { startHour: 22, endHour: 7 },
    currentHour: 12,
  } as any);
  assert.equal(d.emailMessages.length, 1);
});
