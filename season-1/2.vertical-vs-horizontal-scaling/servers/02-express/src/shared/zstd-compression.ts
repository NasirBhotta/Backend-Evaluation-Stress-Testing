import zlib from "node:zlib";
import Negotiator from "negotiator";
import type { NextFunction, Request, Response } from "express";
import { env } from "../bootstrap/env.js";
import { logger } from "../bootstrap/logger.js";
import { isIngestPost } from "../features/products/products.ingest.js";

const ZSTD_SUPPORTED = typeof zlib.createZstdCompress === "function";
const MIN_COMPRESS_BYTES = 1024;
const SERVER_ENCODING_PREFERENCE = ["br", "zstd", "gzip", "identity"];

if (env.enableZstd && !ZSTD_SUPPORTED) {
  logger.warn("ENABLE_ZSTD is true but this Node version has no native zstd support (needs 22.15+) - gzip/brotli only");
}

const zstdActive = env.enableZstd && ZSTD_SUPPORTED;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// Header overrides the env default for this request, so the bench script can
// try levels without a restart. Each codec has its own legal range.
export const compressionLevel = (req: Request): number => {
  const raw = req.get("x-compression-level");
  const n = raw === undefined ? env.compressionLevel : Number(raw);
  if (!Number.isInteger(n)) return env.compressionLevel;
  return n;
};

const openStream = (encoding: string, level: number) => {
  if (encoding === "zstd") {
    return zlib.createZstdCompress({
      params: { [zlib.constants.ZSTD_c_compressionLevel]: clamp(level, 1, 19) },
    });
  }
  if (encoding === "br") {
    return zlib.createBrotliCompress({
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: clamp(level, 0, 11) },
    });
  }
  return zlib.createGzip({ level: clamp(level, 1, 9) });
};

// Sits before the gzip/brotli `compression` middleware. Only intercepts when
// Accept-Encoding negotiation (via `negotiator`, respecting client q-values against
// our br > zstd > gzip > identity preference) genuinely picks zstd - everything else
// falls through to `compression`, which already handles br/gzip correctly (streaming,
// Vary, threshold, HEAD). Gated by ENABLE_ZSTD: needs Node 22.15+, and zstd client
// support is still limited (Chrome/Edge 123+ only, roughly) - opt-in, not default.
export const zstdCompression = (req: Request, res: Response, next: NextFunction): void => {
  if (isIngestPost(req)) {
    next();
    return;
  }

  const chosen = new Negotiator(req).encoding(SERVER_ENCODING_PREFERENCE);
  const headerOverride = req.get("x-compression-level") !== undefined;
  // zstd always, because the `compression` package cannot do it.
  // gzip/br only when the bench header is set, so that level is per request.
  // Otherwise gzip/br fall through to `compression`, which uses COMPRESSION_LEVEL.
  const handleHere = chosen === "zstd" ? zstdActive : headerOverride && (chosen === "gzip" || chosen === "br");
  if (!handleHere || !chosen) {
    next();
    return;
  }
  const level = compressionLevel(req);

  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    // a prior middleware (e.g. requestTimeout) may have already responded while this
    // handler was still running - never write headers/body twice (ERR_HTTP_HEADERS_SENT)
    if (res.headersSent) return res;

    const payload = Buffer.from(JSON.stringify(body));
    if (payload.length < MIN_COMPRESS_BYTES) return originalJson(body);

    res.setHeader("Content-Encoding", chosen);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    // HEAD responses describe what GET would return but carry no body
    if (req.method === "HEAD") {
      res.end();
      return res;
    }

    const stream = openStream(chosen, level);
    stream.on("error", (err: Error) => {
      logger.error(`${chosen} compression failed, falling back to uncompressed: ${err.message}`);
      if (!res.headersSent) {
        res.removeHeader("Content-Encoding");
        res.removeHeader("Vary");
        originalJson(body);
      }
    });
    stream.pipe(res);
    stream.end(payload);
    return res;
  }) as typeof res.json;

  next();
};
