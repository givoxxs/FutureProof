import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../../src/index.ts";

const order = { id: "future-idempotent", customer: { email: "student@example.com" } };

function deps() {
  const emailMessages: unknown[] = [];
  const trackingEvents: unknown[] = [];
  return {
    emailMessages,
    trackingEvents,
    value: {
      email: { async send(message: unknown) { emailMessages.push(message); } },
      tracker: { async record(event: unknown) { trackingEvents.push(event); } },
    },
  };
}

test("FR-04 suppresses duplicate delivery for the same idempotency key", async () => {
  const d = deps();
  const options = { idempotencyKey: "shipment:future-idempotent:v1" } as any;
  await notifyShipment(order, d.value as any, options);
  await notifyShipment(order, d.value as any, options);

  assert.equal(d.emailMessages.length, 1);
  assert.equal(d.trackingEvents.length, 1);
});

test("FR-04 allows distinct idempotency keys to deliver independently", async () => {
  const d = deps();
  await notifyShipment(order, d.value as any, { idempotencyKey: "shipment:future-idempotent:first" } as any);
  await notifyShipment(order, d.value as any, { idempotencyKey: "shipment:future-idempotent:second" } as any);

  assert.equal(d.emailMessages.length, 2);
  assert.equal(d.trackingEvents.length, 2);
});
