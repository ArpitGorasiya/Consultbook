import { model, Schema, type InferSchemaType } from 'mongoose';

const messageSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type MessageDocument = InferSchemaType<typeof messageSchema>;
export const Message = model('Message', messageSchema);
