import type { NextFunction, Request, Response } from "express";
import { env } from "../bootstrap/env.js";
import { getMongoTopology, isMongoShuttingDown } from "../bootstrap/mongo-topology.js";

const PUBLIC_UNAVAILABLE = "Service is temporarily unavailable. Please try again later.";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let circuitOpenUntil = 0;
let failCount = 0;
let failWindowStart = 0;

const tripMongoCircuit = (): void => {
  circuitOpenUntil = Date.now() + env.mongoCircuitMs;
  failCount = 0;
  failWindowStart = 0;
};

export const noteMongoInfraFailure = (): void => {
  if (getMongoTopology().electionPossible) return;

  const now = Date.now();
  if (failWindowStart === 0 || now - failWindowStart > env.mongoCircuitMs) {
    failWindowStart = now;
    failCount = 0;
  }

  failCount += 1;
  if (failCount >= env.mongoCircuitFails) tripMongoCircuit();
};

export const noteMongoSuccess = (): void => {
  failCount = 0;
  failWindowStart = 0;
};

const retryAfterSeconds = (): number => {
  const remaining = circuitOpenUntil - Date.now();
  if (remaining > 0) return Math.max(1, Math.ceil(remaining / 1000));
  return Math.max(1, Math.ceil(env.mongoSelectTimeoutMs / 1000));
};

export const sendMongoUnavailable = (res: Response): void => {
  res.set("Retry-After", String(retryAfterSeconds()));
  res.status(503).json({ error: PUBLIC_UNAVAILABLE });
};

export const mongoGate = (req: Request, res: Response, next: NextFunction): void => {
  if (isMongoShuttingDown()) {
    sendMongoUnavailable(res);
    return;
  }

  const { reads, writes, electionPossible } = getMongoTopology();
  const needsWrite = WRITE_METHODS.has(req.method);
  const waitingForPrimary = needsWrite && !writes && electionPossible;

  if (!reads) {
    sendMongoUnavailable(res);
    return;
  }

  // Majority impossible (e.g. 1 leftover SECONDARY) — wait will never elect a PRIMARY
  if (needsWrite && !writes && !electionPossible) {
    sendMongoUnavailable(res);
    return;
  }

  // Election: skip circuit so the driver can wait for a new PRIMARY
  if (Date.now() < circuitOpenUntil && !waitingForPrimary) {
    sendMongoUnavailable(res);
    return;
  }

  res.on("finish", () => {
    if (res.statusCode < 500) noteMongoSuccess();
  });

  next();
};
