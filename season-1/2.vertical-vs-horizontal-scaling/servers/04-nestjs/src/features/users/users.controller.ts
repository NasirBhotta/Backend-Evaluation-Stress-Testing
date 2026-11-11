import crypto from 'node:crypto';
import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import { User } from './users.model.js';
import * as validate from './users.validation.js';
import { httpError } from '../../shared/error.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, getExpiry } from '../../shared/jwt.js';
import { createSession, isSessionValid, revokeSession, revokeAllSessions } from '../../shared/session.js';
import { AuthGuard } from '../../shared/auth.js';

const BCRYPT_ROUNDS = 10;

const issueTokens = async (userId: string): Promise<{ accessToken: string; refreshToken: string }> => {
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(userId, jti);
  const accessToken = signAccessToken(userId, jti);
  await createSession(userId, jti, getExpiry(refreshToken));
  return { accessToken, refreshToken };
};

@Controller('users')
export class UsersController {
  @Post('signup')
  @HttpCode(201)
  async signup(@Body() body: unknown) {
    const payload = validate.validateSignup(body);
    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);

    let user;
    try {
      user = await User.create({
        name: payload.name,
        email: payload.email,
        passwordHash,
        gender: payload.gender,
        bio: payload.bio,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw httpError(409, 'Email already registered');
      throw err;
    }

    const tokens = await issueTokens(String(user._id));
    return {
      user: { id: user._id, name: user.name, email: user.email },
      ...tokens,
    };
  }

  @Post('login')
  async login(@Body() body: unknown) {
    const payload = validate.validateLogin(body);
    const user = await User.findOne({ email: payload.email }).select('+passwordHash');
    if (!user) throw httpError(401, 'Invalid email or password');
    if (!user.isActive) throw httpError(401, 'This account has been deactivated');

    const matches = await bcrypt.compare(payload.password, user.passwordHash);
    if (!matches) throw httpError(401, 'Invalid email or password');

    const tokens = await issueTokens(String(user._id));
    return {
      user: { id: user._id, name: user.name, email: user.email },
      ...tokens,
    };
  }

  @Post('refresh')
  async refresh(@Body() body: unknown) {
    const refreshToken = validate.validateRefresh(body);
    const payload = verifyRefreshToken(refreshToken);
    const valid = await isSessionValid(payload.jti);
    if (!valid) throw httpError(401, 'Session has been revoked or expired');

    const accessToken = signAccessToken(payload.sub, payload.jti);
    return { accessToken };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: FastifyRequest) {
    const user = await User.findById(req.user!.id);
    if (!user) throw httpError(404, 'User not found');
    return user;
  }

  @Put('me')
  @UseGuards(AuthGuard)
  async updateProfile(@Req() req: FastifyRequest, @Body() body: unknown) {
    const patch = validate.validateUpdateProfile(body);
    const user = await User.findByIdAndUpdate(req.user!.id, patch, { new: true, runValidators: true });
    if (!user) throw httpError(404, 'User not found');
    if (patch.isActive === false) await revokeAllSessions(req.user!.id);
    return user;
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@Req() req: FastifyRequest) {
    await revokeSession(req.user!.jti);
    return { message: 'Logged out' };
  }
}
