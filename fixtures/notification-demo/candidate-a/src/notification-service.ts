import { EmailSender } from "./email-sender.ts";
import type { DeliveryTracker, Order } from "./types.ts";

export class NotificationService {
  private readonly emailSender: EmailSender;
  private readonly tracker: DeliveryTracker;

  constructor(emailSender: EmailSender, tracker: DeliveryTracker) {
    this.emailSender = emailSender;
    this.tracker = tracker;
  }

  async notifyShipment(order: Order): Promise<void> {
    try {
      await this.emailSender.sendShipment(order);
      await this.tracker.record({
        orderId: order.id,
        channel: "email",
        provider: "smtp",
        status: "sent",
        timestamp: Date.now(),
      });
    } catch (error) {
      if (order.customer.email.trim()) {
        await this.tracker.record({
          orderId: order.id,
          channel: "email",
          provider: "smtp",
          status: "failed",
          timestamp: Date.now(),
        });
      }
      throw error;
    }
  }
}
