import "./mongo-host-dns.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { connectDatabase } from "./database.js";
import { connectRedis } from "./redis.js";
import { registerProcessHandlers } from "./shutdown.js";

export const bootstrap = async () => {
  registerProcessHandlers();
  await connectDatabase();
  void connectRedis();
  logger.info(`Bootstrap complete — env: ${env.nodeEnv}`);
  return { logger, env };
};
