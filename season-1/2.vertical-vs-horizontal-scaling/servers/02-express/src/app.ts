import express from "express";
import zlib from "node:zlib";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import swaggerUi from "swagger-ui-express";
import type { Request, Response, NextFunction } from "express";

import productsRouter from "./features/products/products.router.js";
import cartRouter from "./features/cart/cart.router.js";
import wishlistRouter from "./features/wishlist/wishlist.router.js";
import usersRouter from "./features/users/users.router.js";
import { swaggerSpec } from "./docs/swagger.js";
import { notFound, errorHandler } from "./shared/error.js";
import { mongoGate } from "./shared/mongo-gate.js";
import { requestTimeout } from "./shared/timeout.js";
import { zstdCompression } from "./shared/zstd-compression.js";
import { env } from "./bootstrap/env.js";
import { logger } from "./bootstrap/logger.js";
import { redisClient } from "./bootstrap/redis.js";
import { getMongoTopology } from "./bootstrap/mongo-topology.js";
import { isIngestPost } from "./features/products/products.ingest.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(zstdCompression); // zstd first (Node 22.15+ only) - falls through to gzip/brotli below otherwise
app.use(
  compression({
    level: env.compressionLevel,
    brotli: {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: Math.min(env.compressionLevel, 11),
      },
    },
    filter: (req, res) => {
      if (isIngestPost(req)) return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(express.json());
app.use(requestTimeout);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (isIngestPost(req)) {
    next();
    return;
  }
  res.on("finish", () => logger.http(`${req.method} ${req.originalUrl} ${res.statusCode}`));
  next();
});

app.get("/health", (req: Request, res: Response) => res.json({ status: "ok" }));

// Readiness only gates on Mongo reads - Redis / write-only outages must not mark the app down
app.get("/ready", (req: Request, res: Response) => {
  const topology = getMongoTopology();
  res.status(topology.reads ? 200 : 503).json({
    status: topology.reads ? "ready" : "not_ready",
    mongo: topology.connected ? "connected" : "disconnected",
    membersUp: `${topology.membersUp}/${topology.membersTotal}`,
    primary: topology.primaryHost,
    writes: topology.writes,
    reads: topology.reads,
    electionPossible: topology.electionPossible,
    redis: redisClient.isReady ? "up" : "down",
  });
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(mongoGate);
app.use("/users", usersRouter);
app.use("/products", productsRouter);
app.use("/cart", cartRouter);
app.use("/wishlist", wishlistRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
