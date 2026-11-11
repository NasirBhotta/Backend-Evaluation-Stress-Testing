import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const benchDir = path.resolve(import.meta.dirname, '..')
const serversDir = path.resolve(benchDir, '../servers')

export const resultsDir = path.join(benchDir, 'results')
export const encodings = {
  off: 'identity',
  gzip: 'gzip',
  brotli: 'br',
  zstd: 'zstd',
}

export const listServers = async () => {
  const entries = await readdir(serversDir, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .toSorted()

  return Promise.all(names.map(async (name) => {
    const dir = path.join(serversDir, name)
    try {
      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
      const dev = pkg.scripts?.dev ?? null
      // Pulled from the dev script's own onSuccess command, so --skip-build
      // runs the exact same entry file the watch mode would have built.
      const entry = dev?.match(/node (dist\/[\w./-]+\.js)/)?.[1] ?? null
      return { name, dir, dev, entry }
    } catch {
      return { name, dir, dev: null, entry: null }
    }
  }))
}

const portInFile = async (file) => {
  try {
    const text = await readFile(file, 'utf8')
    const match = text.match(/^PORT=(\d+)\s*$/m)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

const portDefault = async (dir) => {
  try {
    const text = await readFile(path.join(dir, 'src/bootstrap/env.ts'), 'utf8')
    const match = text.match(/PORT:\s*z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.default\((\d+)\)/)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

// Same file the server loads: .env.test when NODE_ENV=test, otherwise .env.
// Nest has no .env, so the code default is the listen port.
export const readServerPort = async (dir) => {
  const fileName = process.env.NODE_ENV === 'test' ? '.env.test' : '.env'
  const fromFile = await portInFile(path.join(dir, fileName))
  if (fromFile) return fromFile
  const fallback = await portDefault(dir)
  if (fallback) return fallback
  throw new Error(`No PORT for ${dir}`)
}

export const waitForReady = async (url, child, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited before it was ready')
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      // still starting
    }
    await sleep(300)
  }
  throw new Error('server did not open /health or /products in time')
}

const childPids = (pid) => {
  try {
    const out = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
    return out.split('\n').map((line) => Number(line.trim())).filter((n) => n > 0)
  } catch {
    return []
  }
}

const treePids = (pid) => childPids(pid).flatMap((child) => [...treePids(child), child])

const commandOf = (pid) => {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const isServerProcess = (cmd) => {
  const parts = cmd.trim().split(/\s+/)
  const bin = parts[0] ?? ''
  const isNode = bin === 'node' || bin.endsWith('/node')
  if (!isNode) return false
  return parts.some((part) => part.endsWith('dist/server.js') || part.endsWith('dist/main.js'))
}

const serverPids = (rootPid) => [rootPid, ...treePids(rootPid)].filter((pid) => isServerProcess(commandOf(pid)))

const sampleOne = (pid) => {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'pcpu='], { encoding: 'utf8' })
    const value = Number(out.trim())
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

const sampleCpu = (pids) => {
  const values = pids.map(sampleOne).filter((n) => n !== null)
  if (values.length === 0) return null
  return values.reduce((sum, n) => sum + n, 0)
}

export const watchCpu = (rootPid) => {
  const samples = []
  const controller = new AbortController()

  const loop = async () => {
    while (!controller.signal.aborted) {
      const value = sampleCpu(serverPids(rootPid))
      if (controller.signal.aborted) return
      if (value !== null) samples.push(value)
      await sleep(500, null, { signal: controller.signal }).catch(() => {})
    }
  }

  loop()

  return () => {
    controller.abort()
    if (samples.length === 0) return null
    return samples.reduce((sum, value) => sum + value, 0) / samples.length
  }
}

// k6 v2.3.0's --summary-export JSON is flat: metrics.http_reqs.rate, not
// metrics.http_reqs.values.rate. Captured instead of inherited so the CLI can
// show a clean spinner and only print this on failure.
//
// k6's own metrics can look healthy (test finished inside the target
// duration) while the k6 OS process itself still takes a long time to exit
// (seen on this machine under memory pressure: metrics said ~6s, the process
// took 200+s to exit). timeoutMs bounds that dead time: past it, we kill the
// process instead of waiting indefinitely. If a summary was already written
// before the hang, we still return it - the test data is valid even though
// the process lingered.
export const runK6 = async (summaryPath, env, timeoutMs) => {
  const child = spawn('k6', [
    'run',
    '--quiet',
    '--no-color',
    '--summary-export',
    summaryPath,
    path.join(benchDir, 'k6/load.js'),
  ], {
    cwd: benchDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let tail = ''
  const capture = (chunk) => {
    tail += chunk.toString()
    if (tail.length > 4000) tail = tail.slice(-4000)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const untrack = trackChild(child)
  try {
    const exited = once(child, 'exit')
    const timedOut = timeoutMs
      ? await Promise.race([exited.then(() => false), sleep(timeoutMs).then(() => true)])
      : false
    if (timedOut) {
      await killProcessTree(child)
      if (!existsSync(summaryPath)) {
        throw new Error(`k6 did not finish within ${Math.round(timeoutMs / 1000)}s and left no summary\n${tail}`)
      }
      return { timedOut: true }
    }
    const [code] = await exited
    if (code !== 0) throw new Error(`k6 exited ${code}\n${tail}`)
    return { timedOut: false }
  } finally {
    untrack()
  }
}

export const readSummary = async (summaryPath, cpu) => {
  const { metrics = {} } = JSON.parse(await readFile(summaryPath, 'utf8'))
  const total = metrics.http_reqs?.count ?? 0
  const failRate = metrics.http_req_failed?.value ?? 0
  const fail = Math.round(total * failRate)
  return {
    reqPerSec: metrics.http_reqs?.rate ?? 0,
    dataOut: (metrics.data_received?.rate ?? 0) / (1024 * 1024),
    cpu,
    p95: metrics.http_req_duration?.['p(95)'] ?? 0,
    pass: total - fail,
    fail,
    failRate,
  }
}

const signalPid = (pid, signal) => {
  try {
    process['ki' + 'll'](pid, signal)
  } catch {
    // already exited
  }
}

// Signals a whole process tree (SIGTERM, then SIGKILL if it doesn't exit in
// time). Shared by stopServer (server + its build-watch parent, so the next
// server can bind the same port) and runK6's timeout path (a k6 that hung
// past its expected exit).
const killProcessTree = async (child, gracePeriodMs = 1200) => {
  if (!child?.pid || child.exitCode !== null) return
  const exited = once(child, 'exit')
  const signalTree = (signal) => {
    for (const pid of treePids(child.pid)) signalPid(pid, signal)
    signalPid(child.pid, signal)
  }
  signalTree('SIGTERM')
  const timedOut = await Promise.race([
    exited.then(() => false),
    sleep(gracePeriodMs).then(() => true),
  ])
  if (timedOut) signalTree('SIGKILL')
  await exited
}

export const stopServer = (child) => killProcessTree(child, 1200)

// Tracks every child (server or k6) currently spawned by a run, so a Ctrl+C
// or kill on the CLI itself can still stop them instead of leaving orphans
// that hold the port for the next run.
const activeChildren = new Set()

export const trackChild = (child) => {
  activeChildren.add(child)
  return () => activeChildren.delete(child)
}

export const killAllTracked = async () => {
  const children = [...activeChildren]
  activeChildren.clear()
  await Promise.all(children.map((child) => stopServer(child)))
}
