// ============================================================================
// JSON WEB TOKEN (JWT) ENGINE: Access & Refresh Tokens
// ============================================================================
//
// 1. JWT KYA HOTA HAI?
// Real life example:
// Jaise airport par Boarding Pass milta hai jisme aapka naam, flight number,
// aur airline ki digital mohar (signature) hoti hai. Gate par staff airline ki
// mohar dekh kar aapko plane me baithne deta hai bina airline ke main office call kiye.
// JWT bhi ek digital boarding pass hai jo user ko login ke waqt milta hai.
//
// 2. DO TOKENS KYUN? (ACCESS TOKEN VS REFRESH TOKEN)
// - Access Token (Chhoti Umar - e.g. 15 Mins):
//   Yeh har API request ke saath jata hai. Agar koi hacker network se isko chura bhi le,
//   toh 15 minute baad yeh bekaar ho jayega.
//
// - Refresh Token (Lambi Umar - e.g. 7 Days):
//   Yeh sirf ek kaam karta hai: jab 15 minute baad Access Token mar jaye, toh yeh
//   backend ko dikha kar chup-chap naya Access Token le leta hai. User ko baar baar
//   password nahi dalna padta.
//
// 3. JWT CLAIMS (sub, jti, type):
// - sub (Subject): Asal me user ka MongoDB ID hota hai.
// - jti (JWT ID): Is login session ka unique UUID.
// - type: "access" ya "refresh". Yeh check karna zaroori hai taa ke koi Refresh Token
//   ko API authentication me use na kar sake.
// ============================================================================

import jwt from "jsonwebtoken";
import { env } from "../bootstrap/env.js";
import { httpError } from "./error.js";

type TokenType = "access" | "refresh";

// Access token ka structure
export interface AccessTokenPayload {
  sub: string;
  jti: string;
  type: "access";
}

// Refresh token ka structure
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: "refresh";
}

// ACCESS TOKEN BANANA:
// User ID aur unique session ID (jti) ko secret key ke saath sign karta hai
export const signAccessToken = (userId: string, jti: string): string =>
  jwt.sign({ sub: userId, jti, type: "access" }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions["expiresIn"],
  });

// REFRESH TOKEN BANANA:
// Iski secret key alag hoti hai aur expiry lambi hoti hai (e.g. 7 days)
export const signRefreshToken = (userId: string, jti: string): string =>
  jwt.sign({ sub: userId, jti, type: "refresh" }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn as jwt.SignOptions["expiresIn"],
  });

// ============================================================================
// TOKEN VERIFIER (Cryptographic Signature Check)
// ============================================================================
const verify = (token: string, secret: string, expectedType: TokenType): { sub: string; jti: string } => {
  let decoded: string | jwt.JwtPayload;
  try {
    // 1. Secret key se verify karo ke token tamper toh nahi hua aur expire toh nahi hua
    decoded = jwt.verify(token, secret);
  } catch {
    throw httpError(401, "Invalid or expired token");
  }

  // 2. SECURITY CHECK:
  // Kya token ka type wahi hai jo hum expect kar rahe hain?
  // (Refresh token ko API auth me use karne se roko)
  if (
    typeof decoded === "string" ||
    decoded.type !== expectedType ||
    typeof decoded.sub !== "string" ||
    typeof decoded.jti !== "string"
  ) {
    throw httpError(401, "Invalid token payload");
  }

  return { sub: decoded.sub, jti: decoded.jti };
};

// Access token verify karne ka public helper
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const { sub, jti } = verify(token, env.jwtAccessSecret, "access");
  return { sub, jti, type: "access" };
};

// Refresh token verify karne ka public helper
export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  const { sub, jti } = verify(token, env.jwtRefreshSecret, "refresh");
  return { sub, jti, type: "refresh" };
};

// EXPIRY EXTRACTOR:
// Token ke andar jo expiration timestamp (exp) embedded hota hai usko Date object me convert karta hai.
// Is Date ko hum Redis aur MongoDB session ke TTL (Time-To-Live) me use karte hain.
export const getExpiry = (token: string): Date => {
  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  if (!decoded?.exp) throw httpError(500, "Signed token is missing an exp claim");
  return new Date(decoded.exp * 1000);
};

