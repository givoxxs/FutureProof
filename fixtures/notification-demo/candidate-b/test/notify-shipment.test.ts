import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment, type DeliveryEvent, type NotificationDeps, type Order } from "../src/index.ts";

const order: Order = {
  id: "order-42",
  customer: { email: "student@example.com" },
};

type TestDeps = NotificationDeps & {
  email: NotificationDeps["email"] & { messages: Array<{ to: string; subject: string; body: string }> };
  tracker: NotificationDeps["tracker"] & { events: DeliveryEvent[] };
};

function createTestDeps(options: {
  emailFailure?: Error;
  trackerFailure?: Error;
  trackerDelayMs?: number;
} = {}): TestDeps {
  const messages: Array<{ to: string; subject: string; body: string }> = [];
  const events: DeliveryEvent[] = [];
  return {
    email: {
      messages,
      async send(message) {
        messages.push(message);
        if (options.emailFailure) throw options.emailFailure;
      },
    },
    tracker: {
      events,
      async record(event) {
        if (options.trackerDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.trackerDelayMs));
        }
        if (options.trackerFailure) throw options.trackerFailure;
        events.push(event);
      },
    },
  };
}

test("1 sends shipment email", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.equal(deps.email.messages.length, 1);
});

test("2 uses customer email", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.equal(deps.email.messages[0]?.to, order.customer.email);
});

test("3 renders shipment subject", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.match(deps.email.messages[0]?.subject ?? "", /shipped/i);
});

test("4 renders order id in body", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.match(deps.email.messages[0]?.body ?? "", new RegExp(order.id));
});

test("5 records sent tracking event", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.equal(deps.tracker.events[0]?.status, "sent");
});

test("6 sent event contains order id", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.equal(deps.tracker.events[0]?.orderId, order.id);
});

test("7 sent event channel is email", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.equal(deps.tracker.events[0]?.channel, "email");
});

test("8 sent event provider is smtp", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.equal(deps.tracker.events[0]?.provider, "smtp");
});

test("9 sent event contains timestamp", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.equal(typeof deps.tracker.events[0]?.timestamp, "number");
  assert.ok((deps.tracker.events[0]?.timestamp ?? 0) > 0);
});

test("10 records failed tracking event", async () => {
  const deps = createTestDeps({ emailFailure: new Error("smtp down") });
  await assert.rejects(() => notifyShipment(order, deps), /smtp down/);
  assert.equal(deps.tracker.events[0]?.status, "failed");
});

test("11 failed event contains order id", async () => {
  const deps = createTestDeps({ emailFailure: new Error("smtp down") });
  await assert.rejects(() => notifyShipment(order, deps));
  assert.equal(deps.tracker.events[0]?.orderId, order.id);
});

test("12 failed event channel is email", async () => {
  const deps = createTestDeps({ emailFailure: new Error("smtp down") });
  await assert.rejects(() => notifyShipment(order, deps));
  assert.equal(deps.tracker.events[0]?.channel, "email");
});

test("13 failed event provider is smtp", async () => {
  const deps = createTestDeps({ emailFailure: new Error("smtp down") });
  await assert.rejects(() => notifyShipment(order, deps));
  assert.equal(deps.tracker.events[0]?.provider, "smtp");
});

test("14 propagates provider error", async () => {
  const deps = createTestDeps({ emailFailure: new Error("smtp down") });
  await assert.rejects(() => notifyShipment(order, deps), /smtp down/);
});

test("15 does not record sent after provider failure", async () => {
  const deps = createTestDeps({ emailFailure: new Error("smtp down") });
  await assert.rejects(() => notifyShipment(order, deps));
  assert.equal(deps.tracker.events.some((event) => event.status === "sent"), false);
});

test("16 records one event per call", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.equal(deps.tracker.events.length, 1);
});

test("17 separate calls record separate events", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  await notifyShipment({ ...order, id: "order-43" }, deps);
  assert.deepEqual(deps.tracker.events.map((event) => event.orderId), ["order-42", "order-43"]);
});

test("18 rejects missing customer email", async () => {
  const deps = createTestDeps();
  await assert.rejects(() => notifyShipment({ id: "order-44", customer: { email: "" } }, deps), /email/i);
});

test("19 does not call provider for missing email", async () => {
  const deps = createTestDeps();
  await assert.rejects(() => notifyShipment({ id: "order-44", customer: { email: "" } }, deps));
  assert.equal(deps.email.messages.length, 0);
});

test("20 default behavior remains email-only", async () => {
  const deps = createTestDeps();
  await notifyShipment(order, deps);
  assert.deepEqual(deps.tracker.events.map((event) => event.channel), ["email"]);
});

test("21 returns only after tracking succeeds", async () => {
  const deps = createTestDeps({ trackerDelayMs: 15 });
  const started = Date.now();
  await notifyShipment(order, deps);
  assert.ok(Date.now() - started >= 10);
  assert.equal(deps.tracker.events.length, 1);
});

test("22 propagates tracker failure", async () => {
  const deps = createTestDeps({ trackerFailure: new Error("tracker down") });
  await assert.rejects(() => notifyShipment(order, deps), /tracker down/);
});
