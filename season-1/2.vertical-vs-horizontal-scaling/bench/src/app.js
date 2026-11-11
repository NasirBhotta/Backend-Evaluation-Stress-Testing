import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import * as p from '@clack/prompts'
import { ask, itemLimit } from './ask.js'
import {
  encodings,
  killAllTracked,
  listServers,
  readServerPort,
  readSummary,
  resultsDir,
  runK6,
  stopServer,
  trackChild,
  waitForReady,
  watchCpu,
} from './measure.js'

// Ctrl+C or an external kill on the CLI itself must not leave a server (or
// k6) running and holding the port for the next run.
let shuttingDown = false
const shutdown = async (signal) => {
  if (shuttingDown) {
    process.exit(1)
    return
  }
  shuttingDown = true
  console.error(`\nReceived ${signal}, stopping any running server/k6 process...`)
  try {
    await killAllTracked()
  } finally {
    process.exit(1)
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

const formatNum = (value, digits) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return value.toFixed(digits)
}

const printTable = (serverName, rows) => {
  const header = ['Compression', 'Req/s', 'Data out', 'CPU', 'p95', 'Pass', 'Fail']
  const body = rows.map((row) => [
    row.compression,
    formatNum(row.reqPerSec, 1),
    `${formatNum(row.dataOut, 2)} MB/s`,
    row.cpu === null ? '-' : `${formatNum(row.cpu, 1)}%`,
    `${formatNum(row.p95, 1)} ms`,
    String(row.pass),
    String(row.fail),
  ])
  const widths = header.map((label, index) => Math.max(label.length, ...body.map((line) => line[index].length)))
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ')
  const text = [line(header), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)].join('\n')
  p.note(text, serverName)
}

const printWinner = (rows) => {
  const eligible = rows.filter((row) => row.failRate < 0.01)
  if (eligible.length === 0) {
    p.note('No row stayed under 1% fail.', 'Winner')
    return
  }
  const winner = eligible.toSorted((a, b) => {
    if (b.reqPerSec !== a.reqPerSec) return b.reqPerSec - a.reqPerSec
    return a.p95 - b.p95
  })[0]
  p.note(
    `${winner.server} / ${winner.compression}  ${formatNum(winner.reqPerSec, 1)} req/s  p95 ${formatNum(winner.p95, 1)} ms`,
    'Winner',
  )
}

const readyMs = 30_000
const secondsSince = (since) => ((Date.now() - since) / 1000).toFixed(1)

// Ticks a spinner's message every 500ms so a long-running step shows a live
// elapsed counter instead of sitting silent (which reads as a hang).
const tickSpinner = (spin, label, since) =>
  setInterval(() => spin.message(`${label} (${secondsSince(since)}s)`), 2000)

// Keeps a bounded tail of a child process's output, hidden during normal
// runs and surfaced only if that step fails.
const captureTail = (child, limit = 4000) => {
  let buf = ''
  const push = (chunk) => {
    buf += chunk.toString()
    if (buf.length > limit) buf = buf.slice(-limit)
  }
  child.stdout?.on('data', push)
  child.stderr?.on('data', push)
  return () => buf
}

const startServer = async (server, config, port) => {
  const env = { ...process.env, WORKERS: String(config.workers) }
  delete env.PORT

  const command = config.skipBuild
    ? { cmd: 'node', args: [server.entry], label: `${server.name} connecting (dist as-is)` }
    : { cmd: 'pnpm', args: ['dev'], label: `${server.name} building and connecting` }

  if (config.skipBuild && (!server.entry || !existsSync(path.join(server.dir, server.entry)))) {
    p.log.warn(`${server.name} has no built dist (${server.entry ?? 'unknown entry'}). Run pnpm build there first. Skipped.`)
    return null
  }

  const child = spawn(command.cmd, command.args, {
    cwd: server.dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tail = captureTail(child)
  const base = `http://127.0.0.1:${port}`

  const spin = p.spinner()
  const since = Date.now()
  const label = command.label
  spin.start(label)
  const ticker = tickSpinner(spin, label, since)

  try {
    try {
      await waitForReady(`${base}/health`, child, readyMs)
    } catch {
      await waitForReady(`${base}/products?page=1&limit=1`, child, readyMs)
    }
  } catch (err) {
    clearInterval(ticker)
    spin.stop(`${server.name} did not become ready`, 1)
    p.log.error(tail() || '(no output captured)')
    await stopServer(child)
    throw err
  }

  clearInterval(ticker)
  spin.stop(`${server.name} ready in ${secondsSince(since)}s`)
  return { child, base }
}

// How long past the target duration we let k6 sit before treating it as
// hung and killing it (see runK6's timeoutMs). k6's own metrics can finish
// on time while the process itself lingers under system load - this bounds
// that dead time instead of waiting on it indefinitely.
const k6ExitGraceMs = 45_000

// Compression costs real CPU per request. Hitting gzip/brotli/zstd with the
// same raw rate as the uncompressed baseline can overload this machine
// (backlogged VUs, k6 never gets to exit within k6ExitGraceMs). Cap only
// the compressed variants so the off/identity baseline still measures the
// rate you asked for, but compression doesn't get pushed past what this
// box can actually sustain.
const compressedRateCap = 3000

const runCompression = async (server, config, base, childPid, compression) => {
  const rate = compression === 'off' ? config.rate : Math.min(config.rate, compressedRateCap)
  const capped = rate !== config.rate
  const summaryPath = path.join(resultsDir, `${server.name}-${compression}-${Date.now()}.json`)
  const finishCpu = watchCpu(childPid)

  const spin = p.spinner()
  const since = Date.now()
  const label = `${server.name} ${compression} load test${capped ? ` (rate capped ${rate}/s)` : ''}`
  const targetMs = config.seconds * 1000
  spin.start(label)
  // Past the target duration, k6 is just draining/exiting, not generating
  // load - say so, instead of showing the same "Ns target" message forever.
  const ticker = setInterval(() => {
    const elapsedMs = Date.now() - since
    const elapsed = secondsSince(since)
    spin.message(elapsedMs > targetMs
      ? `${label} done, waiting for k6 to exit (cleanup, ${elapsed}s)`
      : `${label} / ${config.seconds}s target (${elapsed}s)`)
  }, 2000)

  let result
  try {
    result = await runK6(summaryPath, {
      RATE: String(rate),
      DURATION: `${config.seconds}s`,
      URL: `${base}/products?page=1&limit=${itemLimit}`,
      ENCODING: encodings[compression],
    }, targetMs + k6ExitGraceMs)
  } catch (err) {
    clearInterval(ticker)
    finishCpu()
    spin.stop(`${server.name} ${compression} load test failed`, 1)
    p.log.error(err.message)
    throw err
  }

  clearInterval(ticker)
  spin.stop(result.timedOut
    ? `${server.name} ${compression} load test done, k6 hung after finishing and was killed (system load) - results below are still valid`
    : `${server.name} ${compression} load test done in ${secondsSince(since)}s`)
  return readSummary(summaryPath, finishCpu())
}

const runOne = async (server, config) => {
  if (!server.dev) {
    p.log.warn(`${server.name} has no dev script. Skipped.`)
    return []
  }

  const port = await readServerPort(server.dir)
  const started = await startServer(server, config, port)
  if (!started) return []
  const { child, base } = started
  const untrack = trackChild(child)
  const rows = []

  try {
    for (const compression of config.compression) {
      try {
        const row = await runCompression(server, config, base, child.pid, compression)
        rows.push({ ...row, server: server.name, compression })
      } catch (err) {
        // One codec failing (or hanging past its timeout) shouldn't sink the
        // rest of the run - skip its row and move on to the next codec.
        p.log.warn(`${server.name} ${compression} skipped after failure: ${err.message.split('\n')[0]}`)
      }
    }
  } finally {
    const spin = p.spinner()
    spin.start(`${server.name} stopping`)
    await stopServer(child)
    untrack()
    spin.stop(`${server.name} stopped`)
  }

  printTable(server.name, rows)
  return rows
}

const config = await ask()
await mkdir(resultsDir, { recursive: true })

const servers = (await listServers()).filter((server) => config.servers.includes(server.name))

const rows = []
for (const server of servers) {
  rows.push(...await runOne(server, config))
}

printWinner(rows)
p.outro('Done.')
