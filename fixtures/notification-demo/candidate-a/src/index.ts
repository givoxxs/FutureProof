import { EmailSender } from "./email-sender.ts";
import { NotificationService } from "./notification-service.ts";
import type { NotificationDeps, NotificationOptions, Order } from "./types.ts";

export type {
  DeliveryEvent,
  DeliveryTracker,
  EmailMessage,
  EmailProvider,
  NotificationDeps,
  NotificationOptions,
  Order,
} from "./types.ts";

export async function notifyShipment(
  order: Order,
  deps: NotificationDeps,
  _options?: NotificationOptions,
): Promise<void> {
  const service = new NotificationService(new EmailSender(deps.email), deps.tracker);
  await service.notifyShipment(order);
}
