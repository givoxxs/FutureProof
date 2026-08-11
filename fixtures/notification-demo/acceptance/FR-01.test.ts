import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../../src/index.ts";

const order = { id: "future-sms", customer: { email: "student@example.com" } };
function deps() {
  const emailMessages: unknown[] = [];
  const smsMessages: unknown[] = [];
  return {
    emailMessages,
    smsMessages,
    value: {
      email: { async send(message: unknown) { emailMessages.push(message); } },
      sms: { async send(message: unknown) { smsMessages.push(message); } },
      tracker: { async record() {} },
    },
  };
}

test("FR-01 sends SMS when shipment channel is sms", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any, { channel: "sms" } as any);
  assert.equal(d.smsMessages.length, 1);
  assert.equal(d.emailMessages.length, 0);
});

test("FR-01 preserves email as the default channel", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any);
  assert.equal(d.emailMessages.length, 1);
});
