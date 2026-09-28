import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../utils/async-handler.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  authController,
  bookingController,
  catalogController,
  adminController,
  registerSchema,
  loginSchema,
  serviceSchema,
} from '../controllers/api.controller.js';

export const apiRouter = Router();
const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const admin = [authenticate, requireRole('ADMIN')];

apiRouter.post(
  '/auth/register',
  authLimit,
  validate(registerSchema),
  asyncHandler(authController.register),
);
apiRouter.post('/auth/login', authLimit, validate(loginSchema), asyncHandler(authController.login));
apiRouter.post('/auth/refresh', asyncHandler(authController.refresh));
apiRouter.post('/auth/logout', authenticate, asyncHandler(authController.logout));
apiRouter.get('/auth/me', authenticate, asyncHandler(authController.me));

apiRouter.get('/services', asyncHandler(catalogController.services));
apiRouter.get('/admin/services', ...admin, asyncHandler(catalogController.adminServices));
apiRouter.post(
  '/services',
  ...admin,
  validate(serviceSchema),
  asyncHandler(catalogController.saveService),
);
apiRouter.put(
  '/services/:id',
  ...admin,
  validate(serviceSchema),
  asyncHandler(catalogController.saveService),
);
apiRouter.put('/working-hours', ...admin, asyncHandler(catalogController.workingHours));
apiRouter.get('/slots', asyncHandler(catalogController.slots));

apiRouter.post('/bookings', authenticate, asyncHandler(bookingController.create));
apiRouter.get('/bookings/me', authenticate, asyncHandler(bookingController.mine));
apiRouter.get('/bookings/:id', authenticate, asyncHandler(bookingController.status));
apiRouter.post('/bookings/:id/cancel', authenticate, asyncHandler(bookingController.cancel));
apiRouter.get('/bookings/:id/messages', authenticate, asyncHandler(bookingController.messages));
apiRouter.get('/admin/bookings', ...admin, asyncHandler(adminController.bookings));
apiRouter.get('/admin/stats', ...admin, asyncHandler(adminController.stats));
