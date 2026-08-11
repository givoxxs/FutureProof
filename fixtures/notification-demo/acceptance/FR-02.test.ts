import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../../src/index.ts";

const order = { id: "future-retry", customer: { email: "student@example.com" } };

function retryDeps(failuresBeforeSuccess: number) {
  let attempts = 0;
  const delays: number[] = [];
  return {
    get attempts() { return attempts; },
    delays,
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

test("FR-02 retries transient failures with exponential backoff until success", async () => {
  const d = retryDeps(2);
  await notifyShipment(order, d.value as any, {
    retry: {
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep: async (delayMs: number) => { d.delays.push(delayMs); },
    },
  } as any);
  assert.equal(d.attempts, 3);
  assert.deepEqual(d.delays, [10, 20]);
});

test("FR-02 stops after the configured attempt bound", async () => {
  const d = retryDeps(99);
  await assert.rejects(() => notifyShipment(order, d.value as any, {
    retry: {
      maxAttempts: 3,
      baseDelayMs: 5,
      sleep: async (delayMs: number) => { d.delays.push(delayMs); },
    },
  } as any));
  assert.equal(d.attempts, 3);
  assert.deepEqual(d.delays, [5, 10]);
});
