import http from "k6/http"
import { SERVERS } from "./servers.js"

// Set by pick-server.js for nginx runs. Unset means k6 keeps its own default header.
export const reqParams = __ENV.ENCODING
  ? { headers: { "Accept-Encoding": __ENV.ENCODING } }
  : {}

// Runs once in setup(), before the load stages start - the only place a k6
// test file is allowed to make an HTTP call outside the default function.
export function pickUrl() {
  if (__ENV.URL) return __ENV.URL

  for (const server of SERVERS) {
    const base = `http://127.0.0.1:${server.port}`
    for (const path of ["/health", "/products?page=1&limit=1"]) {
      const res = http.get(`${base}${path}`, { timeout: "1s" })
      if (res.status === 200) return `${base}/products?limit=10`
    }
  }

  throw new Error("No server is running. Start one (pnpm dev in its folder) and try again.")
}
