import type { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; role: 'CUSTOMER' | 'ADMIN' };
    }
  }
}

export interface AccessPayload extends JwtPayload {
  sub: string;
  role: 'CUSTOMER' | 'ADMIN';
}

export {};
