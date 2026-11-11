// ============================================================================
// PAGINATION UTILITIES (Offset vs Cursor-based Pagination)
// ============================================================================
//
// 1. PAGINATION KYUN ZAROORI HAI?
// Agar database me 10 lakh products hon aur hum saare ek saath fetch karein,
// toh server ka RAM crash ho jayega aur mobile app hang ho jayegi.
// Isliye data ko tukdon (pages) me bheja jata hai (jaise 20 products per page).
//
// 2. OFFSET VS CURSOR PAGINATION (INTERVIEW SPECIAL):
// - Offset Pagination (page=5):
//   Database pehle ke 100 records padh kar fek deta hai (skip karta hai).
//   Jaise jaise page number barhta hai (e.g. page 10,000), database slow ho jata hai.
//
// - Cursor Pagination (cursor=last_id):
//   Database purane records skip nahi karta. Wo seedha index me aakhri ID par
//   jump karta hai aur agle 20 records utha leta hai (O(1) time).
//   Chahe 10 lakh records hon, speed hamesha 1 millisecond rehti hai!
//   Instagram/Twitter feed isi par chalti hai (Infinite Scroll).
// ============================================================================

// SAFETY LIMIT:
// Kisi bhi request me user ko maximum 100 items hi milenge.
// Real world reason: Agar koi hacker ?limit=1000000 bhej de, toh server crash
// hone se bach sake (DoS Attack Protection).
export const MAX_LIMIT = 100;

// Agar client ne limit nahi batayi toh default me 20 items bhejo
export const DEFAULT_LIMIT = 20;

// LIMIT VALIDATOR & SANITIZER:
// Query string se limit ko number me convert karta hai aur verify karta hai:
// 1. Agar number valid nahi hai ya negative hai, toh DEFAULT_LIMIT (20) return karo.
// 2. Math.trunc decimal numbers (jaise 20.5) ko integer (20) banata hai.
// 3. Math.min ensure karta hai ke number MAX_LIMIT (100) se bara na ho.
export const parseLimit = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
};

// CURSOR FILTER BUILDER (MongoDB $gt Query):
// Client pichle page ke aakhri item ka _id bhejta hai (cursor).
// MongoDB ka ObjectId time ke hisab se barhta rehta hai (Monotonically Increasing).
// Isliye { _id: { $gt: cursor } } ka matlab hai: "Is ID ke BAAD wale naye items do".
export const buildCursorFilter = (cursor: unknown): Record<string, unknown> => {
  if (typeof cursor !== "string" || !cursor) return {};
  return { _id: { $gt: cursor } };
};

// NEXT CURSOR CALCULATOR:
// Frontend ko agle page ka cursor provide karne ke liye.
// Agar aane wale items limit se kam hain, iska matlab data khatam ho gaya (null).
// Agar items limit ke barabar hain, toh aakhri item ka _id agla cursor banega.
export const buildNextCursor = <T extends { _id: unknown }>(items: T[], limit: number): string | null => {
  if (items.length < limit) return null;
  return String(items[items.length - 1]._id);
};

// PAGE NUMBER PARSER (Traditional Offset Pagination ke liye):
// Query me '?page=2' ko integer banata hai. Minimum page hamesha 1 hota hai.
export const parsePage = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
};

