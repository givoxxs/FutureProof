export interface Order {
  id: string;
  customer: { email: string };
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface NotificationDeps {
  email: { send(message: EmailMessage): Promise<void> };
}

export async function notifyShipment(order: Order, deps: NotificationDeps): Promise<void> {
  if (!order.customer.email.trim()) throw new Error("customer email is required");
  await deps.email.send({
    to: order.customer.email,
    subject: `Order ${order.id} has shipped`,
    body: `Your order ${order.id} has shipped.`,
  });
}
