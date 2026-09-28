import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { clientOrigins, env } from '../config/env.js';
import { Booking } from '../models/booking.model.js';
import { saveSocketMessage } from '../controllers/api.controller.js';
import { configureRealtime } from './realtime.service.js';
import { logger } from '../utils/logger.js';
import type { AccessPayload } from '../types/express.js';

const roomSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('slots'),
    serviceId: z.string().regex(/^[a-f\d]{24}$/i),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({ kind: z.literal('booking'), bookingId: z.string().regex(/^[a-f\d]{24}$/i) }),
]);
const chatSchema = z.object({
  bookingId: z.string().regex(/^[a-f\d]{24}$/i),
  body: z.string().trim().min(1).max(1000),
});

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, { cors: { origin: clientOrigins, credentials: true } });
  configureRealtime(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string') return next(new Error('Unauthorized'));
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
      if (!payload.sub || !['CUSTOMER', 'ADMIN'].includes(payload.role))
        return next(new Error('Unauthorized'));
      socket.data.user = { userId: payload.sub, role: payload.role };
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { userId: string; role: 'CUSTOMER' | 'ADMIN' };
    void socket.join(`user:${user.userId}`);
    if (user.role === 'ADMIN') void socket.join('admin');
    let chatWindowStarted = Date.now();
    let chatEvents = 0;

    socket.on(
      'room:join',
      async (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
        const parsed = roomSchema.safeParse(payload);
        if (!parsed.success) return acknowledge?.({ ok: false, error: 'Invalid room request' });
        if (parsed.data.kind === 'slots') {
          await socket.join(`slots:${parsed.data.serviceId}:${parsed.data.date}`);
          return acknowledge?.({ ok: true });
        }
        const booking = await Booking.findById(parsed.data.bookingId).select('customerId').lean();
        if (!booking || (user.role !== 'ADMIN' && booking.customerId.toString() !== user.userId))
          return acknowledge?.({ ok: false, error: 'Not a booking participant' });
        await socket.join(`booking:${booking._id.toString()}`);
        return acknowledge?.({ ok: true });
      },
    );

    socket.on(
      'chat:message',
      async (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
        if (Date.now() - chatWindowStarted >= 60_000) {
          chatWindowStarted = Date.now();
          chatEvents = 0;
        }
        chatEvents += 1;
        if (chatEvents > 20)
          return acknowledge?.({ ok: false, error: 'Message rate limit exceeded' });
        const parsed = chatSchema.safeParse(payload);
        if (!parsed.success) return acknowledge?.({ ok: false, error: 'Invalid message' });
        try {
          await saveSocketMessage(parsed.data.bookingId, user.userId, user.role, parsed.data.body);
          acknowledge?.({ ok: true });
        } catch (error) {
          logger.warn({ err: error }, 'Socket message rejected');
          acknowledge?.({ ok: false, error: 'Message could not be sent' });
        }
      },
    );
  });
  return io;
}
