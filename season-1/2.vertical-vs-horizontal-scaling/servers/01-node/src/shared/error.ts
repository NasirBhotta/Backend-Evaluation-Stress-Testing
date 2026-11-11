  // ============================================================================
  // CENTRAL ERROR HANDLER & SECURITY SHIELD (Beginner Friendly Guide)
  // ============================================================================
  //
  // 1. CENTRAL ERROR HANDLER KYA HOTA HAI?
  // Jab pure application me kisi bhi jagah koi error phat jaye (jaise DB fail,
  // invalid JSON, ya unhandled exception), toh server crash hone ke bajaye
  // request is aakhri function me aati hai. Yeh decide karta hai ke user ko kya
  // jawab dena hai aur system ko kaise bachana hai.
  //
  // 2. INFORMATION LEAKAGE SE BACHAO (CYBER SECURITY RULE):
  // Agar server par koi fatal error (500) aye, toh user ko actual technical error
  // (jaise "MongoError in /src/models/user.ts at line 42") KABHI NAHI DIKHANA CHAHIYE.
  // Isse hacker ko database ke table names aur code structure pata chal jata hai.
  // Isliye 500 error aane par asli error sirf internal logs me likha jata hai,
  // aur user ko safe message milta hai: "Something went wrong. Please try again later."
  // ============================================================================

  import type { Next, Request, Response } from "../http/types.js";
  import mongoose from "mongoose";
  import { logger } from "../bootstrap/logger.js";
  import { noteMongoInfraFailure, sendMongoUnavailable } from "./mongo-gate.js";

  // Custom HTTP Error type jisme status code (jaise 400, 401, 404, 500) attach hota hai
  export interface HttpError extends Error {
    status: number;
  }

  // Quick helper function: httpError(404, "User not found")
  export const httpError = (status: number, message: string): HttpError =>
    Object.assign(new Error(message), { status });

  // Safe public message jo users ko dikhega jab server internally phatega
  const PUBLIC_INTERNAL = "Something went wrong. Please try again later.";

  // DATABASE INFRASTRUCTURE ERROR DETECTOR:
  // Yeh function check karta hai: "Kya error aam user ka tha (e.g. wrong password),
  // ya asli me poora database mar chuka hai ya network cut gaya hai?"
  const isMongoInfraError = (err: Error): boolean => {
    const name = err.name;
    const msg = err.message;
    const code = (err as { code?: string | number }).code;

    // 1. Common MongoDB connection aur network timeout errors
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

    // 2. MongoDB internal error codes (Primary step-down ya server shutdown)
    if (code === 10107 || code === 189 || code === 91 || code === 11600) return true;

    // 3. Regex matching: Network disconnects aur replica set election issues
    return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ReplicaSetNoPrimary|not primary|not writable/i.test(msg);
  };

  // 404 NOT FOUND HANDLER:
  // Jab user aisi route hit kare jo exist hi nahi karti (e.g. GET /wrong-url)
  export const notFound = (req: Request, res: Response): void => {
    res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
  };

  // ============================================================================
  // MAIN ERROR HANDLER MIDDLEWARE
  // ============================================================================
  export const errorHandler = (
    err: HttpError | mongoose.Error.CastError,
    req: Request,
    res: Response,
    next: Next,
  ): void => {
    void req;
    void next;

    // Agar headers pehle hi bhej diye gaye hon toh kuch mat karo
    if (res.headersSent) return;

    // CASE 1: INVALID MONGOOSE OBJECT ID (e.g. GET /products/123-abc)
    // MongoDB ka ObjectId 24-char hex hota hai. Agar user ne galat ID di toh Mongoose
    // CastError fekta hai. Iska matlab server kharab nahi hai, user ne ID galat di hai (400 Bad Request).
    if (err instanceof mongoose.Error.CastError) {
      res.status(400).json({ error: `Invalid ${err.path}` });
      return;
    }

    // CASE 2: DATABASE DEAD / NETWORK CRASH
    // Agar database gir chuka hai, toh circuit breaker (mongo-gate) ko alert karo:
    // noteMongoInfraFailure() call hoga taa ke breaker trip ho sake aur user ko 503 mile.
    if (isMongoInfraError(err)) {
      logger.error(err.stack ?? err.message);
      noteMongoInfraFailure();
      sendMongoUnavailable(res);
      return;
    }

    // CASE 3: 500 INTERNAL SERVER ERROR (Information Leakage Shield)
    const status = (err as HttpError).status ?? 500;
    if (status >= 500) {
      // Asli technical error ko secretly internal logger me likho
      logger.error(err.stack ?? err.message);
      // User ko safe generic message bhej do (Hacker ko code details leak na hon)
      res.status(status).json({ error: PUBLIC_INTERNAL });
      return;
    }

    // CASE 4: NORMAL USER/VALIDATION ERRORS (400, 401, 403, 404, 409)
    // In errors ka message safe hota hai (jaise "Invalid email or password"), isliye direct bhej do
    res.status(status).json({ error: err.message });
  };

