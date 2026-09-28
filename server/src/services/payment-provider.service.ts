import Stripe from 'stripe';
import { clientBaseUrl, env } from '../config/env.js';

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

export async function createPaymentOrder(
  amount: number,
  bookingId: string,
  serviceName: string,
): Promise<{ id: string; url: string | null }> {
  if (!stripe) return { id: `local_${bookingId}`, url: null };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'inr',
          product_data: { name: serviceName },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    client_reference_id: bookingId,
    metadata: { bookingId },
    payment_intent_data: { metadata: { bookingId } },
    success_url: `${clientBaseUrl}/?checkout=success&booking_id=${bookingId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientBaseUrl}/?checkout=cancel&booking_id=${bookingId}`,
  });
  return { id: session.id, url: session.url };
}

export async function refundPayment(paymentId: string, amount: number): Promise<void> {
  if (!stripe || paymentId.startsWith('local_')) return;
  await stripe.refunds.create({ payment_intent: paymentId, amount });
}

export function verifyStripeWebhook(rawBody: Buffer, signature: string): Stripe.Event {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe webhook is not configured');
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}
