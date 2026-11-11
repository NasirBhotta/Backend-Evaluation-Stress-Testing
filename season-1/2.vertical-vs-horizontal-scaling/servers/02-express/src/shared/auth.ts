import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "./jwt.js";
import { isSessionValid } from "./session.js";
import { httpError } from "./error.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; jti: string };
    }
  }
}

// Express 5: async middleware ke rejected promises (throw included) khud errorHandler tak forward ho jaate hain
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  void res;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw httpError(401, "Missing bearer token");

  const payload = verifyAccessToken(header.slice("Bearer ".length));

  const valid = await isSessionValid(payload.jti);
  if (!valid) throw httpError(401, "Session has been revoked or expired");

  req.user = { id: payload.sub, jti: payload.jti };
  next();
};
