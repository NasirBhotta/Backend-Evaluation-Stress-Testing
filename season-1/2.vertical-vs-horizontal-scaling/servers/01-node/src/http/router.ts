// ============================================================================
// CUSTOM ROUTER & MIDDLEWARE PIPELINE (Pure Node.js - Zero Framework Overhead)
// ============================================================================
// YEH FILE KYUN BANAYI GYI?
// Node.js ka built-in 'node:http' module bohot low-level hota hai. Isme na URL
// params hoty hain (jaise /products/:id), na JSON body parsing hoti hai, aur na
// Express jaisa next() middleware pipeline hota hai.
//
// Humne Express ya Fastify use karne ke bajaye yeh custom router isliye banaya
// taa ke framework ka extra overhead hat sake aur hum Node.js ki actual maximum
// speed aur memory efficiency benchmark kar sakein.
// ============================================================================

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Handler, Next, Query, Request, Response } from "./types.js"

// SECURITY / DOS PROTECTION:
// Har incoming POST/PUT request ki body size limit 100 KB rakhi hai.
// Real world reason: Agar limit na ho toh koi attacker 1GB ka payload bhej kar
// server ki poori RAM crash kar dega (Denial of Service - OOM crash).
const BODY_LIMIT = 100 * 1024

type Route = {
  method: string
  path: string
  handlers: Handler[]
}

// QUERY PARSER:
// URL me jo '?page=1&limit=20' ata hai, usko clean JavaScript object me convert karta hai.
// Agar same key multiple times aye (jaise ?tag=tech&tag=node) toh usko array bana deta hai.
const parseQuery = (url: URL): Query => {
  const query: Query = {}
  for (const [key, value] of url.searchParams) {
    const prev = query[key]
    if (prev === undefined) query[key] = value
    else if (Array.isArray(prev)) prev.push(value)
    else query[key] = [prev, value]
  }
  return query
}

// ============================================================================
// DECORATOR PATTERN: req aur res ko powerful banana
// ============================================================================
// Node ke default req/res streams bohot basic hoty hain.
// Yeh function unpar helper methods attach karta hai taa ke developer ko
// Express jaisa maza mile lekin bina Express ke heavy memory weight ke.
export const decorate = (incoming: IncomingMessage, outgoing: ServerResponse): { req: Request; res: Response } => {
  const url = new URL(incoming.url ?? "/", "http://127.0.0.1")
  const req = incoming as Request

  // Request par convenient properties attach kar rahe hain
  req.method = incoming.method ?? "GET"
  req.path = url.pathname
  req.originalUrl = incoming.url ?? "/"
  req.query = parseQuery(url)
  req.params = {}
  req.body = undefined

  // Header ko case-insensitive read karne ke liye helper function
  req.get = (name) => {
    const value = incoming.headers[name.toLowerCase()]
    if (Array.isArray(value)) return value.join(", ")
    return value
  }

  const res = outgoing as Response

  // Method chaining ke liye: res.status(200).json(...)
  res.status = (code) => {
    res.statusCode = code
    return res
  }

  // Pure Node me JSON bhejna mushkil hota hai.
  // Yeh helper headers set karta hai aur JavaScript object ko stringify karke bhejta hai.
  res.json = (body) => {
    if (res.headersSent) return res
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.end(JSON.stringify(body))
    return res
  }

  // Custom response header set karne ke liye
  res.set = (name, value) => {
    res.setHeader(name, value)
    return res
  }

  return { req, res }
}

// ============================================================================
// BODY PARSER (STREAMING + CHUNKING)
// ============================================================================
// Node.js me request body ek Stream hoti hai, matlab data tukdon (chunks) me ata hai.
// Yeh function chunks ko jama karta hai aur JSON me parse karta hai.
export const readJsonBody = async (req: Request): Promise<void> => {
  // GET aur HEAD requests me koi body nahi hoti, isliye foran return ho jao.
  if (req.method === "GET" || req.method === "HEAD") return

  const type = req.headers["content-type"]
  if (typeof type !== "string" || !type.includes("application/json")) return

  const chunks: Buffer[] = []
  let size = 0

  // Asynchronous streaming loop: Chunks receive ho rahe hain
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length

    // Agar payload 100KB se bara ho jaye toh foran connection drop karo (Fail Fast)
    if (size > BODY_LIMIT) {
      throw Object.assign(new Error("Payload too large"), { status: 413 })
    }
    chunks.push(buf)
  }

  if (size === 0) return

  try {
    // Saare chunks ko ek saath jor kar string aur phir JSON object banana
    req.body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    // Malformed JSON ke liye 400 Bad Request return karna
    throw Object.assign(new Error("Invalid JSON"), { status: 400 })
  }
}

// ============================================================================
// DYNAMIC ROUTE MATCHER (Regex-Free for High Performance)
// ============================================================================
// Express me route matching ke liye heavy Regex use hoti hai jo CPU khata hai.
// Yahan simple array split aur token comparison use kiya gaya hai.
// Example: pattern = '/products/:id', pathname = '/products/456'
// Result: params = { id: '456' }
const matchPath = (pattern: string, pathname: string): Record<string, string> | null => {
  const expected = pattern.split("/").filter(Boolean)
  const actual = pathname.split("/").filter(Boolean)

  // Segment count match hona zaroori hai (e.g. 2 segments vs 2 segments)
  if (expected.length !== actual.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < expected.length; i += 1) {
    const token = expected[i]
    // Agar token ':' se start hota hai toh yeh dynamic variable hai
    if (token.startsWith(":")) params[token.slice(1)] = decodeURIComponent(actual[i])
    else if (token !== actual[i]) return null
  }
  return params
}

// URL prefixes ko safely join karne ke liye helper (trailing/leading slashes clean karta hai)
export const joinPath = (prefix: string, path: string): string => {
  const left = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix
  if (path === "/") return left || "/"
  return `${left}${path.startsWith("/") ? path : `/${path}`}`
}

// ============================================================================
// ROUTER FACTORY
// ============================================================================
// Express router ki tarah get(), post(), use() methods provide karta hai
export const createRouter = () => {
  const routes: Route[] = []
  let pending: Handler[] = []

  const add = (method: string, path: string, handlers: Handler[]) => {
    // Route-level middleware (pending) ko route handlers ke saath merge karna
    routes.push({ method, path, handlers: [...pending, ...handlers] })
  }

  return {
    routes,
    // Sub-router level middleware add karne ke liye
    use(handler: Handler) {
      pending = [...pending, handler]
    },
    get(path: string, ...handlers: Handler[]) {
      add("GET", path, handlers)
    },
    post(path: string, ...handlers: Handler[]) {
      add("POST", path, handlers)
    },
    put(path: string, ...handlers: Handler[]) {
      add("PUT", path, handlers)
    },
    patch(path: string, ...handlers: Handler[]) {
      add("PATCH", path, handlers)
    },
    delete(path: string, ...handlers: Handler[]) {
      add("DELETE", path, handlers)
    },
  }
}

export type Router = ReturnType<typeof createRouter>

// Sub-routers ko main app ke path par mount karna (jaise /products ke under saari product routes)
export const mountRoutes = (prefix: string, router: Router): Route[] =>
  router.routes.map((route) => ({ ...route, path: joinPath(prefix, route.path) }))

// Incoming HTTP request ke Method aur Path ke hisab se matching route dhoondna
export const findRoute = (routes: Route[], method: string, pathname: string) => {
  for (const route of routes) {
    if (route.method !== method) continue
    const params = matchPath(route.path, pathname)
    if (params) return { route, params }
  }
  return null
}

// ============================================================================
// MIDDLEWARE PIPELINE RUNNER (Chain of Responsibility Pattern)
// ============================================================================
// INTERVIEW KEY POINT:
// Express ka mashhoor 'next()' flow yahan scratch se implement kiya gaya hai.
// Handlers ki array sequential order me execute hoti hai.
// Jab ek handler next() call karta hai, tabhi agla handler start hota hai.
// Agar koi error aye toh baqi saare handlers skip ho jate hain aur seedha reject hota hai.
export const runHandlers = (handlers: Handler[], req: Request, res: Response) =>
  new Promise<void>((resolve, reject) => {
    let index = 0
    let settled = false

    // Pipeline finish hone par call hota hai
    const finish = (err?: unknown) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve()
    }

    // next() function jo har handler ko pass hota hai
    const next: Next = (err?: unknown) => {
      if (settled) return
      if (err) {
        finish(err) // Error aya toh aage mat jao, seedha terminate karo
        return
      }

      const handler = handlers[index]
      index += 1

      // Saare handlers khatam ho gaye
      if (!handler) {
        finish()
        return
      }

      let called = false
      // Local safety guard: ek hi handler baar baar next() na call kar sake
      const localNext: Next = (error) => {
        if (called) return
        called = true
        next(error)
      }

      try {
        const result = handler(req, res, localNext)
        // Async handlers (Promises) ko handle karne ke liye
        Promise.resolve(result).then(
          () => {
            if (!called) finish()
          },
          (error) => finish(error),
        )
      } catch (error) {
        finish(error)
      }
    }

    // Pehle handler se execution shuru karo
    next()
  })

