import http from 'k6/http'
import { check } from 'k6'

const rate = Number(__ENV.RATE || 100)
const duration = __ENV.DURATION || '30s'
const url = __ENV.URL
const encoding = __ENV.ENCODING || 'identity'
const preAllocatedVUs = Math.min(Math.max(rate, 20), 200)
// Capped regardless of rate. Without this, a rate the server can't keep up
// with (slow responses pile up) makes k6 keep opening new VUs, and each one
// holds its own connection and buffers in RAM until it runs into swap.
// Observed vus_max never exceeded ~525 even at rate=5000 against a server
// that couldn't keep up, so 800 leaves headroom without over-allocating.
const maxVUs = Math.min(Math.max(rate * 2, 100), 800)

export const options = {
  scenarios: {
    bench: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1s',
      duration,
      preAllocatedVUs,
      maxVUs,
      // Default is 30s: after `duration` ends, k6 waits this long for
      // in-flight iterations to finish before it can exit and write the
      // summary. Under a rate the server can't sustain (e.g. compression
      // at high req/s), iterations back up and can legitimately need
      // most of that 30s - which raced with our own kill-timeout in
      // app.js and killed k6 before it wrote anything. 10s is enough for
      // one in-flight request to hit its own 8s timeout below and still
      // leaves headroom under that outer kill-timeout.
      gracefulStop: '10s',
    },
  },
  summaryTrendStats: ['avg', 'p(95)'],
}

export default () => {
  // Short timeout so a stuck VU frees its memory quickly instead of piling up
  // when the target rate is above what the server can actually sustain.
  const res = http.get(url, {
    headers: { 'Accept-Encoding': encoding },
    timeout: '8s',
  })
  check(res, { 'status 200': (r) => r.status === 200 })
}
