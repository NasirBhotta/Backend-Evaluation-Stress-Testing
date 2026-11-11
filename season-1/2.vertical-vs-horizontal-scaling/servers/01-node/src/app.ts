  // ============================================================================
  // APPLICATION ENTRY & REQUEST PIPELINE (Pure Node.js HTTP Server)
  // ============================================================================
  // YEH FILE KYA KARTI HAI?
  // Yeh hamare pure Node.js HTTP application ka core controller hai.
  // Yahan saari routes mount hoti hain, security headers lagte hain, aur request ko
  // ek strict sequential middleware pipeline se guzara jata hai.
  // ============================================================================

  import { createServer, type Server } from "node:http";
  import { logger } from "./bootstrap/logger.js";
  import { redisClient } from "./bootstrap/redis.js";
  import { getMongoTopology } from "./bootstrap/mongo-topology.js";
  import { swaggerSpec } from "./docs/swagger.js";
  import { errorHandler, notFound } from "./shared/error.js";
  import { mongoGate } from "./shared/mongo-gate.js";
  import { requestTimeout } from "./shared/timeout.js";
  import { zstdCompression } from "./shared/zstd-compression.js";
  import { decorate, findRoute, mountRoutes, readJsonBody, runHandlers } from "./http/router.js";
  import type { Handler, Request, Response } from "./http/types.js";
  import productsRouter from "./features/products/products.router.js";
  import cartRouter from "./features/cart/cart.router.js";
  import wishlistRouter from "./features/wishlist/wishlist.router.js";
  import usersRouter from "./features/users/users.router.js";

  // ============================================================================
  // ROUTE REGISTRATION (Feature Modules)
  // ============================================================================
  // Har feature ka apna separate router hai (Modular Architecture).
  // mountRoutes() prefix add karta hai (e.g. /products/list, /cart/add waghera).
  const routes = [
    ...mountRoutes("/users", usersRouter),
    ...mountRoutes("/products", productsRouter),
    ...mountRoutes("/cart", cartRouter),
    ...mountRoutes("/wishlist", wishlistRouter),
  ];

  // ============================================================================
  // SECURITY HEADERS (Production Best Practices)
  // ============================================================================
  // Real World Security:
  // 1. nosniff: Browser ko zabardasti script execute karne se rokta hai (MIME-sniffing attack).
  // 2. SAMEORIGIN: Website ko kisi iframe ke andar khulne se rokta hai (Clickjacking attack).
  // 3. no-referrer: User ka confidential URL kisi teesri site ko leak hone se bachata hai.
  const securityHeaders = (res: Response): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
  };

  // CORS HEADERS (Cross-Origin Resource Sharing)
  // Frontend ko backend se baat karne ki ijazat deta hai.
  const corsHeaders = (res: Response): void => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept-Encoding, x-compression-level");
  };

  // ============================================================================
  // ACCESS LOGGING (Performance Optimization)
  // ============================================================================
  // HIGH LOAD INTERVIEW TIP:
  // Agar har second 20,000 requests aa rahi hon aur aap har request par disk pe
  // log likhne lag jayen, toh aapka server Disk I/O me choke ho jayega.
  // Isliye '/products/ingest' (bulk data loading) route ko logging se skip kiya gaya hai.
  const accessLog: Handler = (req, res, next) => {
    if (req.method === "POST" && req.path === "/products/ingest") {
      next();
      return;
    }
    // res.on('finish') tab chalta hai jab response client ko deliver ho chuka ho
    res.on("finish", () => logger.http(`${req.method} ${req.originalUrl} ${res.statusCode}`));
    next();
  };

  // ============================================================================
  // READINESS PROBE: Kubernetes / Cloud Health Monitoring
  // ============================================================================
  // INTERVIEW QUESTION: Liveness Probe vs Readiness Probe me kya farq hai?
  // - Liveness (/health): Server process zinda hai ya nahi.
  // - Readiness (/ready): Server traffic accept karne ke qabil hai ya nahi (DB connected hai ya nahi).
  // Agar MongoDB me election chal rahi ho ya primary down ho toh yeh 503 dega
  // taa ke Load Balancer is container par user ka traffic na bheje.
  const ready = (_req: Request, res: Response): void => {
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
  };

  // ============================================================================
  // EARLY ROUTES (Fast Path Execution)
  // ============================================================================
  // Kyun pehle rakha?
  // /health aur /api-docs ko Database check ya heavy routing se pehle rakhna chahiye
  // taa ke Load Balancer ko microsecond me status mil sake aur CPU waste na ho.
  const earlyRoutes: Handler = (req, res, next) => {
    if (req.method === "GET" && req.path === "/health") {
      res.json({ status: "ok" });
      return;
    }
    if (req.method === "GET" && req.path === "/ready") {
      ready(req, res);
      return;
    }
    if (req.method === "GET" && req.path === "/api-docs") {
      res.json(swaggerSpec);
      return;
    }
    next();
  };

  // ============================================================================
  // FEATURE ROUTE DISPATCHER
  // ============================================================================
  // Matching route dhoond kar uske handlers run karta hai
  const featureRoutes: Handler = (req, res, next) => {
    const hit = findRoute(routes, req.method ?? "GET", req.path);
    if (!hit) {
      notFound(req, res);
      return;
    }
    req.params = hit.params;
    return runHandlers(hit.route.handlers, req, res).catch((err) => next(err));
  };

  // ============================================================================
  // PIPELINE SEQUENCE (Sequence ka Logic aur Interview Concept)
  // ============================================================================
  // 1. zstdCompression: Response compress karne ke stream interceptors tayyar karo.
  // 2. requestTimeout: Timeout timer lagao (e.g. 5 sec) taa ke hung requests process choke na karein.
  // 3. accessLog: Request method aur URL note karo.
  // 4. earlyRoutes: Fast /health check ko bina DB check ke seedha return karo.
  // 5. mongoGate: Circuit breaker! Agar DB replica down ho toh foran 503 bhejo (Fail Fast).
  // 6. featureRoutes: Asal business logic run karo (/products, /cart waghera).
  const pipeline: Handler[] = [zstdCompression, requestTimeout, accessLog, earlyRoutes, mongoGate, featureRoutes];

  // ============================================================================
  // MAIN HTTP REQUEST HANDLER
  // ============================================================================
  export const handle = async (req: Request, res: Response): Promise<void> => {
    // Har request par security aur CORS headers attach karo
    securityHeaders(res);
    corsHeaders(res);

    // CORS Preflight request: Browser actual POST/PUT bhejne se pehle OPTIONS bhejta hai.
    // 204 No Content foran return karke browser ko confirm karte hain.
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      // 1. Streaming body ko read aur parse karo (100KB limit guard ke saath)
      await readJsonBody(req);
      // 2. Hamari middleware pipeline run karo
      await runHandlers(pipeline, req, res);
    } catch (err) {
      // Kisi bhi unhandled error ko catch karke uniform 500 error return karo
      errorHandler(err as Parameters<typeof errorHandler>[0], req, res, () => { });
    }
  };

  // ============================================================================
  // SERVER FACTORY (Node.js http.createServer)
  // ============================================================================
  // Pure Node ka createServer instance banata hai.
  // Har request aane par pehle decorate() chalta hai (req/res enrich hoty hain),
  // phir handle() pipeline trigger hoti hai.
  export const createAppServer = (): Server =>
    createServer((incoming, outgoing) => {
      const { req, res } = decorate(incoming, outgoing);
      void handle(req, res);
    });

