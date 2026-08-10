import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../../src/index.ts";

const order = { id: "future-retry", customer: { email: "student@example.com" } };

function retryDeps(failuresBeforeSuccess: number) {
  let attempts = 0;
  return {
    get attempts() { return attempts; },
    value: {
      email: {
        async send() {
          attempts += 1;
          if (attempts <= failuresBeforeSuccess) throw new Error("transient smtp failure");
        },
      },
      tracker: { async record() {} },
    },
  };
}

test("FR-03 retries transient failures until success", async () => {
  const d = retryDeps(2);
  await notifyShipment(order, d.value as any, { retry: { maxAttempts: 3 } } as any);
  assert.equal(d.attempts, 3);
});

test("FR-03 stops after the configured attempt bound", async () => {
  const d = retryDeps(99);
  await assert.rejects(() => notifyShipment(order, d.value as any, { retry: { maxAttempts: 3 } } as any));
  assert.equal(d.attempts, 3);
});
