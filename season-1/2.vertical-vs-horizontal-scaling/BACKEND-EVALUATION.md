# Backend Evaluation and Stress Testing

## Project summary

I built a backend evaluation setup to compare different backend implementations under normal traffic, sustained load, and increasing stress. The work covers API implementation, vertical scaling, compression, load generation, reverse proxy configuration, and performance reporting.

The repository contains the implementation and test scenarios described below. Configured traffic targets are not proof that a backend sustained that traffic. Measured performance must come from an individual test result.

## What I built

| Area | Work completed in this repository |
|---|---|
| Backend implementations | Created separate backends using raw Node.js HTTP, Express, Fastify, NestJS with Fastify, and Go with Fiber. |
| API features | Implemented ecommerce features across the Node-based backends, including products, users, authentication, cart, and wishlist. |
| Database integration | Added MongoDB integration, Mongoose models in the Node-based backends, and Docker-based MongoDB replica-set configuration. |
| Authentication | Added JWT access and refresh token configuration in the Node-based backends. |
| Pagination | Added product-list pagination and fixed list limits for benchmark requests. |
| Vertical scaling | Added Node cluster worker configuration through `WORKERS` to evaluate different worker counts on one machine. |
| Compression | Added evaluation paths for uncompressed responses, gzip, Brotli, and Zstandard. |
| Load testing | Built a k6 benchmark using a fixed request arrival rate. |
| Stress testing | Created 16 k6 scenarios with increasing virtual-user targets. |
| Test selection | Built an interactive CLI to select a stress scenario and an available backend. |
| Readiness detection | Added probes for `/health` and the product-list endpoint before selecting a live server. |
| Reverse proxy | Configured Nginx routing to each backend through a dedicated path prefix. |
| Proxy optimization | Added Nginx gzip/Brotli compression, upstream keepalive connections, response caching, cache locking, and stale-response handling. |
| Reporting | Added benchmark tables, JSON summary export, and saved Markdown compression reports. |

## Backend comparison coverage

| Backend | Folder | Coverage visible in the repository |
|---|---|---|
| Raw Node.js HTTP | `servers/01-node/` | API implementation, cluster workers, compression benchmark, saved reports. |
| Express | `servers/02-express/` | API implementation, cluster workers, compression benchmark, saved reports. |
| Fastify | `servers/03-fastify/` | API implementation, cluster workers, compression benchmark, saved reports. |
| NestJS with Fastify | `servers/04-nestjs/` | API implementation, build/test configuration, compression benchmark script. |
| Go with Fiber | `servers/05-go/` | API implementation and inclusion in the v2 stress-test picker. |

The v2 picker currently includes raw Node.js, Express, Fastify, and Go. NestJS exists in the repository and Nginx configuration, but is excluded from that picker.

## How I evaluated the backends

### 1. Fixed request-rate benchmarking

The benchmark in `bench/k6/load.js` uses k6's `constant-arrival-rate` executor. It schedules a configured number of iterations per second rather than specifying a fixed number of concurrent users.

- Configurable request rate, duration, target URL, and response encoding.
- One HTTP GET per iteration against a fixed product-list URL.
- HTTP 200 response checks.
- Eight-second request timeout and ten-second graceful stop.
- Preallocated virtual users capped at 200 and maximum virtual users capped at 800.
- Default benchmark URL in the CLI: `/products?page=1&limit=20`.
- Separate comparison runs for identity, gzip, Brotli, and Zstandard.
- Compression level 1 is the shared benchmark contract.

The CLI supports selecting backends, worker counts, compression modes, and rebuilding or using an existing build. Its lifecycle code starts and stops servers sequentially.

### 2. Normal-load and stress testing

I added progressively heavier k6 tests to observe response latency and request failures as concurrency increases.

The normal-load scenario ramps to 20 users, holds that load, ramps to 100 users, holds again, and ramps down. It includes a one-second pause between iterations and checks HTTP 200 and response time below 500 ms.

The higher breakpoint scenarios use repeated product-list requests with increasing virtual-user stages. For example, the fast 10,000-user scenario moves through 3,000, 5,000, 7,500, and 10,000 users before ramping down, with five seconds per stage.

| Scenario | Peak configured virtual users | Total stage duration from code |
|---|---:|---:|
| Normal load | 100 | 120 seconds |
| Stress | 600 | 200 seconds |
| Breakpoint | 1,000 | 60 seconds |
| Breakpoint | 3,000 | 110 seconds |
| Breakpoint | 5,000 | 60 seconds |
| Breakpoint | 10,000 | 90 seconds |
| Fast breakpoint | 10,000 | 25 seconds |
| Breakpoint | 9,000 | 110 seconds |
| Breakpoint | 20,000 | 90 seconds |
| Breakpoint | 40,000 | 90 seconds |
| Breakpoint | 50,000 | 90 seconds |
| Breakpoint | 100,000 | 90 seconds |
| Breakpoint | 150,000 | 90 seconds |
| Breakpoint | 200,000 | 90 seconds |
| Breakpoint | 500,000 | 90 seconds |
| Breakpoint | 1,000,000 | 90 seconds |

These durations are the sums of configured stages. Some filenames and picker labels use rounded or outdated durations. Setup time and graceful completion can increase total runtime.

The normal-load thresholds require less than 1% HTTP request failures and p95 latency below 500 ms. The inspected high-load breakpoint scenarios allow less than 5% failures and p95 below 1,000 ms. Threshold failure marks the test as failed; it does not establish the exact point where the backend reached its capacity.

### 3. Direct backend and Nginx evaluation

The v2 picker detects available direct backends and Nginx routes. It runs against `/products?limit=10` and lets the user select identity, gzip, or Brotli for an Nginx target.

| Nginx route | Backend port |
|---|---:|
| `/node/` | 5001 |
| `/express/` | 5002 |
| `/fastify/` | 5003 |
| `/nestjs/` | 5004 |
| `/go/` | 5005 |

Nginx listens on port 8080 and strips the backend prefix before forwarding requests. Its configuration includes compression level 1, a 1,024-byte compression threshold, and a 15-second cache for successful responses. `X-Cache-Status` exposes cache status.

Direct tests measure the backend request path. Nginx tests measure the proxy, compression, caching, and backend together. Repeated requests to the same URL can become cache hits, so cached throughput must be reported separately from direct backend throughput.

## Metrics I collected

| Metric | Purpose |
|---|---|
| Achieved requests per second | Compare completed HTTP request throughput against the offered load. |
| Response data per second | Compare response traffic across compression choices. The k6 report uses client `data_received` as server output. |
| Server CPU | Observe CPU cost of the backend processes and cluster workers, separately from k6. |
| p95 latency | Observe response time for the slower portion of requests. |
| Pass and fail counts | Track successful responses and failed requests. |
| Failure rate | Check whether a test meets its reliability threshold. |
| Compression ratio | Compare compressed response traffic with identity responses in the saved compression reports. |
| p50 and p99 latency | Capture typical and tail latency in the saved compression reports. |

The k6 summary derives pass/fail totals from `http_req_failed`; the script also records a separate HTTP 200 check. The saved custom compression reports define pass explicitly as HTTP 200. These definitions should be aligned before comparing results from the two tools.

The benchmark winner rule selects rows with a failure rate below 1%, then prefers the highest achieved request rate. If request rates tie, it prefers the lower p95 latency.

## Saved measurement example

The following is one saved compression report, not a ranking of all backend frameworks.

Source: `servers/01-node/scripts/bench/results/01-2026-09-24T14-27-10.md`.

- Target: `http://localhost:4500/products?limit=50`.
- Requests: 40,000 per encoding, concurrency 200, warmup 1,000 requests excluded.
- Compression level: 6, which differs from the shared level-1 benchmark contract.
- All four modes recorded 40,000 passes and zero failures.

| Encoding | Reported req/s | Server socket output | Average process CPU | p99 |
|---|---:|---:|---:|---:|
| Identity | 1,935 | 663.87 MB | 124.5% | 168.2 ms |
| Gzip | 1,682 | 103.00 MB | 143.5% | 187.4 ms |
| Brotli | 2,029 | 93.27 MB | 171.5% | 146.9 ms |
| Zstandard | 2,004 | 100.94 MB | 182.4% | 137.9 ms |

In this run, Brotli recorded the highest throughput and lowest socket output. Zstandard recorded the lowest p99. Identity used the least average process CPU. This illustrates the tradeoff between bandwidth, CPU, throughput, and latency for this specific run.

CPU is summed process utilization and can exceed 100% across multiple cores or workers. The report states that socket output and latency are pass-only, while CPU includes failed requests too.

## What this work demonstrates

- Implementing comparable backend examples across several frameworks and languages.
- Designing repeatable HTTP load tests with k6.
- Separating offered request rate from virtual-user concurrency.
- Evaluating vertical scaling through configurable worker counts.
- Exploring capacity limits with progressively heavier traffic scenarios.
- Comparing compression cost against bandwidth savings and latency.
- Evaluating a reverse proxy with caching and compression.
- Recording performance evidence rather than relying only on framework claims.

## Interpretation and reproducibility notes

- A one-million-user scenario is a configured k6 target, not evidence of one million successful concurrent users or requests per second.
- High virtual-user targets can exhaust the load-generator machine before the backend reaches its limit. Record client CPU, memory, connection limits, and k6 warnings alongside server metrics.
- Compare runs with the same hardware, database contents, endpoint, list limit, worker count, compression level, and cache state.
- Record dropped iterations for fixed arrival-rate tests to show when the requested rate could not be generated.
- The shared API rule describes `/items`, while current benchmark code targets `/products`; the documentation and contract need reconciliation.
- Nginx evaluation exists in the code, but the shared phase-1 rule currently limits work to vertical testing without Nginx.
- CPU sampling uses Unix `ps`, and some startup scripts use Unix shell syntax. Windows execution needs a compatible environment or script adjustments.
- A complete cross-backend ranking requires separately verified reports for every backend under the same test conditions.

## Short description for sharing

I built a backend evaluation setup using Node.js, Express, Fastify, NestJS, and Go. I created k6 load and stress scenarios, added configurable Node cluster workers, compared response compression methods, and configured Nginx for proxy and cache evaluation. The setup measures throughput, latency, failures, response traffic, and server CPU, with saved reports to support performance analysis.
