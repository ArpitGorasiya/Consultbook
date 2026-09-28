import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/app-error.js';

export function validate(schema: ZodType): RequestHandler {
  return (request, _response, next) => {
    const parsed = schema.safeParse({
      body: request.body,
      params: request.params,
      query: request.query,
    });
    if (!parsed.success)
      return next(
        new AppError(
          400,
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        ),
      );
    Object.assign(request, parsed.data);
    return next();
  };
}
