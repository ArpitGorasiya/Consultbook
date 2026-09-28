import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncController = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(controller: AsyncController): RequestHandler {
  return (request, response, next) => {
    void controller(request, response, next).catch(next);
  };
}
