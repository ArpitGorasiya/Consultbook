import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/consultbook?replicaSet=rs0'),
  JWT_ACCESS_SECRET: z.string().min(16).default('local-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('local-refresh-secret-change-me'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('ConsultBook Live <noreply@example.com>'),
});

export const env = envSchema.parse(process.env);
export const clientOrigins = env.CLIENT_URL.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
export const clientBaseUrl = clientOrigins[0] ?? 'http://localhost:5173';

if (clientOrigins.some((origin) => !z.string().url().safeParse(origin).success)) {
  throw new Error('CLIENT_URL must contain comma-separated valid URLs');
}
