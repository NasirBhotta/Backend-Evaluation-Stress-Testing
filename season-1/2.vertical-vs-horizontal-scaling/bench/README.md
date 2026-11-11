# Bench

Vertical load test for the four servers. One server runs at a time.

```bash
pnpm install
pnpm bench
# or, to skip the question and always use the existing dist:
pnpm bench --skip-build
```

`pnpm bench` takes ~700ms to show the first question, since pnpm spawns a shell that spawns node. For a faster start (~200ms), run the entry file directly from this folder:

```bash
node src/cli.js
# or
node src/cli.js --skip-build
```

k6 must be on your PATH (`brew install k6`).

The CLI asks for scaling, servers, processes, req/s, duration, compression, and build mode. Phase 1 runs vertical only. Each server needs a `pnpm dev` script. The bench sets `WORKERS` and leaves `PORT` alone, so each server listens on the port in its `.env`. Every server forks that many cluster workers. CPU is the sum of those `node dist/server.js` or `node dist/main.js` processes.

- Servers: pick `all` or specific ones. Only that subset runs.
- Build: `rebuild` runs `pnpm dev` (tsup/tsc watch, rebuilds first). `skip build` runs the entry file already in `dist/` directly, no rebuild, so it starts faster. Run `pnpm build` in a server's folder first if `dist/` is missing or stale.

It calls `GET /products?page=1&limit=20` and sends `Accept-Encoding` of `identity`, `gzip`, `br`, or `zstd`.

JSON summaries land in `results/`.
