import { model, Schema, type InferSchemaType } from 'mongoose';

const paymentSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    providerOrderId: { type: String, required: true, unique: true },
    providerPaymentId: { type: String },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['CREATED', 'PAID', 'FAILED', 'REFUND_REQUIRED', 'REFUNDED'],
      default: 'CREATED',
    },
  },
  { timestamps: true },
);

export type PaymentDocument = InferSchemaType<typeof paymentSchema>;
export const Payment = model('Payment', paymentSchema);
