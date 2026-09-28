import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/app-error.js';
import { env } from '../config/env.js';

type Role = 'CUSTOMER' | 'ADMIN';

function createAccessToken(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
}

export const authService = {
  async register(input: { name: string; email: string; password: string }) {
    const existing = await User.findOne({ email: input.email.toLowerCase() });
    if (existing) throw new AppError(409, 'Email is already registered');
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await User.create({
      ...input,
      email: input.email.toLowerCase(),
      passwordHash,
      role: 'CUSTOMER',
    });
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: createAccessToken(user.id, 'CUSTOMER'),
    };
  },

  async login(email: string, password: string) {
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      throw new AppError(401, 'Invalid email or password');
    const role = user.role as Role;
    const refreshToken = jwt.sign({ sub: user.id }, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_TTL as jwt.SignOptions['expiresIn'],
    });
    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await user.save();
    return {
      user: { id: user.id, name: user.name, email: user.email, role },
      accessToken: createAccessToken(user.id, role),
      refreshToken,
    };
  },

  async refresh(token: string) {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
    } catch {
      throw new AppError(401, 'Refresh token is invalid or expired');
    }
    const user = await User.findById(payload.sub).select('+refreshTokenHash');
    if (!user?.refreshTokenHash || !(await bcrypt.compare(token, user.refreshTokenHash)))
      throw new AppError(401, 'Refresh token is invalid or expired');
    const role = user.role as Role;
    return { accessToken: createAccessToken(user.id, role) };
  },

  async logout(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } });
  },
};
