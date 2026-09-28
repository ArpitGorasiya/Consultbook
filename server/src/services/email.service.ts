import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export async function sendBookingConfirmation(
  email: string,
  serviceName: string,
  startTime: Date,
): Promise<void> {
  if (!transporter) {
    logger.info({ email }, 'SMTP is not configured; booking email was skipped');
    return;
  }
  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: email,
    subject: 'Your ConsultBook appointment is confirmed',
    text: `${serviceName} is confirmed for ${startTime.toISOString()}.`,
  });
}
