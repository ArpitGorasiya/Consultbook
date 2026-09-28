import { model, Schema, type InferSchemaType } from 'mongoose';

const bookingSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceName: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    amount: { type: Number, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED'],
      required: true,
    },
    holdsSlot: { type: Boolean, required: true, default: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// The partial index makes competing holds for an identical UTC start atomic at MongoDB level.
bookingSchema.index(
  { startTime: 1 },
  { unique: true, partialFilterExpression: { holdsSlot: true } },
);
bookingSchema.index({ status: 1, expiresAt: 1 });

export type BookingDocument = InferSchemaType<typeof bookingSchema>;
export const Booking = model('Booking', bookingSchema);
