// ============================================================================
// AUTHENTICATION GUARD MIDDLEWARE (RequireAuth)
// ============================================================================
//
// YEH MIDDLEWARE KYA KARTA HAI?
// Yeh protected routes (jaise /cart, /wishlist, /checkout) ka Security Guard hai.
// Agar user logged in nahi hai ya uska token chori ho chuka tha aur revoke kar
// diya gaya hai, toh yeh request ko foran 401 Unauthorized bhej kar rok deta hai.
//
// VERIFICATION KA TWO-STEP PROCESS:
// 1. JWT Signature Check: Token asli hai ya nakli (Zero database cost).
// 2. Redis Session Check: Kya user ne logout toh nahi kar diya tha? (Super fast in-memory check).
// ============================================================================

import type { Next, Request, Response } from "../http/types.js";
import { verifyAccessToken } from "./jwt.js";
import { isSessionValid } from "./session.js";
import { httpError } from "./error.js";

export const requireAuth = async (req: Request, res: Response, next: Next): Promise<void> => {
  void res;

  // 1. HEADER CHECK:
  // Client request ke andar header bhejta hai: "Authorization: Bearer <token>"
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw httpError(401, "Missing bearer token");
  }

  // "Bearer " ke 7 characters kaat kar asli JWT token nikalna
  const token = header.slice("Bearer ".length);

  // 2. CRYPTOGRAPHIC VERIFICATION:
  // Server apne secret key se verify karta hai ke token expire toh nahi hua aur kisi ne tamper toh nahi kiya
  const payload = verifyAccessToken(token);

  // 3. HYBRID SESSION CHECK (LOGOUT / REVOCATION GUARD):
  // Pure JWT ka masla yeh hota hai ke logout ke baad bhi token expire hone tak chalta rehta hai.
  // Hum Redis me jti (Token ID) check karte hain: agar user ne logout kiya hoga toh session delete ho chuka hoga.
  const valid = await isSessionValid(payload.jti);
  if (!valid) {
    throw httpError(401, "Session has been revoked or expired");
  }

  // 4. ATTACH USER TO REQUEST:
  // Verified user ka ID aur session ID req.user par laga do taa ke agle controllers
  // (jaise cart controller) ko pata chal sake ke konsa user shopping kar raha hai
  req.user = { id: payload.sub, jti: payload.jti };

  // Guard ne ijazat de di, agle route controller par jao
  next();
};

