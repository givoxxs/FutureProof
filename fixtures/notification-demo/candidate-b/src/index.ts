export interface Order {
  id: string;
  customer: { email: string };
}

export interface DeliveryEvent {
  orderId: string;
  channel: "email";
  provider: "smtp";
  status: "sent" | "failed";
  timestamp: number;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface NotificationDeps {
  email: { send(message: EmailMessage): Promise<void> };
  tracker: { record(event: DeliveryEvent): Promise<void> };
}

export interface NotificationOptions {}

function renderShipmentEmail(order: Order): EmailMessage {
  return {
    to: order.customer.email,
    subject: `Order ${order.id} has shipped`,
    body: `Your order ${order.id} has shipped.`,
  };
}

export async function notifyShipment(
  order: Order,
  deps: NotificationDeps,
  _options?: NotificationOptions,
): Promise<void> {
  if (!order.customer.email.trim()) {
    throw new Error("customer email is required");
  }

  const message = renderShipmentEmail(order);
  try {
    await deps.email.send({
      to: order.customer.email,
      subject: message.subject,
      body: message.body,
    });
    await deps.tracker.record({
      orderId: order.id,
      channel: "email",
      provider: "smtp",
      status: "sent",
      timestamp: Date.now(),
    });
  } catch (error) {
    await deps.tracker.record({
      orderId: order.id,
      channel: "email",
      provider: "smtp",
      status: "failed",
      timestamp: Date.now(),
    });
    throw error;
  }
}
