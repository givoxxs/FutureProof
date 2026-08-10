import test from "node:test";
import assert from "node:assert/strict";
import { notifyShipment } from "../src/index.ts";

test("base sends shipment email", async () => {
  const messages: Array<{ to: string; subject: string; body: string }> = [];
  await notifyShipment(
    { id: "order-42", customer: { email: "student@example.com" } },
    { email: { async send(message) { messages.push(message); } } },
  );
  assert.equal(messages.length, 1);
  assert.match(messages[0]?.subject ?? "", /shipped/i);
});
