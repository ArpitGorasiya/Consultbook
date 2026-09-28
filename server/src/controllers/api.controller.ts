import type { Request, Response } from 'express';
import { z } from 'zod';
import mongoose, { Types } from 'mongoose';
import { User } from '../models/user.model.js';
import { Booking } from '../models/booking.model.js';
import { Payment } from '../models/payment.model.js';
import { WebhookEvent } from '../models/webhook-event.model.js';
import { Message } from '../models/message.model.js';
import { authService } from '../services/auth.service.js';
import { catalogService } from '../services/catalog.service.js';
import { bookingService } from '../services/booking.service.js';
import { sendBookingConfirmation } from '../services/email.service.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { emitSlotUpdate, emitToRoom } from '../realtime/realtime.service.js';
import { refundPayment, verifyStripeWebhook } from '../services/payment-provider.service.js';
import { logger } from '../utils/logger.js';
import Stripe from 'stripe';

const refreshCookie = {
  httpOnly: true,
  secure: env.COOKIE_SECURE === 'true',
  sameSite: env.COOKIE_SECURE === 'true' ? ('none' as const) : ('lax' as const),
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const authController = {
  async register(request: Request, response: Response) {
    const input = request.body as z.infer<typeof registerSchema>['body'];
    const result = await authService.register(input);
    const signed = await authService.login(
      request.body.email as string,
      request.body.password as string,
    );
    response.cookie('refreshToken', signed.refreshToken, refreshCookie);
    return response.status(201).json({ user: result.user, accessToken: signed.accessToken });
  },
  async login(request: Request, response: Response) {
    const result = await authService.login(
      request.body.email as string,
      request.body.password as string,
    );
    response.cookie('refreshToken', result.refreshToken, refreshCookie);
    return response.json({ user: result.user, accessToken: result.accessToken });
  },
  async refresh(request: Request, response: Response) {
    const token = request.cookies.refreshToken as string | undefined;
    if (!token) throw new AppError(401, 'Refresh token required');
    return response.json(await authService.refresh(token));
  },
  async logout(request: Request, response: Response) {
    if (request.auth) await authService.logout(request.auth.userId);
    response.clearCookie('refreshToken', { ...refreshCookie, maxAge: undefined });
    return response.status(204).end();
  },
  async me(request: Request, response: Response) {
    const user = await User.findById(request.auth?.userId).select('name email role').lean();
    if (!user) throw new AppError(404, 'User not found');
    return response.json({ user });
  },
};

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(8).max(100),
  }),
});
export const loginSchema = z.object({
  body: z.object({ email: z.string().email(), password: z.string().min(1) }),
});
export const serviceSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    description: z.string().min(4).max(2000),
    durationMinutes: z.number().int().min(5).max(480),
    price: z.number().int().min(0),
    isActive: z.boolean().default(true),
  }),
});

export const catalogController = {
  async services(_request: Request, response: Response) {
    return response.json({ services: await catalogService.listServices() });
  },
  async adminServices(_request: Request, response: Response) {
    return response.json({ services: await catalogService.listServices(true) });
  },
  async saveService(request: Request, response: Response) {
    const id = request.params.id ? String(request.params.id) : undefined;
    const service = await catalogService.saveService(
      id,
      request.body as z.infer<typeof serviceSchema>['body'],
    );
    return response.status(id ? 200 : 201).json({ service });
  },
  async workingHours(request: Request, response: Response) {
    const schema = z.array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        opensAt: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable(),
        closesAt: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable(),
      }),
    );
    const days = schema.parse(request.body);
    return response.json({ workingHours: await catalogService.setWorkingHours(days) });
  },
  async slots(request: Request, response: Response) {
    const query = z
      .object({
        serviceId: z.string().regex(/^[a-f\d]{24}$/i),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(request.query);
    return response.json({ slots: await catalogService.getSlots(query.serviceId, query.date) });
  },
};

export const bookingController = {
  async create(request: Request, response: Response) {
    const input = z
      .object({ serviceId: z.string().regex(/^[a-f\d]{24}$/i), startTime: z.string().datetime() })
      .parse(request.body);
    const booking = await bookingService.create(
      request.auth!.userId,
      input.serviceId,
      input.startTime,
    );
    return response.status(201).json({ booking });
  },
  async mine(request: Request, response: Response) {
    return response.json({ bookings: await bookingService.listForCustomer(request.auth!.userId) });
  },
  async cancel(request: Request, response: Response) {
    return response.json(
      await bookingService.cancel(
        String(request.params.id),
        request.auth!.userId,
        request.auth!.role,
      ),
    );
  },
  async status(request: Request, response: Response) {
    return response.json({
      booking: await bookingService.getForUser(
        String(request.params.id),
        request.auth!.userId,
        request.auth!.role,
      ),
    });
  },
  async messages(request: Request, response: Response) {
    const page = Number(z.coerce.number().int().min(1).default(1).parse(request.query.page));
    return response.json({
      messages: await bookingService.messages(
        String(request.params.id),
        request.auth!.userId,
        request.auth!.role,
        page,
      ),
    });
  },
};

export const adminController = {
  async bookings(request: Request, response: Response) {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        status: z.enum(['PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED']).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(request.query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.from || query.to)
      filter.startTime = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('customerId', 'name email')
        .sort({ startTime: -1 })
        .skip((query.page - 1) * 20)
        .limit(20)
        .lean(),
      Booking.countDocuments(filter),
    ]);
    return response.json({ bookings, page: query.page, total, pages: Math.ceil(total / 20) });
  },
  async stats(_request: Request, response: Response) {
    const [totalBookings, revenueResult, upcoming] = await Promise.all([
      Booking.countDocuments(),
      Payment.aggregate<{ total: number }>([
        { $match: { status: 'PAID' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Booking.countDocuments({ status: 'CONFIRMED', startTime: { $gte: new Date() } }),
    ]);
    return response.json({
      stats: { totalBookings, revenue: revenueResult[0]?.total ?? 0, upcoming },
    });
  },
};

export async function stripeWebhook(request: Request, response: Response): Promise<Response> {
  const signature = request.header('stripe-signature');
  const rawBody = request.body as Buffer;
  if (!signature || !env.STRIPE_WEBHOOK_SECRET)
    throw new AppError(400, 'Webhook signature is invalid');
  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(rawBody, signature);
  } catch {
    throw new AppError(400, 'Webhook signature is invalid');
  }

  const metadata = 'metadata' in event.data.object ? event.data.object.metadata : null;
  const checkoutSession = event.type.startsWith('checkout.session.')
    ? (event.data.object as Stripe.Checkout.Session)
    : null;
  const paymentIntent = event.type.startsWith('payment_intent.')
    ? (event.data.object as Stripe.PaymentIntent)
    : null;
  const bookingId = metadata?.bookingId ?? checkoutSession?.client_reference_id ?? null;
  const providerOrderId = checkoutSession?.id;
  const paymentIntentId =
    typeof checkoutSession?.payment_intent === 'string'
      ? checkoutSession.payment_intent
      : (checkoutSession?.payment_intent?.id ?? paymentIntent?.id);
  const successful =
    (event.type === 'checkout.session.completed' && checkoutSession?.payment_status === 'paid') ||
    event.type === 'checkout.session.async_payment_succeeded' ||
    event.type === 'payment_intent.succeeded';
  const failed =
    event.type === 'checkout.session.async_payment_failed' ||
    event.type === 'payment_intent.payment_failed';
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await WebhookEvent.create([{ providerEventId: event.id, eventType: event.type }], {
        session,
      });
      if (!providerOrderId && !bookingId) return;
      const payment = await Payment.findOne(providerOrderId ? { providerOrderId } : { bookingId })
        .session(session)
        .lean();
      if (!payment) return;
      if (successful && paymentIntentId) {
        const booking = await Booking.findById(payment.bookingId).session(session);
        const isLateOrUnavailable =
          !booking ||
          booking.status === 'EXPIRED' ||
          booking.status === 'CANCELLED' ||
          (booking.status === 'PENDING' && booking.expiresAt <= new Date());
        await Payment.updateOne(
          { _id: payment._id },
          {
            $set: {
              status: isLateOrUnavailable ? 'REFUND_REQUIRED' : 'PAID',
              providerPaymentId: paymentIntentId,
            },
          },
          { session },
        );
        if (booking?.status === 'PENDING') {
          booking.status = isLateOrUnavailable ? 'EXPIRED' : 'CONFIRMED';
          if (isLateOrUnavailable) booking.holdsSlot = false;
          await booking.save({ session });
        }
      }
      if (failed) {
        await Payment.updateOne(
          { _id: payment._id },
          {
            $set: {
              status: 'FAILED',
              ...(paymentIntentId ? { providerPaymentId: paymentIntentId } : {}),
            },
          },
          { session },
        );
      }
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
      return response.status(200).json({ received: true, duplicate: true });
    throw error;
  } finally {
    await session.endSession();
  }

  if (successful && (providerOrderId || bookingId)) {
    const payment = await Payment.findOne(
      providerOrderId ? { providerOrderId } : { bookingId },
    ).lean();
    if (payment) {
      const booking = await Booking.findById(payment.bookingId).lean();
      if (booking?.status === 'CONFIRMED') {
        const customer = await User.findById(booking.customerId).select('email').lean();
        emitToRoom(`user:${booking.customerId.toString()}`, 'booking:confirmed', {
          bookingId: booking._id.toString(),
        });
        emitSlotUpdate(
          booking.serviceId.toString(),
          booking.startTime.toISOString().slice(0, 10),
          'slot:booked',
          { startTime: booking.startTime.toISOString() },
        );
        if (customer?.email)
          void sendBookingConfirmation(
            customer.email,
            booking.serviceName,
            booking.startTime,
          ).catch(() => undefined);
      } else if (payment.status === 'REFUND_REQUIRED' && payment.providerPaymentId) {
        void refundPayment(payment.providerPaymentId, payment.amount)
          .then(() =>
            Payment.updateOne(
              { _id: payment._id, status: 'REFUND_REQUIRED' },
              { $set: { status: 'REFUNDED' } },
            ),
          )
          .catch((error: unknown) =>
            logger.error(
              { err: error, paymentId: payment._id.toString() },
              'Late-capture refund failed',
            ),
          );
      }
    }
  }
  return response.status(200).json({ received: true });
}

export async function saveSocketMessage(
  bookingId: string,
  userId: string,
  role: string,
  body: string,
) {
  if (!Types.ObjectId.isValid(bookingId)) throw new AppError(400, 'Invalid booking');
  const booking = await Booking.findById(bookingId).lean();
  if (
    !booking ||
    booking.status !== 'CONFIRMED' ||
    (role !== 'ADMIN' && booking.customerId.toString() !== userId)
  )
    throw new AppError(403, 'Chat is not available for this booking');
  const message = await Message.create({ bookingId, senderId: userId, body });
  emitToRoom(`booking:${bookingId}`, 'chat:message', {
    id: message.id,
    bookingId,
    senderId: userId,
    body,
    createdAt: message.createdAt,
  });
  return message;
}
