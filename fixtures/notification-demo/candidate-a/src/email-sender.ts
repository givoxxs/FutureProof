import type { EmailProvider, Order } from "./types.ts";

export class EmailSender {
  private readonly provider: EmailProvider;

  constructor(provider: EmailProvider) {
    this.provider = provider;
  }

  async sendShipment(order: Order): Promise<void> {
    if (!order.customer.email.trim()) {
      throw new Error("customer email is required");
    }

    await this.provider.send({
      to: order.customer.email,
      subject: `Order ${order.id} has shipped`,
      body: `Your order ${order.id} has shipped.`,
    });
  }
}
