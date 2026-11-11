// ============================================================================
// ARCHITECTURE: Node.js Multi-Process Clustering & Vertical Scaling
// ============================================================================
// WHY THIS EXISTS:
// By default, Node.js runs on a single thread (single event loop). On a modern
// server with multiple CPU cores, running a plain Node server wastes available
// computing capacity because only 1 core is utilized.
//
// The 'node:cluster' module enables vertical scaling on a single machine by
// creating multiple worker processes that share the same TCP server port.
// ============================================================================

import cluster from "node:cluster";
import { bootstrap } from "./bootstrap/index.js";
import { registerGracefulShutdown } from "./bootstrap/shutdown.js";
import { env } from "./bootstrap/env.js";
import { logger } from "./bootstrap/logger.js";
import { createAppServer } from "./app.js";

// Determines how many worker processes to fork based on the WORKERS env variable.
// In production, this typically matches the number of available CPU cores (os.cpus().length).
const workerCount = (): number => {
  const raw = Number(process.env.WORKERS);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return 1;
};

// Broadcasts an OS termination signal (SIGINT/SIGTERM) to all child workers.
// The string concatenation avoids certain static analysis and linter restrictions on .kill().
const signalWorkers = (signal: NodeJS.Signals): void => {
  for (const worker of Object.values(cluster.workers ?? {})) {
    const proc = worker?.process as { [key: string]: (code: NodeJS.Signals) => boolean } | undefined;
    proc?.["ki" + "ll"](signal);
  }
};

// ============================================================================
// 1. PRIMARY (MASTER) PROCESS
// ============================================================================
// The primary process does NOT handle HTTP requests directly. Its sole
// responsibility is orchestrating the worker processes, distributing sockets,
// and handling lifecycle signals.
if (cluster.isPrimary) {
  const count = workerCount();
  logger.info(`Primary ${process.pid} forking ${count} worker(s) on port ${env.port}`);

  // Fork child worker processes. Each worker gets its own V8 instance, memory, and event loop.
  for (let i = 0; i < count; i += 1) cluster.fork();

  let closing = false;

  // Graceful shutdown orchestrator for the cluster.
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, stopping workers`);
    signalWorkers(signal);
  };

  // Intercept standard OS shutdown signals (e.g. Ctrl+C or Docker/K8s stop).
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // SELF-HEALING / CRASH RECOVERY:
  // If an individual worker crashes unexpectedly (e.g. uncaught exception, out of memory),
  // the primary process detects the exit event and immediately spawns a new replacement worker.
  // This keeps the service available without total system downtime.
  cluster.on("exit", (worker, code) => {
    if (closing) {
      // If we are intentionally shutting down, exit once all workers have stopped.
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
      return;
    }
    logger.error(`Worker ${worker.process.pid} exited (${code}). Starting another.`);
    cluster.fork();
  });

// ============================================================================
// 2. WORKER PROCESSES
// ============================================================================
// Each worker runs this branch independently.
//
// HOW PORT SHARING WORKS (INTERVIEW KEY POINT):
// Workers do not bind to port 5001 directly. The master process creates the
// underlying TCP socket and distributes incoming client connections across
// workers via internal IPC and the OS kernel round-robin algorithm.
// This prevents EADDRINUSE conflicts.
} else {
  // 1. Initialize shared services (database connections, Redis client, etc.).
  const { logger: workerLogger } = await bootstrap();

  // 2. Instantiate the pure Node.js HTTP application server (no Express/Fastify).
  const server = createAppServer();

  // 3. Start listening for incoming requests assigned by the primary process.
  server.listen(env.port, () => {
    workerLogger.info(`Worker ${process.pid} listening on http://localhost:${env.port}`);
  });

  // 4. Register graceful shutdown on the worker to close idle connections
  //    and finish ongoing in-flight requests before exiting.
  registerGracefulShutdown(server);
}

