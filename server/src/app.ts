import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { apiRouter } from './routes/api.routes.js';
import { stripeWebhook } from './controllers/api.controller.js';
import { asyncHandler } from './utils/async-handler.js';
import { AppError } from './utils/app-error.js';
import { clientOrigins, env } from './config/env.js';
import { logger } from './utils/logger.js';
import { ZodError } from 'zod';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: clientOrigins, credentials: true }));
app.use(pinoHttp({ logger }));
app.post(
  '/api/v1/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  asyncHandler(stripeWebhook),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.get('/health', (_request, response) =>
  response.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

const registry = new OpenAPIRegistry();
registry.registerPath({
  method: 'get',
  path: '/health',
  responses: { 200: { description: 'Health check' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/services',
  responses: { 200: { description: 'Active service catalog' } },
});
const openApi = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'ConsultBook Live API', version: '1.0.0' },
  servers: [{ url: `http://localhost:${env.PORT}` }],
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApi));
app.use('/api/v1', apiRouter);
app.use((_request, _response, next) => next(new AppError(404, 'Route not found')));
app.use(
  (
    error: unknown,
    request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const statusCode =
      error instanceof AppError ? error.statusCode : error instanceof ZodError ? 400 : 500;
    const message = error instanceof Error ? error.message : 'Internal server error';
    const requestId = crypto.randomUUID();
    request.log?.error({ err: error, requestId }, message);
    return response.status(statusCode).json({
      error: {
        message: statusCode === 500 ? 'Internal server error' : message,
        requestId,
        ...(error instanceof ZodError ? { issues: error.issues } : {}),
      },
    });
  },
);

export { app };
