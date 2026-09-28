import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import type { AccessPayload } from '../types/express.js';

export const authenticate: RequestHandler = (request, _response, next) => {
  const header = request.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(new AppError(401, 'Access token required'));
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as AccessPayload;
    if (!payload.sub || !['CUSTOMER', 'ADMIN'].includes(payload.role))
      throw new Error('Invalid claims');
    request.auth = { userId: payload.sub, role: payload.role };
    return next();
  } catch {
    return next(new AppError(401, 'Access token is invalid or expired'));
  }
};

export function requireRole(...roles: Array<'CUSTOMER' | 'ADMIN'>): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth || !roles.includes(request.auth.role))
      return next(new AppError(403, 'You do not have permission for this action'));
    return next();
  };
}
