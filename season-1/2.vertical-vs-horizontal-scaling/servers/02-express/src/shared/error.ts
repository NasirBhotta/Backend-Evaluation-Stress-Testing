import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { logger } from "../bootstrap/logger.js";
import { noteMongoInfraFailure, sendMongoUnavailable } from "./mongo-gate.js";

export interface HttpError extends Error {
  status: number;
}

export const httpError = (status: number, message: string): HttpError =>
  Object.assign(new Error(message), { status });

const PUBLIC_INTERNAL = "Something went wrong. Please try again later.";

const isMongoInfraError = (err: Error): boolean => {
  const name = err.name;
  const msg = err.message;
  const code = (err as { code?: string | number }).code;

  if (
    name === "MongoServerSelectionError" ||
    name === "MongooseServerSelectionError" ||
    name === "MongoNetworkError" ||
    name === "MongoNetworkTimeoutError" ||
    name === "MongoTimeoutError" ||
    name === "MongoNotConnectedError"
  ) {
    return true;
  }

  // NotWritablePrimary / PrimarySteppedDown / ShutdownInProgress
  if (code === 10107 || code === 189 || code === 91 || code === 11600) return true;

  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ReplicaSetNoPrimary|not primary|not writable/i.test(msg);
};

export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
};

// 4-arg signature required — express only treats this as error middleware if it takes 4 params
export const errorHandler = (
  err: HttpError | mongoose.Error.CastError,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  void req;

  // A response can already be sent before its handler's promise settles (e.g. our
  // requestTimeout middleware fires while a slow query is still running) — writing
  // headers again here would throw ERR_HTTP_HEADERS_SENT. Delegating to Express's
  // built-in final handler is the documented way to close out such a request safely.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: `Invalid ${err.path}` });
    return;
  }

  if (isMongoInfraError(err)) {
    logger.error(err.stack ?? err.message);
    noteMongoInfraFailure();
    sendMongoUnavailable(res);
    return;
  }

  const status = (err as HttpError).status ?? 500;
  if (status >= 500) {
    logger.error(err.stack ?? err.message);
    res.status(status).json({ error: PUBLIC_INTERNAL });
    return;
  }

  res.status(status).json({ error: err.message });
};
