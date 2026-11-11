// ============================================================================
// HYBRID SESSION STORE (MongoDB + Redis Cache-Aside Pattern)
// ============================================================================
//
// YEH FILE KYA KARTI HAI?
// Yeh file hamari sessions ki "Single Source of Truth" hai.
// Har user login ko ek unique ID (jti) milti hai jo do jagah save hoti hai:
// 1. Redis (In-Memory Fast Lookup): 99% requests yahin se 1ms me verify hoti hain.
// 2. MongoDB (Persistent Storage): Agar Redis restart ho jaye toh data zinda rehta hai.
//
// MONGODB TTL INDEX (EXPIRES: 0):
// MongoDB me expires: 0 ka matlab hai ke jaise hi expiresAt ka waqt guzrega,
// MongoDB background me is record ko khud hi delete (purge) kar dega.
// Hamari database me purana kachra jama nahi hota!
// ============================================================================

import mongoose, { Schema, type Document } from "mongoose";
import { cacheGet, cacheSet, cacheDel } from "./redisGateway.js";

// Session document ka TypeScript interface
interface SessionDocument extends Document<string> {
  _id: string; // jti (UUID) jo access token aur refresh token dono share karte hain
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
}

const sessionSchema = new Schema<SessionDocument>({
  _id: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  // expires: 0 absolute date par kaam karta hai: "Jab yeh date past ban jaye toh delete kar do"
  expiresAt: { type: Date, required: true, expires: 0 },
});

const Session = mongoose.model<SessionDocument>("Session", sessionSchema);

// Redis key format: "session:<jti>"
const redisKey = (jti: string): string => `session:${jti}`;

// Expiry date se remaining seconds (TTL) calculate karne ka helper
const ttlSeconds = (expiresAt: Date): number => Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

// ============================================================================
// 1. CREATE SESSION (Login ke waqt)
// ============================================================================
// Jab user email/password daal kar login karta hai:
// MongoDB me permanent record banta hai aur saath hi Redis me bhi daal diya jata hai
export const createSession = async (userId: string, jti: string, expiresAt: Date): Promise<void> => {
  await Session.create({ _id: jti, userId, expiresAt });
  await cacheSet(redisKey(jti), userId, ttlSeconds(expiresAt));
};

// ============================================================================
// 2. IS SESSION VALID (Har Protected Request par)
// ============================================================================
// CACHE-ASIDE PATTERN (INTERVIEW FAVORITE):
// Step 1: Pehle Redis me dhoondo (Super Fast < 1ms)
// Step 2: Agar Redis me mil gaya -> Return True (MongoDB ko touch bhi nahi kiya!)
// Step 3: Agar Redis me nahi mila (Cache Miss ya Redis restart):
//         MongoDB se dhoondo. Agar MongoDB me valid hai toh wapis Redis me daal do (Cache Warmup).
export const isSessionValid = async (jti: string): Promise<boolean> => {
  const cached = await cacheGet(redisKey(jti));
  if (cached !== null) return true;

  // MongoDB ka background TTL sweeper har 60s me chalta hai.
  // Isliye { expiresAt: { $gt: new Date() } } filter lagaya hai taa ke agar record
  // abhi tak delete na hua ho tab bhi expire hone ke baad valid na mana jaye.
  const doc = await Session.findOne({ _id: jti, expiresAt: { $gt: new Date() } }).lean();
  if (!doc) return false;

  // Redis me wapis save karo taa ke agli request fast chal sake
  await cacheSet(redisKey(jti), String(doc.userId), ttlSeconds(doc.expiresAt));
  return true;
};

// ============================================================================
// 3. REVOKE SESSION (Single Device Logout)
// ============================================================================
// Jab user "Logout" par click kare:
// MongoDB aur Redis dono jagah se session foran delete karo taa ke token usi waqt mar jaye
export const revokeSession = async (jti: string): Promise<void> => {
  await Session.deleteOne({ _id: jti });
  await cacheDel(redisKey(jti));
};

// ============================================================================
// 4. REVOKE ALL SESSIONS (Logout From All Devices)
// ============================================================================
// Real world feature:
// Jab user password change karta hai ya "Log out from all other browsers" karta hai:
// User ke saare sessions dhoond kar MongoDB aur Redis dono se ek saath uda diye jaate hain
export const revokeAllSessions = async (userId: string): Promise<void> => {
  const sessions = await Session.find({ userId }).select("_id").lean();
  await Session.deleteMany({ userId });
  if (sessions.length === 0) return;

  await cacheDel(sessions.map((s) => redisKey(String(s._id))));
};

