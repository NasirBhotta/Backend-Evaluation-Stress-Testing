import dotenv from "dotenv";
import { z } from "zod";

// NODE_ENV=test (set by the caller/pm2 env, before this file runs) loads .env.test
// instead of .env - a persistent, separate DB/port for repeatable perf/functional
// testing without ever touching the main .env or its database.
dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5002),
  // z.string().url() rejects replica URIs — comma-separated hosts are not a WHATWG URL
  MONGO_URI: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"), {
      message: "MONGO_URI must start with mongodb:// or mongodb+srv://",
    })
    .default(
      "mongodb://127.0.0.1:27017/flip-commerce",
    ),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  // z.coerce.boolean() would treat the literal string "false" as truthy - explicit
  // enum + transform avoids that footgun. Opt-in (needs Node 22.15+ for zlib zstd).
  ENABLE_ZSTD: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // 1 = fastest, least CPU. Higher = smaller body, more CPU.
  // gzip uses 1-9, brotli 0-11, zstd 1-19. One number, each codec clamps it.
  COMPRESSION_LEVEL: z.coerce.number().int().min(1).max(19).default(1),
  // no default on either secret - a leaked/forgotten one must fail startup, not silently sign tokens
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("6h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  MONGO_CIRCUIT_MS: z.coerce.number().int().positive().default(2000),
  MONGO_CIRCUIT_FAILS: z.coerce.number().int().positive().default(3),
  MONGO_SELECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  mongoUri: parsed.data.MONGO_URI,
  redisUrl: parsed.data.REDIS_URL,
  logLevel: parsed.data.LOG_LEVEL,
  isProd: parsed.data.NODE_ENV === "production",
  enableZstd: parsed.data.ENABLE_ZSTD,
  compressionLevel: parsed.data.COMPRESSION_LEVEL,
  jwtAccessSecret: parsed.data.JWT_ACCESS_SECRET,
  jwtRefreshSecret: parsed.data.JWT_REFRESH_SECRET,
  jwtAccessExpiresIn: parsed.data.JWT_ACCESS_EXPIRES_IN,
  jwtRefreshExpiresIn: parsed.data.JWT_REFRESH_EXPIRES_IN,
  mongoCircuitMs: parsed.data.MONGO_CIRCUIT_MS,
  mongoCircuitFails: parsed.data.MONGO_CIRCUIT_FAILS,
  mongoSelectTimeoutMs: parsed.data.MONGO_SELECT_TIMEOUT_MS,
};
