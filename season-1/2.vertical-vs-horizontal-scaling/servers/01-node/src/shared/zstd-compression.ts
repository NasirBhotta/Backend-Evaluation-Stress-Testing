// ============================================================================
// RESPONSE COMPRESSION ENGINE (Gzip, Brotli, Zstandard)
// ============================================================================
// YEH FILE KYUN BANAYI GYI?
// Production APIs me JSON payload ko compress karna bandwidth cost aur latency
// dono ko 70% se 85% tak kam kar deta hai.
//
// Yeh middleware:
// 1. Client ke 'Accept-Encoding' header ko parse karta hai (Content Negotiation).
// 2. Best algorithm choose karta hai: Brotli (br), Zstandard (zstd), ya Gzip.
// 3. 1KB se chote payloads ko plain chorta hai (Negative compression prevention).
// 4. Response stream ko on-the-fly compress karke client ko bhejta hai.
// ============================================================================

import zlib from "node:zlib";
import Negotiator from "negotiator";
import type { Next, Request, Response } from "../http/types.js";
import { env } from "../bootstrap/env.js";
import { logger } from "../bootstrap/logger.js";
import { isIngestPost } from "../features/products/products.ingest.js";

// Node.js 22.15+ me Zstandard (zstd) ka native support aya hai.
// Purane Node versions me sirf gzip aur brotli chalte hain.
const ZSTD_SUPPORTED = typeof zlib.createZstdCompress === "function";

// MINIMUM COMPRESSION THRESHOLD (1 KB):
// INTERVIEW QUESTION: Chhoti responses ko compress kyun nahi karte?
// Agar payload 500 bytes ka ho, toh compress karne par metadata aur headers ki
// wajah se size kam hone ke bajaye barh sakta hai (Negative Compression).
// Isliye 1024 bytes (1KB) se chote responses ko plain bheja jata hai.
const MIN_COMPRESS_BYTES = 1024;

// Server ki tarjeeh (Priority Order):
// 1. br (Brotli): Text/JSON ke liye best compression ratio.
// 2. zstd: Meta ka algorithm, ultra-fast compression aur decompression.
// 3. gzip: Universal standard, har browser aur client support karta hai.
// 4. identity: Plain text (koi compression nahi).
const SERVER_ENCODING_PREFERENCE = ["br", "zstd", "gzip", "identity"];

if (env.enableZstd && !ZSTD_SUPPORTED) {
  logger.warn("ENABLE_ZSTD is true but this Node version has no native zstd support (needs 22.15+) - gzip/brotli only");
}

const zstdActive = env.enableZstd && ZSTD_SUPPORTED;

// Number ko safe minimum aur maximum range ke andar lock karna
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// ============================================================================
// COMPRESSION LEVEL CONFIGURATION
// ============================================================================
// Benchmark ke waqt bina server restart kiye custom level test karne ke liye
// 'x-compression-level' request header check kiya jata hai.
//
// REAL-WORLD TRADE-OFF:
// - High level (e.g. Brotli 11, Gzip 9): Max size reduction, lekin CPU 100% choke ho jata hai!
// - Low level (Level 1): 80% compression mil jati hai sirf 15% CPU cost par.
// Production APIs me hamesha Level 1 recommend kiya jata hai.
export const compressionLevel = (req: Request): number => {
  const raw = req.get("x-compression-level");
  const n = raw === undefined ? env.compressionLevel : Number(raw);
  if (!Number.isInteger(n)) return env.compressionLevel;
  return n;
};

// Har compression codec ke mutabiq unka native stream create karna
const openStream = (encoding: string, level: number) => {
  if (encoding === "zstd") {
    // Zstandard legal levels: 1 se 19 (default fast level 1-3)
    return zlib.createZstdCompress({
      params: { [zlib.constants.ZSTD_c_compressionLevel]: clamp(level, 1, 19) },
    });
  }
  if (encoding === "br") {
    // Brotli quality levels: 0 se 11 (web APIs ke liye 1-4 best hai)
    return zlib.createBrotliCompress({
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: clamp(level, 0, 11) },
    });
  }
  // Gzip levels: 1 se 9 (level 1 fastest hai)
  return zlib.createGzip({ level: clamp(level, 1, 9) });
};

// ============================================================================
// COMPRESSION MIDDLEWARE
// ============================================================================
export const zstdCompression = (req: Request, res: Response, next: Next): void => {
  // Bulk ingestion POST requests me compression ki zaroorat nahi hoti
  if (isIngestPost(req)) {
    next();
    return;
  }

  // 1. CONTENT NEGOTIATION:
  // Client ke 'Accept-Encoding' aur server ke supported algorithms ka match karna
  const offered = zstdActive
    ? SERVER_ENCODING_PREFERENCE
    : SERVER_ENCODING_PREFERENCE.filter((item) => item !== "zstd");
  const chosen = new Negotiator(req).encoding(offered);

  // Agar client compression support nahi karta ya identity mangta hai, toh bypass karo
  if (!chosen || chosen === "identity") {
    next();
    return;
  }

  const level = compressionLevel(req);
  const originalJson = res.json.bind(res);

  // 2. MONKEY-PATCH res.json:
  // Pure Node me response ko intercept karne ke liye res.json ko wrap karte hain
  res.json = (body: unknown) => {
    if (res.headersSent) return res;

    const payload = Buffer.from(JSON.stringify(body));

    // Size check: agar 1KB se chota hai toh plain bhejo (CPU aur size dono bachega)
    if (payload.length < MIN_COMPRESS_BYTES) return originalJson(body);

    // 3. HTTP HEADERS (INTERVIEW FAVORITE):
    // Content-Encoding: Client ko batata hai data decode kaise karna hai (gzip, br, ya zstd).
    res.setHeader("Content-Encoding", chosen);

    // Vary: Accept-Encoding:
    // Nginx / Cloudflare CDN ko batata hai ke har encoding ke liye alag cache copy rakho.
    // Iske bina CDN compressed data un browsers ko bhej dega jo decode nahi kar sakte.
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    // HEAD request me body nahi hoti, sirf headers bhej kar khatam karo
    if (req.method === "HEAD") {
      res.end();
      return res;
    }

    // 4. STREAMING COMPRESSION:
    // Memory me poora compressed buffer bananey ke bajaye Stream use hoti hai
    const stream = openStream(chosen, level);

    // Safety fallback: agar compression stream fail ho jaye toh uncompressed bhej do
    stream.on("error", (err: Error) => {
      logger.error(`${chosen} compression failed, falling back to uncompressed: ${err.message}`);
      if (!res.headersSent) {
        res.removeHeader("Content-Encoding");
        res.removeHeader("Vary");
        originalJson(body);
      }
    });

    // Compressed chunks seedha network TCP socket (res) me pipe hoty hain
    stream.pipe(res);
    stream.end(payload);
    return res;
  };

  next();
};

