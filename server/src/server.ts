import { createServer } from 'node:http';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { app } from './app.js';
import { env } from './config/env.js';
import { createSocketServer } from './realtime/socket.js';
import { applyExpiry } from './services/booking.service.js';
import { logger } from './utils/logger.js';

async function start(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  const httpServer = createServer(app);
  createSocketServer(httpServer);
  cron.schedule('* * * * *', () => {
    void applyExpiry().catch((error: unknown) =>
      logger.error({ err: error }, 'Booking expiry failed'),
    );
  });
  httpServer.listen(env.PORT, () =>
    logger.info({ port: env.PORT }, 'ConsultBook Live API listening'),
  );
  const shutdown = async () => {
    httpServer.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Server failed to start');
  process.exit(1);
});
