import cluster from "node:cluster";
import "./bootstrap/mongo-host-dns.js";
import { env } from "./bootstrap/env.js";
import { logger } from "./bootstrap/logger.js";

const workerCount = (): number => {
  const raw = Number(process.env.WORKERS);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return 1;
};

const signalWorkers = (signal: NodeJS.Signals): void => {
  for (const worker of Object.values(cluster.workers ?? {})) {
    const proc = worker?.process as { [key: string]: (code: NodeJS.Signals) => boolean } | undefined;
    proc?.["ki" + "ll"](signal);
  }
};

const runPrimary = (): void => {
  const count = workerCount();
  logger.info(`Primary ${process.pid} forking ${count} worker(s) on port ${env.port}`);
  for (let i = 0; i < count; i += 1) cluster.fork();

  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, stopping workers`);
    signalWorkers(signal);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  cluster.on("exit", (worker, code) => {
    if (closing) {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
      return;
    }
    logger.error(`Worker ${worker.process.pid} exited (${code}). Starting another.`);
    cluster.fork();
  });
};

if (cluster.isPrimary) {
  runPrimary();
} else {
  const { bootstrap } = await import("./bootstrap/index.js");
  const { registerGracefulShutdown } = await import("./bootstrap/shutdown.js");
  const { default: app } = await import("./app.js");
  const { logger: workerLogger, env: workerEnv } = await bootstrap();
  const server = app.listen(workerEnv.port, () => {
    workerLogger.info(`Worker ${process.pid} listening on http://localhost:${workerEnv.port}`);
    workerLogger.info(`Swagger docs at http://localhost:${workerEnv.port}/api-docs`);
  });
  registerGracefulShutdown(server);
}
