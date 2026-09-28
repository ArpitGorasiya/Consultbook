import { model, Schema, type InferSchemaType } from 'mongoose';

const workingHoursSchema = new Schema(
  {
    weekday: { type: Number, required: true, min: 0, max: 6, unique: true },
    opensAt: { type: String, default: null },
    closesAt: { type: String, default: null },
  },
  { timestamps: true },
);

export type WorkingHoursDocument = InferSchemaType<typeof workingHoursSchema>;
export const WorkingHours = model('WorkingHours', workingHoursSchema);
