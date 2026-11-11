import os from 'node:os'
import * as p from '@clack/prompts'
import { listServers } from './measure.js'

export const itemLimit = 20

const stopIfCancel = (value) => {
  if (p.isCancel(value)) {
    p.cancel('Stopped.')
    process.exit(0)
  }
  return value
}

const askNumber = (message) => p.text({
  message,
  validate: (value) => {
    if (!/^[1-9]\d*$/.test(value ?? '')) return 'Enter a whole number above 0.'
  },
})

const autoWorkers = () => Math.max(1, os.availableParallelism() - 2)

export const ask = async () => {
  p.intro('System Design Bench')

  const scaling = stopIfCancel(await p.select({
    message: 'Scaling',
    options: [
      { value: 'vertical', label: 'vertical' },
      { value: 'horizontal', label: 'horizontal' },
    ],
  }))

  if (scaling !== 'vertical') {
    p.outro('Phase 2 is not built. This bench runs vertical only.')
    process.exit(0)
  }

  const runnable = (await listServers()).filter((server) => server.dev)
  const pickedServers = stopIfCancel(await p.multiselect({
    message: 'Servers',
    options: [
      { value: 'all', label: 'all' },
      ...runnable.map((server) => ({ value: server.name, label: server.name })),
    ],
    required: true,
  }))
  const servers = pickedServers.includes('all')
    ? runnable.map((server) => server.name)
    : pickedServers

  const processMode = stopIfCancel(await p.select({
    message: 'Processes',
    options: [
      { value: 'auto', label: `auto (${autoWorkers()} workers)` },
      { value: 'custom', label: 'custom' },
    ],
  }))

  const workers = processMode === 'custom'
    ? Number(stopIfCancel(await askNumber('How many processes?')))
    : autoWorkers()

  const rate = Number(stopIfCancel(await askNumber('Req/s')))
  const seconds = Number(stopIfCancel(await askNumber('Duration in seconds')))
  const picked = stopIfCancel(await p.multiselect({
    message: 'Compression',
    options: [
      { value: 'all', label: 'all' },
      { value: 'off', label: 'off' },
      { value: 'gzip', label: 'gzip' },
      { value: 'brotli', label: 'brotli' },
      { value: 'zstd', label: 'zstd' },
    ],
    required: true,
  }))

  const compression = picked.includes('all') ? ['off', 'gzip', 'brotli', 'zstd'] : picked

  // --skip-build on the command line always skips the question. Otherwise ask,
  // since rebuilding (tsup/tsc watch) is what eats most of the wall-clock time.
  const skipBuild = process.argv.includes('--skip-build') || stopIfCancel(await p.select({
    message: 'Build',
    options: [
      { value: false, label: 'rebuild (pnpm dev, tsup/tsc watch)' },
      { value: true, label: 'skip build (run the existing dist as-is, faster)' },
    ],
  }))

  p.note(
    [
      'scaling      vertical',
      `servers      ${servers.join(', ')}`,
      `processes    ${workers}`,
      `req/s        ${rate}`,
      `duration     ${seconds}s`,
      `compression  ${compression.join(', ')}`,
      `build        ${skipBuild ? 'skip (existing dist)' : 'rebuild (pnpm dev)'}`,
      `url          /products?page=1&limit=${itemLimit} on each server PORT`,
    ].join('\n'),
    'Run',
  )

  const start = stopIfCancel(await p.confirm({ message: 'Start the run?' }))
  if (!start) {
    p.outro('Stopped.')
    process.exit(0)
  }

  return { workers, rate, seconds, compression, servers, skipBuild }
}
