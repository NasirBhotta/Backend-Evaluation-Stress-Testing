import crypto from "node:crypto";
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { User } from "./users.model.js";
import * as validate from "./users.validation.js";
import { httpError } from "../../shared/error.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, getExpiry } from "../../shared/jwt.js";
import { createSession, isSessionValid, revokeSession, revokeAllSessions } from "../../shared/session.js";

const BCRYPT_ROUNDS = 10;

const issueTokens = async (userId: string): Promise<{ accessToken: string; refreshToken: string }> => {
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(userId, jti);
  const accessToken = signAccessToken(userId, jti);
  await createSession(userId, jti, getExpiry(refreshToken));
  return { accessToken, refreshToken };
};

// Express 5: async handlers ke rejected promises (throw included) khud errorHandler tak forward ho jaate hain

export const signup = async (req: Request, res: Response): Promise<void> => {
  const payload = validate.validateSignup(req.body);
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
    if ((err as { code?: number }).code === 11000) throw httpError(409, "Email already registered");
    throw err;
  }

  const tokens = await issueTokens(String(user._id));
  res.status(201).json({
    user: { id: user._id, name: user.name, email: user.email },
    ...tokens,
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const payload = validate.validateLogin(req.body);

  const user = await User.findOne({ email: payload.email }).select("+passwordHash");
  if (!user) throw httpError(401, "Invalid email or password");
  if (!user.isActive) throw httpError(401, "This account has been deactivated");

  const matches = await bcrypt.compare(payload.password, user.passwordHash);
  if (!matches) throw httpError(401, "Invalid email or password");

  const tokens = await issueTokens(String(user._id));
  res.status(200).json({
    user: { id: user._id, name: user.name, email: user.email },
    ...tokens,
  });
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const refreshToken = validate.validateRefresh(req.body);

  const payload = verifyRefreshToken(refreshToken);
  const valid = await isSessionValid(payload.jti);
  if (!valid) throw httpError(401, "Session has been revoked or expired");

  const accessToken = signAccessToken(payload.sub, payload.jti);
  res.status(200).json({ accessToken });
};

export const me = async (req: Request, res: Response): Promise<void> => {
  const user = await User.findById(req.user!.id);
  if (!user) throw httpError(404, "User not found");
  res.status(200).json(user);
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const patch = validate.validateUpdateProfile(req.body);

  const user = await User.findByIdAndUpdate(req.user!.id, patch, { new: true, runValidators: true });
  if (!user) throw httpError(404, "User not found");

  // isActive:false must kill every session this user has, not just the one making this request
  if (patch.isActive === false) await revokeAllSessions(req.user!.id);

  res.status(200).json(user);
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  await revokeSession(req.user!.jti);
  res.status(200).json({ message: "Logged out" });
};
