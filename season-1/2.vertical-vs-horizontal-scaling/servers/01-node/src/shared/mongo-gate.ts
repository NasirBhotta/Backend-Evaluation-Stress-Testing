// ============================================================================
// DATABASE CIRCUIT BREAKER & TOPOLOGY GATE (Beginner Friendly Guide)
// ============================================================================
//
// 1. CIRCUIT BREAKER PATTERN KYA HOTA HAI?
// Real life example:
// Ghar me bijli ka "fuse" ya "circuit breaker" hota hai. Agar light ka short-circuit
// ho jaye, toh breaker khud ba khud gir jata hai taa ke ghar ke TV, AC na jalein.
//
// Backend me Circuit Breaker:
// Agar MongoDB database crash ho raha ho ya bohot slow ho, toh agar 10,000 users
// ki requests database par jati rahengi, toh server aur database dono hamesha
// ke liye freeze ho jayenge.
// Yeh file ek "Chowkidar (Gate)" hai:
// Jab database beemar hota hai, yeh breaker gira deti hai aur request ko database
// tak jane hi nahi deti. Client ko foran "503 Service Unavailable" bhej deti hai.
//
// 2. MONGODB REPLICA SET KYA HOTA HAI?
// Production me 1 akela database nahi hota, 3 database servers ka group hota hai:
// - PRIMARY (Leader): Sirf yahan naya data write hota hai (POST, PUT, DELETE).
// - SECONDARY (Follower): Yahan se data sirf read hota hai (GET).
// - ELECTION: Agar Primary mar jaye, toh Secondaries aapas me vote kar ke
//   kisi ek ko naya Primary bana lete hain. Is vote ko "Election" kehte hain.
// ============================================================================

import type { Next, Request, Response } from "../http/types.js";
import { env } from "../bootstrap/env.js";
import { getMongoTopology, isMongoShuttingDown } from "../bootstrap/mongo-topology.js";

// Jab server busy ya unavailable ho toh user ko yeh simple message dikhega
const PUBLIC_UNAVAILABLE = "Service is temporarily unavailable. Please try again later.";

// Yeh wo HTTP methods hain jinhe database me data likhna (Write) hota hai.
// Write sirf aur sirf PRIMARY node par ho sakta hai.
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Breaker kab tak khula (tripped) rahega (timestamp in milliseconds)
let circuitOpenUntil = 0;

// Kitni requests fail ho chuki hain
let failCount = 0;

// Failure count karne ka time window kab start hua
let failWindowStart = 0;

// CIRCUIT TRIP KARNA (Breaker Gira Dena):
// Jab lagataar failures aate hain, toh yeh function breaker ko gira deta hai.
// Agle kuch seconds (env.mongoCircuitMs) tak saari requests bahar se hi reject hongi.
const tripMongoCircuit = (): void => {
  circuitOpenUntil = Date.now() + env.mongoCircuitMs;
  failCount = 0;
  failWindowStart = 0;
};

// JAB DATABASE INFRASTRUCTURE FAIL HO:
// Agar database network error de ya connection drop kare, toh yeh function call hota hai.
export const noteMongoInfraFailure = (): void => {
  // Agar abhi election chal rahi hai toh breaker mat girao, kyunki thodi der me naya leader chun liya jayega
  if (getMongoTopology().electionPossible) return;

  const now = Date.now();
  // Agar time window expire ho gaya tha toh naya window start karo
  if (failWindowStart === 0 || now - failWindowStart > env.mongoCircuitMs) {
    failWindowStart = now;
    failCount = 0;
  }

  // Failures count karo
  failCount += 1;

  // Agar failures limit (e.g. 5 fails) se cross ho jayein, toh breaker trip kar do!
  if (failCount >= env.mongoCircuitFails) tripMongoCircuit();
};

// JAB REQUEST KAMYAB HO JAYE:
// Jaise hi database theek se kaam karne lage, purane failure records clear kar do
export const noteMongoSuccess = (): void => {
  failCount = 0;
  failWindowStart = 0;
};

// RETRY-AFTER HEADER:
// Hum user ko batate hain ke kitne seconds baad dobara try kare
const retryAfterSeconds = (): number => {
  const remaining = circuitOpenUntil - Date.now();
  if (remaining > 0) return Math.max(1, Math.ceil(remaining / 1000));
  return Math.max(1, Math.ceil(env.mongoSelectTimeoutMs / 1000));
};

// 503 SERVICE UNAVAILABLE RESPONSE:
// Standard HTTP code jo load balancer aur frontend ko batata hai ke abhi server temporary down hai
export const sendMongoUnavailable = (res: Response): void => {
  res.set("Retry-After", String(retryAfterSeconds()));
  res.status(503).json({ error: PUBLIC_UNAVAILABLE });
};

// ============================================================================
// MAIN GATE MIDDLEWARE: Request Pipeline ka Watchman
// ============================================================================
export const mongoGate = (req: Request, res: Response, next: Next): void => {
  // 1. Agar server graceful shutdown ho raha hai, toh naye logon ko andar mat aane do
  if (isMongoShuttingDown()) {
    sendMongoUnavailable(res);
    return;
  }

  // Database ki current halat pata karo:
  // - reads: Kya kam az kam ek node zinda hai jahan se read kar sakein?
  // - writes: Kya Primary zinda hai jahan write ho sake?
  // - electionPossible: Kya majority nodes zinda hain taa ke naya Primary chun sakein?
  const { reads, writes, electionPossible } = getMongoTopology();
  const needsWrite = WRITE_METHODS.has(req.method);
  const waitingForPrimary = needsWrite && !writes && electionPossible;

  // 2. READ FAIL-SAFE:
  // Agar koi bhi node zinda nahi hai (GET request bhi nahi chal sakti), toh foran 503 do
  if (!reads) {
    sendMongoUnavailable(res);
    return;
  }

  // 3. WRITE FAIL-FAST (INTERVIEW FAVORITE):
  // Agar request POST/PUT hai (Write karna hai), Primary bhi mar chuka hai,
  // AUR naya election bhi possible nahi hai (matlab 3 me se 2 nodes dead hain),
  // toh wait karne ka koi faida nahi hai. Seedha 503 return karo.
  if (needsWrite && !writes && !electionPossible) {
    sendMongoUnavailable(res);
    return;
  }

  // 4. CIRCUIT OPEN CHECK:
  // Agar breaker abhi bhi gira hua (Open) hai, toh request ko roko.
  // Lekin agar naya primary elect ho raha ho, toh thoda wait karne do taa ke election ke baad chal jaye.
  if (Date.now() < circuitOpenUntil && !waitingForPrimary) {
    sendMongoUnavailable(res);
    return;
  }

  // 5. SUCCESS TRACKER:
  // Jab request successfully complete ho jaye (status code < 500), toh failure count reset karo
  res.on("finish", () => {
    if (res.statusCode < 500) noteMongoSuccess();
  });

  // Sab theek hai! Gate khol do aur request ko agle middleware / controller par jane do
  next();
};

