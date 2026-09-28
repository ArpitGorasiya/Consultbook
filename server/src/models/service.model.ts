import { model, Schema, type InferSchemaType } from 'mongoose';

const serviceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    durationMinutes: { type: Number, required: true, min: 5 },
    price: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type ServiceDocument = InferSchemaType<typeof serviceSchema>;
export const Service = model('Service', serviceSchema);
