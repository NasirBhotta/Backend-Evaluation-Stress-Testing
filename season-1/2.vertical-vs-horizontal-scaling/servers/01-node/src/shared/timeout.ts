// ============================================================================
// REQUEST TIMEOUT MIDDLEWARE (Hung Connection Prevention)
// ============================================================================
//
// 1. TIMEOUT KYUN ZAROORI HAI?
// Maan lein database kisi heavy query me phans gaya aur 10 minute tak koi
// jawab nahi aya. Agar hum timeout na lagayein, toh client ka connection open
// rahega. Hazaron connections open rehne se server ki RAM aur network sockets
// khatam ho jayengi aur naye users ke liye server "Dead" ho jayega.
//
// 2. SENIOR INTERVIEW QUESTION: res.setTimeout() kyun USE NAHI KIYA?
// HTTP 1.1 me "Keep-Alive" feature hota hai: Ek hi TCP connection (socket) par
// multiple requests aati hain.
// Node ka built-in 'res.setTimeout()' socket-level par timer lagata hai.
// Agar Request-1 complete ho jaye, lekin timer piche chal raha ho, toh jab
// Request-2 aye gi, timer achanak trigger ho kar Request-2 ko crash kar dega
// (Error: Cannot set headers after they are sent).
//
// SOLUTION:
// Hum application-level 'setTimeout()' use karte hain aur jaise hi request
// finish ('finish' ya 'close') hoti hai, timer ko foran cancel (clearTimeout) kar dete hain.
// ============================================================================

import type { Next, Request, Response } from "../http/types.js";
import { isIngestPost } from "../features/products/products.ingest.js";

// Har request ke liye maximum 30 seconds ka time limit
export const REQUEST_TIMEOUT_MS = 30_000;

export const requestTimeout = (req: Request, res: Response, next: Next): void => {
  // Bulk ingestion me lakho products load hoty hain, isliye us route ko timeout se chhoot di gayi hai
  if (isIngestPost(req)) {
    next();
    return;
  }

  // 1. Timer start karo: agar 30 second tak response na jaye toh 503 bhej kar connection band karo
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({ error: "Request timed out" });
    }
  }, REQUEST_TIMEOUT_MS);

  // 2. Safety Cleanup:
  // Jab request successfully complete ho jaye ('finish') ya client khud connection kaat de ('close'),
  // toh timer ko cancel kar do taa ke memory leak na ho
  res.once("finish", () => clearTimeout(timer));
  res.once("close", () => clearTimeout(timer));

  // Request ko agle middleware / route par jane do
  next();
};

