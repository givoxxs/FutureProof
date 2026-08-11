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

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export interface DeliveryTracker {
  record(event: DeliveryEvent): Promise<void>;
}

export interface NotificationDeps {
  email: EmailProvider;
  tracker: DeliveryTracker;
}

export interface NotificationOptions {}
