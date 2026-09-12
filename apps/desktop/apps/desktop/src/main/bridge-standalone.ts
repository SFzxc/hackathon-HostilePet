/**
 * Fake kernel: the bridge with a stand-in handler, running as a plain Node process.
 *
 * `docs/browser-pack.md` §5 requires the extension to be iterable without the desktop app.
 * This entry is the dev-only escape hatch that makes that true, and it is deliberately a
 * separate process from `index.ts`: the Electron app must never grow a "pretend the kernel
 * exists" mode.
 *
 * It is not a product surface. It has no policy, no pack runtime, no store and no model, and
 * `--fixtures` prints the contract fixtures so an extension author can see the exact shapes
 * without reading TypeScript.
 *
 * Usage:
 *   node out/main/bridge-standalone.js [--port 54321] [--token <t>] [--trigger-ms 15000]
 *                                      [--ttl-ms 60000] [--stats-ms 5000] [--fixtures] [--quiet]
 */

import {
  BRIDGE_DEFAULT_PORT,
  BRIDGE_HOST,
  DEFAULT_TONE_LOCALE,
  LEASE_DEFAULT_TTL_MS,
  PROTOCOL_VERSION,
  invalidInbound,
  invalidSignalPayloads,
  validInbound,
  validOutbound
} from '@hostile-pet/contracts'
import { createMockHandler } from './bridge/mock-handler'
import { createBridge } from './bridge/server'
import type { BridgeLogRecord, BridgeSecurity } from './bridge/types'

const USAGE = `HostilePet bridge — fake kernel (dev only)

  node out/main/bridge-standalone.js [options]

  --port <n>        port to listen on (default ${BRIDGE_DEFAULT_PORT})
  --token <t>       require this token in hello and check the origin (default: dev-open)
  --trigger-ms <n>  qualifying time that trips the mock gate (default 15000)
  --ttl-ms <n>      lease TTL in ms (default ${LEASE_DEFAULT_TTL_MS})
  --stats-ms <n>    print mock stats every n ms; 0 disables (default 5000)
  --fixtures        print the inbound/outbound contract fixtures and exit
  --quiet           print only the records worth interrupting a human for
  --help            this text

Environment fallbacks: HP_BRIDGE_PORT, HP_BRIDGE_TOKEN, HP_MOCK_TRIGGER_MS,
HP_MOCK_TTL_MS, HP_STATS_MS. Flags win.
`

interface Options {
  port: number
  token: string | null
  triggerMs: number
  ttlMs: number
  statsMs: number
  quiet: boolean
  fixtures: boolean
  help: boolean
}

function fail(message: string): never {
  process.stderr.write(`bridge-standalone: ${message}\n\n${USAGE}`)
  process.exit(1)
}

function readNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`${name} must be a non-negative integer, got ${JSON.stringify(value)}`)
  }
  return parsed
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    port: readNumber(process.env.HP_BRIDGE_PORT, BRIDGE_DEFAULT_PORT, 'HP_BRIDGE_PORT'),
    token: process.env.HP_BRIDGE_TOKEN ?? null,
    triggerMs: readNumber(process.env.HP_MOCK_TRIGGER_MS, 15_000, 'HP_MOCK_TRIGGER_MS'),
    ttlMs: readNumber(process.env.HP_MOCK_TTL_MS, LEASE_DEFAULT_TTL_MS, 'HP_MOCK_TTL_MS'),
    statsMs: readNumber(process.env.HP_STATS_MS, 5000, 'HP_STATS_MS'),
    quiet: false,
    fixtures: false,
    help: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const next = (): string => {
      index += 1
      const value = argv[index]
      if (value === undefined) fail(`${flag} needs a value`)
      return value
    }
    switch (flag) {
      case '--port': options.port = readNumber(next(), options.port, '--port'); break
      case '--token': options.token = next(); break
      case '--trigger-ms': options.triggerMs = readNumber(next(), options.triggerMs, '--trigger-ms'); break
      case '--ttl-ms': options.ttlMs = readNumber(next(), options.ttlMs, '--ttl-ms'); break
      case '--stats-ms': options.statsMs = readNumber(next(), options.statsMs, '--stats-ms'); break
      case '--quiet': options.quiet = true; break
      case '--fixtures': options.fixtures = true; break
      case '--help': options.help = true; break
      default: fail(`unknown option ${JSON.stringify(flag)}`)
    }
  }
  return options
}

function printFixtures(): void {
  process.stdout.write(`${JSON.stringify({ validInbound, validOutbound, invalidInbound, invalidSignalPayloads }, null, 2)}\n`)
}

/** The records a person running this by hand actually needs to see. */
const INTERESTING: ReadonlySet<string> = new Set([
  'bridge.failed',
  'bridge.stopped',
  'bridge.peer.refused',
  'bridge.peer.connected',
  'bridge.peer.disconnected',
  'bridge.message.invalid',
  'bridge.outbound.invalid',
  'bridge.intervention.requested',
  'bridge.intervention.released'
])

/**
 * Wrapped in a function on purpose: the main build emits CommonJS, where top-level await is a
 * syntax error, and a promise chain at module scope would report a failed start as an
 * unhandled rejection instead of a non-zero exit code.
 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(USAGE)
    return
  }
  if (options.fixtures) {
    printFixtures()
    return
  }

  const security: BridgeSecurity = options.token === null ? 'dev-open' : 'paired'
  const mock = createMockHandler({ triggerActiveMs: options.triggerMs, leaseTtlMs: options.ttlMs })

  const bridge = createBridge({
    host: BRIDGE_HOST,
    port: options.port,
    security,
    handler: mock,
    ...(options.token === null ? {} : { pairedToken: options.token }),
    log: (record: BridgeLogRecord) => {
      if (options.quiet && !INTERESTING.has(record.event)) return
      process.stdout.write(`${JSON.stringify(record)}\n`)
    }
  })

  const status = await bridge.start()

  process.stdout.write(
    [
      '',
      'HostilePet bridge — fake kernel. Not the product: no policy, no packs, no model.',
      `  url         ws://${status.host}:${status.port}`,
      `  protocol    ${PROTOCOL_VERSION} (sent in hello and in every envelope)`,
      `  security    ${security}${security === 'dev-open' ? ' — hello.token is ignored' : ''}`,
      '  sensors     hp.example/session.tick → signal.session.tick@1',
      `  locale      ${DEFAULT_TONE_LOCALE}`,
      `  mock gate   ${options.triggerMs} ms of qualifying time → a lease of ${options.ttlMs} ms`,
      '',
      '  This process speaks the real wire format (docs/protocol.md §1). The handler behind it',
      '  is a stub, so a gate raised here is evidence about the protocol and nothing about',
      '  policy. Run with --fixtures to print every shape it accepts and refuses.',
      ''
    ].join('\n')
  )

  if (status.phase !== 'listening') {
    process.stderr.write(`bridge-standalone: did not start: ${status.phase}: ${status.detail ?? 'no detail'}\n`)
    process.exitCode = 1
    return
  }

  if (options.statsMs > 0) {
    const timer = setInterval(() => {
      const stats = mock.stats()
      if (stats.trackedPages === 0 && stats.completedCycles === 0) return
      process.stdout.write(`${JSON.stringify({ event: 'host.stats', ...stats })}\n`)
    }, options.statsMs)
    // The listening socket keeps the process alive; the reporter must not do it on its own if
    // the server ever goes away.
    timer.unref()
  }

  const shutdown = (signal: string): void => {
    process.stdout.write(`${JSON.stringify({ event: 'host.signal', signal })}\n`)
    void bridge.stop().then(() => {
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`bridge-standalone: ${message}\n`)
  process.exitCode = 1
})
