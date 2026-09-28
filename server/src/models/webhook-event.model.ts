import { model, Schema } from 'mongoose';

const webhookEventSchema = new Schema(
  {
    providerEventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
  },
  { timestamps: true },
);

export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
