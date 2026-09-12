#!/usr/bin/env node
/**
 * HostilePet — a fake browser sensor for the demo.
 *
 * It is a WebSocket client that speaks the real bridge protocol: it says `hello`, declares
 * `signal.hp.site.session.tick`, then streams ticks for one or more host names. The desktop app
 * cannot tell it apart from an extension, which is the point — the demo does not need a browser,
 * a store review or a packed extension.
 *
 * This is a stand-in, and it is labelled as one: nothing here makes a real browser work, and
 * non-negotiable 10 forbids letting a fixture read as a real sensor (`docs/hackathon.md` §4). The
 * event log records what arrives; the desktop's settings window names the handler and the
 * provider that acted on it.
 *
 *   node scripts/simulate-site.cjs --site youtube.com
 *   node scripts/simulate-site.cjs --site tiktok.com --site shopee.vn --minutes 5
 *   node scripts/simulate-site.cjs --site youtube.com --tab-seconds 25   # 25s of time per second
 *
 * Options:
 *   --site <host>      a page to report on; repeat for several tabs (default youtube.com)
 *   --page-type <t>    adapter-defined page kind sent with every tick (e.g. shorts)
 *   --tick-ms <n>      tick interval (default 1000)
 *   --tab-seconds <n>  qualifying seconds credited per tick, instead of --tick-ms worth
 *   --minutes <n>      stop after n minutes (default 0: run until Ctrl-C)
 *   --port <n>         bridge port (default 54321)
 *   --quiet            only print the handshake and a summary every 30s
 *
 * Stop it with Ctrl-C; the kernel sees the socket close and logs the session end.
 */
'use strict'

const { randomUUID } = require('node:crypto')
const WebSocket = require('ws')

const PROTOCOL_VERSION = 1
const PACK_ID = 'hp.site'
const SENSOR_NAME = 'session.tick'
const SIGNAL_TYPE = `signal.${PACK_ID}.${SENSOR_NAME}`
const TICK_SCHEMA = 'signal.session.tick@1'
const MAX_TICK_MS = 60_000

function parseArgs(argv) {
  const options = { sites: [], pageType: undefined, tickMs: 1_000, tabSeconds: null, minutes: 0, port: 54_321, quiet: false }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--site') { options.sites.push(String(value).toLowerCase().replace(/^www\./, '')); index++ }
    else if (flag === '--page-type') { options.pageType = value; index++ }
    else if (flag === '--tick-ms') { options.tickMs = Number(value); index++ }
    else if (flag === '--tab-seconds') { options.tabSeconds = Number(value); index++ }
    else if (flag === '--minutes') { options.minutes = Number(value); index++ }
    else if (flag === '--port') { options.port = Number(value); index++ }
    else if (flag === '--quiet') { options.quiet = true }
    else if (flag === '--help' || flag === '-h') { printUsageAndExit(0) }
    else { console.error(`unknown option: ${flag}`); printUsageAndExit(2) }
  }
  if (options.sites.length === 0) options.sites.push('youtube.com')
  if (!Number.isFinite(options.tickMs) || options.tickMs <= 0) { console.error('--tick-ms must be positive'); process.exit(2) }
  return options
}

function printUsageAndExit(code) {
  console.log(require('node:fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''))
  process.exit(code)
}

const options = parseArgs(process.argv.slice(2))
const creditedMs = options.tabSeconds === null ? options.tickMs : Math.round(options.tabSeconds * 1_000)
if (creditedMs > MAX_TICK_MS) {
  console.error(`--tab-seconds credits ${creditedMs}ms per tick, above the ${MAX_TICK_MS}ms the protocol allows in one increment.`)
  process.exit(2)
}

const url = `ws://127.0.0.1:${options.port}`
const socket = new WebSocket(url)
/** One tab per site: a page identity the kernel can track, with its own monotonic counter. */
const tabs = options.sites.map((site, index) => ({ site, tabId: index + 1, documentId: randomUUID(), seq: 0, ticks: 0 }))
const startedAt = Date.now()
let stopping = false

function envelope(type, extra) {
  return { protocolVersion: PROTOCOL_VERSION, messageId: randomUUID(), timestamp: Date.now(), type, ...extra }
}

function send(message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

socket.on('open', () => {
  console.log(`connected to ${url}`)
  send(envelope('hello', {
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: 'simulate-site/1',
      sensors: [{ packId: PACK_ID, name: SENSOR_NAME, schema: TICK_SCHEMA, sites: options.sites.slice(0, 16) }],
      capabilities: []
    }
  }))
  console.log(`declared ${SIGNAL_TYPE} · reporting ${options.sites.join(', ')}`)
})

socket.on('message', raw => {
  let message
  try { message = JSON.parse(raw.toString()) } catch { console.error('unreadable frame from the bridge'); return }
  if (message.type === 'welcome') {
    console.log(`welcome · protocol ${message.payload?.protocolVersion} · ${message.payload?.activeLeases?.length ?? 0} active lease(s) · tone ${message.payload?.toneLocale}`)
    return
  }
  if (message.type === 'reject') {
    console.error(`refused: ${message.payload?.reason} — ${message.payload?.detail ?? 'no detail'}`)
    process.exit(1)
  }
  if (message.type === 'health.ping') { send(envelope('health.pong', { payload: {} })); return }
  if (message.type === 'health.pong') return
  // Anything else (an intervention from a future rule) is printed rather than ignored: this
  // script exists to show what the kernel sends back, not only what it accepts.
  console.log(`bridge → ${message.type} ${JSON.stringify(message.payload ?? {})}`)
})

socket.on('error', error => {
  console.error(`socket error: ${error.message}`)
  if (error.code === 'ECONNREFUSED') console.error('Is the desktop app running? The bridge only listens in a development build.')
})

socket.on('close', () => {
  const elapsed = Math.round((Date.now() - startedAt) / 1_000)
  console.log(`disconnected after ${elapsed}s`)
  if (!stopping) process.exit(0)
})

const ticker = setInterval(() => {
  for (const tab of tabs) {
    tab.seq += 1
    tab.ticks += 1
    send(envelope(SIGNAL_TYPE, {
      context: { tabId: tab.tabId, documentId: tab.documentId, windowFocused: true },
      payload: { activeMs: creditedMs, seq: tab.seq, active: true, visible: true, idle: false, site: tab.site, ...(options.pageType ? { pageType: options.pageType } : {}) }
    }))
  }
}, options.tickMs)

const reporter = setInterval(() => {
  const elapsed = Math.round((Date.now() - startedAt) / 1_000)
  const every = options.quiet ? 30 : 5
  if (elapsed % every !== 0) return
  const perSite = tabs.map(tab => `${tab.site} ${(tab.ticks * creditedMs / 1_000).toFixed(0)}s`).join(' · ')
  console.log(`t+${elapsed}s · ${perSite}`)
}, 1_000)

if (options.minutes > 0) {
  setTimeout(() => {
    console.log(`${options.minutes} minute(s) are up; closing the socket so the kernel logs the session end.`)
    stopping = true
    clearInterval(ticker)
    socket.close(1_000, 'simulation finished')
  }, options.minutes * 60_000)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    clearInterval(ticker)
    clearInterval(reporter)
    socket.close(1_000, 'simulation stopped')
    setTimeout(() => process.exit(0), 500)
  })
}
