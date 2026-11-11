// ============================================================================
// REDIS GATEWAY & RESILIENCE (Graceful Cache Degradation)
// ============================================================================
//
// 1. CACHE RESILIENCE PATTERN KYA HOTA HAI?
// Real life example:
// Maan lein aap restaurant gaye aur unka Card Machine (POS) 1 minute ke liye
// slow ho gaya. Restaurant aapko bhookha wapis nahi bhejta, wo bolte hain
// "Koi baat nahi, aap Cash de dein".
//
// Backend me Cache Degradation:
// Redis ek in-memory speed booster hai. Agar kisi din Redis crash ho jaye ya
// network slow ho jaye, toh kya hamara poora application band ho jana chahiye?
// HARGIZ NAHI!
// Agar Redis 150ms ke andar jawab na de, toh yeh file query ko cancel (short-circuit)
// kar deti hai aur database (MongoDB) se data utha leti hai.
// Isse users ko downtime ka pata bhi nahi chalta!
// ============================================================================

import { redisClient } from "../bootstrap/redis.js";
import { logger } from "../bootstrap/logger.js";

// REDIS TIMEOUT (150 Milliseconds):
// Redis memory me hota hai, iska jawab 1 se 2 millisecond me aana chahiye.
// Agar 150ms se zyada time lag raha hai, iska matlab Redis hang ho chuka hai.
const CALL_TIMEOUT_MS = 150;

// TIMEOUT WRAPPER (Promise.race):
// Redis operation aur 150ms ke timer ke darmiyan race lagata hai.
// Jo pehle finish hoga wo jeet jayega. Agar timer pehle baj gaya toh timeout reject hoga.
const withTimeout = <T>(op: Promise<T>): Promise<T> => {
  // Agar op race haarne ke baad reject ho, toh Node.js me unhandled rejection crash na bane
  op.catch(() => {});
  return Promise.race([
    op,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("redis call timeout")), CALL_TIMEOUT_MS)),
  ]);
};

// ============================================================================
// SAFE REDIS OPERATIONS (Fail-Safe Helpers)
// ============================================================================

// REDIS SE DATA LENA:
// Agar Redis down hai ya timeout ho gaya, toh error throw karne ke bajaye 'null' return karo
// taa ke caller MongoDB fallback par chala jaye.
export const cacheGet = async (key: string): Promise<string | null> => {
  if (!redisClient.isReady) return null;
  try {
    return await withTimeout(redisClient.get(key));
  } catch (err) {
    logger.warn(`Redis get short-circuited for ${key}: ${(err as Error).message}`);
    return null;
  }
};

// REDIS ME DATA SAVE KARNA:
// Key-Value ke saath TTL (Time-To-Live in seconds) set karta hai
export const cacheSet = async (key: string, value: string, ttlSeconds: number): Promise<void> => {
  if (!redisClient.isReady) return;
  try {
    await withTimeout(redisClient.set(key, value, { EX: ttlSeconds }));
  } catch (err) {
    logger.warn(`Redis set short-circuited for ${key}: ${(err as Error).message}`);
  }
};

// REDIS SE KEY DELETE KARNA (Logout ya Session Revocation ke waqt):
export const cacheDel = async (keys: string | string[]): Promise<void> => {
  if (!redisClient.isReady) return;
  try {
    await withTimeout(redisClient.del(keys));
  } catch (err) {
    logger.warn(`Redis del short-circuited: ${(err as Error).message}`);
  }
};

