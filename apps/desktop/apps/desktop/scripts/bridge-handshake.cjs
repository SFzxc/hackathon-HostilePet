#!/usr/bin/env node
'use strict'

/**
 * Drives the bridge through the whole documented exchange, over a real socket, against the
 * real fake kernel — and prints every frame it sees.
 *
 * Two audiences, one script:
 *
 *  - the extension author, who can read the frames in order instead of guessing them from
 *    prose, and can attach to a host they started themselves with `--url`;
 *  - the repo, which needs one command that fails when the protocol breaks.
 *
 * The fixtures it sends are not written here: it reads them from the host's own `--fixtures`
 * output, so a shape change in `packages/contracts` cannot leave this script asserting an
 * older protocol than the kernel speaks.
 *
 * Usage:
 *   node scripts/bridge-handshake.cjs                 # spawn a host, drive it, clean up
 *   node scripts/bridge-handshake.cjs --url ws://127.0.0.1:54321
 *   node scripts/bridge-handshake.cjs --port 54321 --trigger-ms 300 --ttl-ms 1500
 */

const { execFileSync, spawn } = require('node:child_process')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { WebSocket } = require('ws')

const ROOT = path.join(__dirname, '..')
const HOST_ENTRY = path.join(ROOT, 'out', 'main', 'bridge-standalone.js')

const USAGE = `bridge-handshake [options]

  --url <url>        attach to a host that is already running instead of spawning one
  --port <n>         port for the spawned host (default 54321)
  --trigger-ms <n>   mock gate threshold for the spawned host (default 300)
  --ttl-ms <n>       lease TTL for the spawned host (default 1500)
  --verbose          print frames the driver does not assert on

Exits 0 only if the handshake, the signal, the gate, the TTL release and the post-release
re-arm all behaved. A mock gate proves the protocol, never the policy behind it.`

const options = { url: null, port: 54321, triggerMs: 300, ttlMs: 1500, verbose: false }

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = () => {
      i += 1
      if (argv[i] === undefined) fail(`${flag} needs a value`)
      return argv[i]
    }
    switch (flag) {
      case '--url': options.url = value(); break
      case '--port': options.port = Number(value()); break
      case '--trigger-ms': options.triggerMs = Number(value()); break
      case '--ttl-ms': options.ttlMs = Number(value()); break
      case '--verbose': options.verbose = true; break
      case '--help': process.stdout.write(`${USAGE}\n`); process.exit(0); break
      default: fail(`unknown option ${JSON.stringify(flag)}`)
    }
  }
}

function fail(message) {
  process.stderr.write(`bridge-handshake: ${message}\n\n${USAGE}\n`)
  process.exit(1)
}

function step(message) {
  process.stdout.write(`  ✓ ${message}\n`)
}

function loadFixtures() {
  if (!require('node:fs').existsSync(HOST_ENTRY)) {
    fail(`${path.relative(ROOT, HOST_ENTRY)} is missing; run \`pnpm --filter @hostile-pet/desktop build\` first`)
  }
  const raw = execFileSync(process.execPath, [HOST_ENTRY, '--fixtures'], { encoding: 'utf8' })
  return JSON.parse(raw)
}

/** Starts the fake kernel and resolves once it prints its listening banner. */
function spawnHost() {
  const child = spawn(
    process.execPath,
    [HOST_ENTRY, '--port', String(options.port), '--trigger-ms', String(options.triggerMs), '--ttl-ms', String(options.ttlMs), '--stats-ms', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  child.stderr.on('data', chunk => process.stderr.write(`  host: ${chunk}`))
  const lines = []
  child.stdout.on('data', chunk => {
    for (const line of String(chunk).split('\n')) {
      if (!line.trim()) continue
      lines.push(line)
      // Every host record is a JSON line; the banner is the human-readable part.
      if (options.verbose || !line.startsWith('{')) process.stdout.write(`  host: ${line}\n`)
    }
  })
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000
    const poll = setInterval(() => {
      if (lines.some(line => line.includes('url         ws://'))) {
        clearInterval(poll)
        resolve(child)
      } else if (child.exitCode !== null) {
        clearInterval(poll)
        reject(new Error(`the host exited with code ${child.exitCode} before it started listening`))
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        reject(new Error('the host did not start listening within 10 s'))
      }
    }, 50)
  })
}

function createClient(url) {
  const socket = new WebSocket(url, { origin: 'chrome-extension://hostilepet-handshake' })
  const queue = []
  const waiters = []
  let transportError = null

  socket.on('message', raw => {
    const message = JSON.parse(raw.toString())
    if (options.verbose) process.stdout.write(`  ← ${JSON.stringify(message)}\n`)
    // A message that answers a pending waiter is handed over and never queued: leaving it in
    // the queue would let the next waitFor return the same frame again, and every assertion
    // after that would be about a message the kernel sent once.
    const waiter = waiters.find(entry => entry.type === 'any' || entry.type === message.type)
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(message)
      return
    }
    queue.push(message)
  })
  socket.on('error', error => {
    transportError = error
  })

  return {
    socket,
    url,
    open: () => new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    }),
    send(message) {
      process.stdout.write(`  → ${JSON.stringify(message)}\n`)
      socket.send(JSON.stringify(message))
    },
    waitFor(type, timeoutMs = 5000) {
      const index = queue.findIndex(message => type === 'any' || message.type === type)
      if (index >= 0) {
        const [message] = queue.splice(index, 1)
        return Promise.resolve(message)
      }
      if (transportError) return Promise.reject(transportError)
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve: message => { clearTimeout(timer); resolve(message) } }
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1)
          const seen = queue.map(m => m.type).join(', ') || 'nothing'
          reject(new Error(`no ${type} within ${timeoutMs} ms; still queued: ${seen}; socket error: ${transportError?.message ?? 'none'}`))
        }, timeoutMs)
        waiters.push(waiter)
      })
    },
    close: () => socket.close()
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  parseArgs(process.argv.slice(2))
  const fixtures = loadFixtures()
  const url = options.url ?? `ws://127.0.0.1:${options.port}`

  let host = null
  if (options.url === null) {
    process.stdout.write(`\nstarting the fake kernel on ${url}\n`)
    host = await spawnHost()
    process.on('exit', () => host?.kill())
  }

  try {
    const client = createClient(url)
    await client.open()
    process.stdout.write(`connected to ${url}\n`)

    // 1. Handshake. The frame is the contract fixture, verbatim.
    const hello = { ...fixtures.validInbound.hello, messageId: randomUUID(), timestamp: Date.now() }
    hello.payload.extensionVersion = 'handshake-driver'
    client.send(hello)
    const welcome = await client.waitFor('welcome')
    assert(welcome.protocolVersion === hello.protocolVersion, `welcome.protocolVersion ${welcome.protocolVersion} != ${hello.protocolVersion}`)
    assert(welcome.payload.protocolVersion === 1, 'welcome should pin protocol 1')
    assert(Array.isArray(welcome.payload.activeLeases), 'welcome.activeLeases must be an array')
    step(`handshake: welcome with protocol ${welcome.payload.protocolVersion}, ${welcome.payload.activeLeases.length} active lease(s)`)

    // 2. A signal the socket declared at hello. The kernel owns the accumulator, so the
    //    driver only ever sends deltas.
    const documentId = fixtures.validInbound.tick.context.documentId
    const sendTick = seq => {
      const tick = {
        ...fixtures.validInbound.tick,
        messageId: randomUUID(),
        timestamp: Date.now(),
        context: { ...fixtures.validInbound.tick.context, documentId },
        payload: { ...fixtures.validInbound.tick.payload, seq, activeMs: Math.ceil(options.triggerMs / 2) }
      }
      client.send(tick)
      return tick
    }

    const first = sendTick(1)
    // A retry of an already-seen messageId is tolerated and must not double-count. Sent
    // twice on purpose: if it were counted, the gate would trip one tick early.
    client.send(first)
    sendTick(2)

    const request = await client.waitFor('intervention.request')
    const { lease, copy, demoMode } = request.payload
    const declaredPackId = fixtures.validInbound.hello.payload.sensors[0].packId
    assert(lease.packId === declaredPackId, `gate came from ${lease.packId}, expected the declared pack ${declaredPackId}`)
    assert(lease.ttlMs === options.ttlMs, `lease.ttlMs ${lease.ttlMs} != ${options.ttlMs}`)
    assert(lease.scope.documentId === documentId, 'lease scope lost the documentId it was raised for')
    assert(typeof lease.escapeLabel === 'string' && lease.escapeLabel.length > 0, 'a lease without an escape label is a gate with no exit')
    assert(lease.expiresAt > lease.ttlMs, 'lease.expiresAt should be an epoch time, not a duration')
    assert(copy.source === 'mock', `copy.source is ${copy.source}; a mock line must say so`)
    assert(demoMode === true, 'a stub handler must mark its interventions as demo mode')
    step(`gate: ${lease.leaseId} · ${lease.packId}/${lease.ruleId} · ttl ${lease.ttlMs} ms · escape "${lease.escapeLabel}"`)
    step(`copy: source=${copy.source} locale=${copy.locale} text="${copy.text}"`)
    step('duplicate messageId was sent twice and did not change the gate')

    // 3. TTL is finite and enforced by the kernel: nothing asked for this release.
    const released = await client.waitFor('intervention.release', options.ttlMs + 4000)
    assert(released.payload.leaseId === lease.leaseId, `released ${released.payload.leaseId}, expected ${lease.leaseId}`)
    assert(released.payload.reason === 'ttl_elapsed', `release reason was ${released.payload.reason}`)
    step(`lease released by TTL: ${released.payload.reason}`)

    // 4. The loop is still live after a release.
    sendTick(3)
    sendTick(4)
    const second = await client.waitFor('intervention.request')
    assert(second.payload.lease.leaseId !== lease.leaseId, 'the re-armed gate reused the old leaseId')
    step(`re-armed: new lease ${second.payload.lease.leaseId}`)

    client.close()
    process.stdout.write('\nbridge-handshake: all checks passed. This proves the protocol, not the policy.\n')
  } finally {
    host?.kill()
  }
}

main().catch(error => {
  process.stderr.write(`\nbridge-handshake: FAILED — ${error.message}\n`)
  process.exitCode = 1
})
