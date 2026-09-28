import { Service } from '../models/service.model.js';
import { WorkingHours } from '../models/working-hours.model.js';
import { Booking } from '../models/booking.model.js';
import { generateSlots } from './slots.service.js';
import { AppError } from '../utils/app-error.js';

export const catalogService = {
  listServices(includeInactive = false) {
    return Service.find(includeInactive ? {} : { isActive: true })
      .sort({ name: 1 })
      .lean();
  },
  async saveService(
    id: string | undefined,
    input: {
      name: string;
      description: string;
      durationMinutes: number;
      price: number;
      isActive: boolean;
    },
  ) {
    if (id) {
      const service = await Service.findByIdAndUpdate(id, input, {
        new: true,
        runValidators: true,
      });
      if (!service) throw new AppError(404, 'Service not found');
      return service;
    }
    return Service.create(input);
  },
  async setWorkingHours(
    input: { weekday: number; opensAt: string | null; closesAt: string | null }[],
  ) {
    await Promise.all(
      input.map((day) =>
        WorkingHours.findOneAndUpdate({ weekday: day.weekday }, day, {
          upsert: true,
          new: true,
          runValidators: true,
        }),
      ),
    );
    return WorkingHours.find().sort({ weekday: 1 }).lean();
  },
  async getSlots(serviceId: string, date: string) {
    const service = await Service.findOne({ _id: serviceId, isActive: true }).lean();
    if (!service) throw new AppError(404, 'Service not found');
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date)
      throw new AppError(400, 'date must use YYYY-MM-DD');
    const hours = await WorkingHours.findOne({ weekday: parsedDate.getUTCDay() }).lean();
    const candidates = generateSlots({
      date,
      durationMinutes: service.durationMinutes,
      opensAt: hours?.opensAt ?? null,
      closesAt: hours?.closesAt ?? null,
    });
    const end = new Date(`${date}T23:59:59.999Z`);
    const held = await Booking.find({
      serviceId,
      startTime: { $gte: parsedDate, $lte: end },
      holdsSlot: true,
    })
      .select('startTime status')
      .lean();
    const unavailable = new Map(
      held.map((booking) => [booking.startTime.toISOString(), booking.status]),
    );
    return candidates.map((slot) => ({
      startTime: slot.toISOString(),
      status: unavailable.get(slot.toISOString()) ?? 'AVAILABLE',
    }));
  },
};
