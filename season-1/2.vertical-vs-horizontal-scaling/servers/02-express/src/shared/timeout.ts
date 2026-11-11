import type { NextFunction, Request, Response } from "express";
import { isIngestPost } from "../features/products/products.ingest.js";

export const REQUEST_TIMEOUT_MS = 30_000;

// ponytail: plain setTimeout/clearTimeout, NOT res.setTimeout() — that delegates to the
// underlying socket, which keep-alive reuses across requests, so a stale timer could fire
// after a later response on the same socket already finished (-> headers-already-sent
// crash). Also doesn't abort the in-flight work itself (e.g. a stuck DB query keeps
// running) — add query-level cancellation if a specific slow route needs it.
export const requestTimeout = (req: Request, res: Response, next: NextFunction): void => {
  if (isIngestPost(req)) {
    next();
    return;
  }

  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(503).json({ error: "Request timed out" });
  }, REQUEST_TIMEOUT_MS);

  res.once("finish", () => clearTimeout(timer));
  res.once("close", () => clearTimeout(timer));

  next();
};
