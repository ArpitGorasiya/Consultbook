import { createServer, type Server as HttpServer } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { io as createClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import { createPaymentOrder, refundPayment } from '../src/services/payment-provider.service.js';
import { app } from '../src/app.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { User } from '../src/models/user.model.js';
import { Service } from '../src/models/service.model.js';
import { WorkingHours } from '../src/models/working-hours.model.js';
import { Booking } from '../src/models/booking.model.js';
import { Payment } from '../src/models/payment.model.js';
import { WebhookEvent } from '../src/models/webhook-event.model.js';

let replicaSet: MongoMemoryReplSet;
let httpServer: HttpServer;
let origin: string;
let customerToken = '';
let adminToken = '';
let serviceId = '';
let customerId = '';

jest.mock('../src/services/payment-provider.service.js', () => {
  const actual = jest.requireActual(
    '../src/services/payment-provider.service.js',
  ) as typeof import('../src/services/payment-provider.service.js');
  return {
    ...actual,
    createPaymentOrder: jest.fn(async (_amount: number, bookingId: string) => ({
      id: `cs_test_${bookingId}`,
      url: 'https://checkout.stripe.com/test',
    })),
    refundPayment: jest.fn(async () => undefined),
  };
});

void createPaymentOrder;
void refundPayment;

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve as (...args: never[]) => void));
}

async function connect(token: string): Promise<Socket> {
  const socket = createClient(origin, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  await once(socket, 'connect');
  return socket;
}

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replicaSet.getUri());
  httpServer = createServer(app);
  createSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Could not start test server');
  origin = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([
    User.syncIndexes(),
    Service.syncIndexes(),
    WorkingHours.syncIndexes(),
    Booking.syncIndexes(),
    Payment.syncIndexes(),
    WebhookEvent.syncIndexes(),
  ]);
  const passwordHash = await bcrypt.hash('testing-password-123', 4);
  const createdUsers = await User.create([
    { name: 'Customer', email: 'customer@example.com', passwordHash, role: 'CUSTOMER' },
    { name: 'Other Customer', email: 'other@example.com', passwordHash, role: 'CUSTOMER' },
    { name: 'Admin', email: 'admin@example.com', passwordHash, role: 'ADMIN' },
  ]);
  customerId = createdUsers[0]!.id;
  const service = await Service.create({
    name: 'Consultation',
    description: 'A thoughtful consultation.',
    durationMinutes: 60,
    price: 10000,
    isActive: true,
  });
  serviceId = service.id;
  await WorkingHours.create({ weekday: 1, opensAt: '10:00', closesAt: '18:00' });
  const customerLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'customer@example.com', password: 'testing-password-123' });
  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@example.com', password: 'testing-password-123' });
  customerToken = customerLogin.body.accessToken as string;
  adminToken = adminLogin.body.accessToken as string;
});

afterAll(async () => {
  await mongoose.disconnect();
  if (httpServer?.listening)
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (replicaSet) await replicaSet.stop();
});

describe('booking contention', () => {
  it('allows exactly one of two simultaneous requests to hold a slot', async () => {
    const payload = { serviceId, startTime: '2030-01-07T10:00:00.000Z' };
    const results = await Promise.all([
      request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(payload),
      request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(payload),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await Booking.countDocuments({ holdsSlot: true })).toBe(1);
    expect(await Payment.countDocuments()).toBe(1);
  });
});

describe('Stripe webhook', () => {
  async function sendWebhook(eventId: string, validSignature = true) {
    const body = JSON.stringify({
      id: eventId,
      object: 'event',
      api_version: '2024-06-20',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_test_local_booking',
          object: 'checkout.session',
          client_reference_id: 'local_booking',
          metadata: { bookingId: 'local_booking' },
          payment_intent: 'pi_test_payment',
          payment_status: 'paid',
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: 'checkout.session.completed',
    });
    const stripe = new Stripe('sk_test_consultbook_test_key');
    const signature = validSignature
      ? stripe.webhooks.generateTestHeaderString({
          payload: body,
          secret: 'whsec_test_consultbook_secret',
        })
      : 't=0,v1=invalid';
    return request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(body);
  }

  it('rejects an invalid signature', async () => {
    const response = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=0,v1=invalid')
      .send('{}');
    expect(response.status).toBe(400);
  });

  it('accepts a valid signature and skips duplicate provider event IDs', async () => {
    const booking = await Booking.create({
      customerId,
      serviceId,
      serviceName: 'Consultation',
      durationMinutes: 60,
      amount: 10000,
      startTime: new Date('2030-01-07T10:00:00Z'),
      endTime: new Date('2030-01-07T11:00:00Z'),
      status: 'PENDING',
      holdsSlot: true,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await Payment.create({
      bookingId: booking.id,
      providerOrderId: 'cs_test_local_booking',
      amount: 10000,
      status: 'CREATED',
    });
    const first = await sendWebhook('evt_test_one');
    const duplicate = await sendWebhook('evt_test_one');
    expect(first.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
  });
});

describe('socket access', () => {
  it('rejects unauthenticated sockets', async () => {
    const socket = createClient(origin, { transports: ['websocket'], forceNew: true });
    const error = await once<Error>(socket, 'connect_error');
    expect(error.message).toBe('Unauthorized');
    socket.disconnect();
  });

  it('blocks a non-participant from joining a booking room', async () => {
    const booking = await Booking.create({
      customerId,
      serviceId,
      serviceName: 'Consultation',
      durationMinutes: 60,
      amount: 10000,
      startTime: new Date('2030-01-07T10:00:00Z'),
      endTime: new Date('2030-01-07T11:00:00Z'),
      status: 'CONFIRMED',
      holdsSlot: true,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const otherLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'other@example.com', password: 'testing-password-123' });
    const socket = await connect(otherLogin.body.accessToken as string);
    const acknowledgement = new Promise<{ ok: boolean; error?: string }>((resolve) =>
      socket.emit('room:join', { kind: 'booking', bookingId: booking.id }, resolve),
    );
    expect(await acknowledgement).toEqual({ ok: false, error: 'Not a booking participant' });
    const messageAcknowledgement = new Promise<{ ok: boolean; error?: string }>((resolve) =>
      socket.emit('chat:message', { bookingId: booking.id, body: 'Not my booking' }, resolve),
    );
    expect(await messageAcknowledgement).toEqual({ ok: false, error: 'Message could not be sent' });
    expect(await mongoose.model('Message').countDocuments()).toBe(0);
    socket.disconnect();
  });

  it('sends slot holds to both authorized subscribers', async () => {
    const first = await connect(customerToken);
    const second = await connect(adminToken);
    const roomRequest = { kind: 'slots', serviceId, date: '2030-01-07' };
    const joined = await Promise.all(
      [first, second].map(
        (socket) =>
          new Promise<{ ok: boolean }>((resolve) => socket.emit('room:join', roomRequest, resolve)),
      ),
    );
    expect(joined.every((result) => result.ok)).toBe(true);
    const firstEvent = once<{ startTime: string }>(first, 'slot:held');
    const secondEvent = once<{ startTime: string }>(second, 'slot:held');
    const response = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ serviceId, startTime: '2030-01-07T10:00:00.000Z' });
    expect(response.status).toBe(201);
    expect((await firstEvent).startTime).toBe('2030-01-07T10:00:00.000Z');
    expect((await secondEvent).startTime).toBe('2030-01-07T10:00:00.000Z');
    first.disconnect();
    second.disconnect();
  });
});
