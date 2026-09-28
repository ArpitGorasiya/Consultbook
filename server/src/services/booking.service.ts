import mongoose, { Types } from 'mongoose';
import { Booking } from '../models/booking.model.js';
import { Payment } from '../models/payment.model.js';
import { Service } from '../models/service.model.js';
import { emitSlotUpdate, emitToRoom } from '../realtime/realtime.service.js';
import { AppError } from '../utils/app-error.js';
import { createPaymentOrder, refundPayment } from './payment-provider.service.js';
import { catalogService } from './catalog.service.js';

const HOLD_MS = 10 * 60_000;

export const bookingService = {
  async create(customerId: string, serviceId: string, startTime: string) {
    const service = await Service.findOne({ _id: serviceId, isActive: true }).lean();
    if (!service) throw new AppError(404, 'Service not found');
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now())
      throw new AppError(400, 'Choose a future UTC start time');
    const daySlots = await catalogService.getSlots(serviceId, start.toISOString().slice(0, 10));
    if (
      !daySlots.some(
        (slot) => slot.startTime === start.toISOString() && slot.status === 'AVAILABLE',
      )
    )
      throw new AppError(409, 'Slot no longer available');
    const end = new Date(start.getTime() + service.durationMinutes * 60_000);
    const expiresAt = new Date(Date.now() + HOLD_MS);
    const bookingId = new Types.ObjectId();
    // Keep provider network latency outside the transaction so Mongo locks stay brief.
    const order = await createPaymentOrder(service.price, bookingId.toString(), service.name);
    const session = await mongoose.startSession();
    let result:
      | { bookingId: string; orderId: string; checkoutUrl: string | null; amount: number }
      | undefined;
    try {
      await session.withTransaction(async () => {
        const [booking] = await Booking.create(
          [
            {
              _id: bookingId,
              customerId: new Types.ObjectId(customerId),
              serviceId: service._id,
              serviceName: service.name,
              durationMinutes: service.durationMinutes,
              amount: service.price,
              startTime: start,
              endTime: end,
              status: 'PENDING',
              holdsSlot: true,
              expiresAt,
            },
          ],
          { session },
        );
        if (!booking) throw new AppError(500, 'Could not create booking');
        await Payment.create(
          [
            {
              bookingId: booking._id,
              providerOrderId: order.id,
              amount: service.price,
              status: 'CREATED',
            },
          ],
          { session },
        );
        result = {
          bookingId: booking.id,
          orderId: order.id,
          checkoutUrl: order.url,
          amount: service.price,
        };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
        throw new AppError(409, 'Slot no longer available');
      throw error;
    } finally {
      await session.endSession();
    }
    if (!result) throw new AppError(500, 'Could not create booking');
    emitSlotUpdate(serviceId, start.toISOString().slice(0, 10), 'slot:held', {
      startTime: start.toISOString(),
      bookingId: result.bookingId,
    });
    emitToRoom('admin', 'admin:new-booking', {
      bookingId: result.bookingId,
      serviceName: service.name,
      startTime: start.toISOString(),
    });
    return { ...result, expiresAt };
  },

  async listForCustomer(customerId: string) {
    return Booking.find({ customerId }).sort({ startTime: -1 }).lean();
  },
  async getForUser(bookingId: string, userId: string, role: string) {
    if (!Types.ObjectId.isValid(bookingId)) throw new AppError(404, 'Booking not found');
    const booking = await Booking.findById(bookingId).lean();
    if (!booking || (role !== 'ADMIN' && booking.customerId.toString() !== userId))
      throw new AppError(404, 'Booking not found');
    return booking;
  },
  async cancel(bookingId: string, userId: string, role: string) {
    const booking = await this.getForUser(bookingId, userId, role);
    if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED')
      throw new AppError(409, 'Booking cannot be cancelled in its current state');
    const beforeStart = booking.startTime.getTime() - Date.now() > 24 * 60 * 60_000;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Booking.updateOne(
          { _id: bookingId },
          { $set: { status: 'CANCELLED', holdsSlot: false } },
          { session },
        );
        if (beforeStart)
          await Payment.updateOne(
            { bookingId, status: 'PAID' },
            { $set: { status: 'REFUND_REQUIRED' } },
            { session },
          );
      });
    } finally {
      await session.endSession();
    }
    if (beforeStart) {
      const payment = await Payment.findOne({ bookingId }).lean();
      if (payment?.providerPaymentId && payment.status === 'REFUND_REQUIRED') {
        await refundPayment(payment.providerPaymentId, payment.amount);
        await Payment.updateOne(
          { bookingId, status: 'REFUND_REQUIRED' },
          { $set: { status: 'REFUNDED' } },
        );
      }
    }
    emitSlotUpdate(
      booking.serviceId.toString(),
      booking.startTime.toISOString().slice(0, 10),
      'slot:released',
      { startTime: booking.startTime.toISOString() },
    );
    return { cancelled: true, refundEligible: beforeStart };
  },

  async messages(bookingId: string, userId: string, role: string, page: number) {
    const booking = await this.getForUser(bookingId, userId, role);
    if (booking.status !== 'CONFIRMED')
      throw new AppError(409, 'Chat is available for confirmed bookings');
    const { Message } = await import('../models/message.model.js');
    return Message.find({ bookingId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * 30)
      .limit(30)
      .lean();
  },
};

export async function applyExpiry(): Promise<void> {
  const expired = await Booking.find({ status: 'PENDING', expiresAt: { $lte: new Date() } })
    .select('_id customerId serviceId startTime')
    .lean();
  if (!expired.length) return;
  const released: typeof expired = [];
  for (const booking of expired) {
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: 'PENDING', expiresAt: { $lte: new Date() } },
      { $set: { status: 'EXPIRED', holdsSlot: false } },
    );
    if (updated) released.push(booking);
  }
  for (const booking of released) {
    const date = booking.startTime.toISOString().slice(0, 10);
    emitSlotUpdate(booking.serviceId.toString(), date, 'slot:released', {
      startTime: booking.startTime.toISOString(),
    });
    emitToRoom(`user:${booking.customerId.toString()}`, 'booking:expired', {
      bookingId: booking._id.toString(),
    });
  }
}
