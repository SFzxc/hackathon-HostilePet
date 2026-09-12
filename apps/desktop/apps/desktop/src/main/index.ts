import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from 'electron'
import { BRIDGE_DEFAULT_PORT, BRIDGE_HOST } from '@hostile-pet/contracts'
import { createProvider, escalationLadder, type AgentOutcome } from '@hostile-pet/agent'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { commandSchema, type DesktopStatus } from '../shared/desktop'
import { createTurnRunner, type TurnRunner } from './agent/turn-runner'
import { createKernelHandler } from './bridge/kernel-handler'
import { createMockHandler } from './bridge/mock-handler'
import { createBridge } from './bridge/server'
import type { Bridge, BridgeLogRecord, BridgeHandler } from './bridge/types'
import { createEventLog, type EventLog, type EventLogRecord } from './events/event-log'
import { catalogPaths, isDemoCatalog, loadSiteCatalog, type SiteCatalog } from './events/site-catalog'
import type { SiteTracker } from './events/site-tracker'
import { FOCUS_PACK_ID, FOCUS_SIGNAL, startFocusWatcher, unknownFocusState, type FocusState, type FocusWatcher } from './focus/focus-watcher'
import { petExpression } from './pet/expression'
import { createPresenter, type Presenter } from './pet/presenter'
import { fitInWorkArea } from './window-position'
import { isTrustedURL } from './trusted-url'

let pet: BrowserWindow | undefined
let settings: BrowserWindow | undefined
let tray: Tray | undefined
let bridge: Bridge | undefined
let focusWatcher: FocusWatcher | undefined
/**
 * Before the first read the shell does not know whether a mode is on, and `known: false`
 * is how it says so. Reading the database is opt-out for this build; the permission that
 * needs, and why, are in `docs/adr/0007-macos-focus-sensor.md`.
 */
let focus: FocusState = unknownFocusState('the Focus sensor has not started yet')
const focusSensorEnabled = process.env.HOSTILEPET_FOCUS_SENSOR !== 'off'
let preview: DesktopStatus['preview'] = 'idle'
/** Why the bridge is not running, when that decision was ours rather than a failure. */
let bridgeOffReason: string | null = null

/**
 * The event → agent → pet chain. Every piece is optional on purpose: with no site catalog there
 * is no tracker and no turn, and the shell says so instead of pretending to watch.
 *
 * `HOSTILEPET_HANDLER=mock` keeps the protocol-only stub available for extension iteration
 * (`docs/browser-pack.md` §5); the default is the real kernel handler.
 */
const handlerKind: DesktopStatus['handler'] = process.env.HOSTILEPET_HANDLER === 'mock' ? 'mock' : 'kernel'
let eventLog: EventLog | undefined
let tracker: SiteTracker | null = null
let turnRunner: TurnRunner | undefined
let presenter: Presenter | undefined
let catalog: SiteCatalog | null = null
let catalogPath: string | null = null
let catalogDetail: string | null = 'the site catalog has not been loaded yet'
const providerInfo = createProvider()
/**
 * 30–60 s, clamped: the user asked for a slow cadence, and a cadence faster than the shortest
 * thing worth analysing would only produce turns about nothing.
 */
const agentIntervalMs = Math.max(30_000, Math.min(60_000, Number.parseInt(process.env.HOSTILEPET_AGENT_INTERVAL_MS ?? '', 10) || 45_000))
const rendererFile = join(__dirname, '../renderer/index.html')
const devURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const baseURL = devURL ?? pathToFileURL(rendererFile).href
const bridgeSnapshot = (): DesktopStatus['bridge'] => {
  const state = bridge?.status()
  if (!state) {
    return { phase: 'stopped', host: BRIDGE_HOST, port: BRIDGE_DEFAULT_PORT, security: 'dev-open',
      peer: null, activeLeases: 0, detail: bridgeOffReason }
  }
  return { phase: state.phase, host: state.host, port: state.port, security: state.security,
    peer: state.peer && { extensionVersion: state.peer.extensionVersion, origin: state.peer.origin, sensors: state.peer.sensors.length },
    activeLeases: state.activeLeases, detail: state.detail }
}
/**
 * What the shell may say about Focus. `watch` is reported because a sensor that has
 * silently fallen back to polling is slower, not broken, and the difference is worth
 * seeing before a demo rather than during one.
 */
const focusSnapshot = (): DesktopStatus['focus'] => ({
  known: focus.known,
  active: focus.active,
  modeName: focus.modeName,
  source: focus.source,
  detail: focus.errors.length > 0 ? focus.errors.join('; ') : null,
  watch: focusWatcher?.mode ?? 'stopped',
  reason: focus.reason
})
/**
 * What the shell may say about the agent. The line shown comes from the presenter, never from
 * the turn report: a proposal that was clamped or rejected is not what is on screen.
 */
const agentSnapshot = (): DesktopStatus['agent'] => {
  const state = turnRunner?.state()
  const line = presenter?.current() ?? null
  const level = state?.level ?? 0
  const notes: string[] = []
  for (const clamped of state?.last?.clamped ?? []) notes.push(`clamped ${clamped}`)
  for (const issue of state?.last?.issues ?? []) notes.push(issue)
  return {
    provider: providerInfo.provider.id,
    isModel: providerInfo.provider.isModel,
    phase: state?.thinking ? 'thinking' : 'idle',
    level,
    levelLabel: escalationLadder[level].label,
    turns: state?.turns ?? 0,
    skipped: state?.skipped ?? 0,
    lastLine: line?.say ?? null,
    // A line and its source travel together: a mood change with nothing said has neither.
    lastSource: line?.say ? line.source : null,
    lastAction: line?.action ?? null,
    lastAt: line?.at ?? null,
    intervalSeconds: Math.round(agentIntervalMs / 1000),
    detail: providerInfo.detail ?? (catalog === null ? catalogDetail : null),
    notes: notes.slice(0, 4)
  }
}
/** One event-log record as a person reads it. Formatted here, never parsed in a window. */
function formatRecord(record: EventLogRecord): string {
  const time = new Date(record.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (record.kind === 'agent.turn') {
    return `${time} · agent · level ${record.level} · ${record.action} → ${record.actionResult}${record.say ? ` · “${record.say}”` : ''}`
  }
  if (record.kind === 'agent.error') return `${time} · agent error · ${record.code} · ${record.detail}`
  return `${time} · ${record.site} · ${record.category} · ${record.qualifyingSeconds}s · ${record.documents} page(s) · ${record.reason}`
}
const eventsSnapshot = (): DesktopStatus['events'] => {
  const stats = eventLog?.stats() ?? { path: '', total: 0, loaded: 0, detail: null }
  const tail = eventLog?.tail(6) ?? []
  const withSite = [...tail].reverse().find(record => record.kind !== 'agent.error') ?? null
  const site = withSite && 'site' in withSite ? withSite.site : null
  const category = withSite && 'category' in withSite ? withSite.category : null
  return {
    total: stats.total,
    path: stats.path,
    lastSite: site,
    lastCategory: category,
    lastAt: tail.at(-1)?.at ?? null,
    // A catalog whose watch threshold is under five minutes exists to make a demo happen.
    demoMode: catalog !== null && isDemoCatalog(catalog),
    recent: [...tail].reverse().map(formatRecord),
    detail: stats.detail
  }
}
const catalogSnapshot = (): DesktopStatus['catalog'] => ({
  loaded: catalog !== null,
  path: catalogPath,
  sites: catalog ? Object.keys(catalog.sites).length : 0,
  categories: catalog ? Object.keys(catalog.categories).slice(0, 16) : [],
  detail: catalogDetail
})
const status = (): DesktopStatus => {
  const line = presenter?.current() ?? null
  return {
    petVisible: pet?.isVisible() ?? false,
    preview,
    petExpression: petExpression(preview, focus, presenter?.expression() ?? null),
    petLine: line?.say ? { say: line.say, source: line.source, badge: line.badge, at: line.at } : null,
    bridge: bridgeSnapshot(),
    focus: focusSnapshot(),
    agent: agentSnapshot(),
    events: eventsSnapshot(),
    catalog: catalogSnapshot(),
    browser: 'no-pack-installed',
    handler: handlerKind,
    character: 'placeholder'
  }
}
function log(action: string): void {
  console.info(JSON.stringify({ event: 'desktop.action', action, packId: null, ruleId: null, source: 'user-shell' }))
}
/**
 * A sensor signal carries its real pack id and no rule id: no rule has acted on it yet.
 * It logs the reading, never a mode it did not read — the empty case is `known: false`.
 */
function reportFocus(next: FocusState, previous: FocusState | null): void {
  focus = next
  console.info(JSON.stringify({ event: 'desktop.signal', type: FOCUS_SIGNAL, packId: FOCUS_PACK_ID, ruleId: null,
    source: 'focus-sensor', transition: previous === null ? 'initial' : 'changed',
    known: next.known, active: next.active, modeId: next.modeId, modeName: next.modeName, detectedBy: next.source }))
  notify()
}
/** One human-readable line about the sensor, used by the tray and never parsed. */
function focusLine(): string {
  if (!focusSensorEnabled) return 'Focus: sensor off'
  // Short by design, and it names the fix rather than the error: this is the one row a demo
  // audience reads, and "EPERM" is not a sentence.
  if (focus.reason === 'permission') return 'Focus: grant permission'
  if (!focus.known) return 'Focus: unreadable'
  if (focus.active === true) {
    return `Focus: ${focus.modeName ?? focus.modeId ?? 'on'}${focus.source === 'schedule' ? ' (scheduled)' : ''}`
  }
  return 'Focus: off'
}
/**
 * The state, on hover. The menu-bar icon itself carries no text: the pet's face is what is
 * supposed to be readable at a glance, and a permanent label next to the clock is noise. A
 * state nobody can read still has to be said out loud somewhere, so it is said here and in the
 * first line of the menu.
 */
function focusTooltip(): string {
  if (!focusSensorEnabled) return 'Focus: sensor off'
  if (focus.reason === 'permission') return 'Focus: grant permission'
  if (!focus.known) return 'Focus: unreadable'
  return focus.active === true ? `Focus: ${focus.modeName ?? 'on'}` : 'Focus: off'
}
/**
 * The one unread state a permission fixes. A sensor that was switched off, or that no longer
 * exists, is also `known: false` — offering a grant there would send the user to a switch that
 * changes nothing, which is worse than offering nothing at all.
 */
const focusNeedsPermission = (): boolean => focus.reason === 'permission'
/**
 * macOS gives an app no way to grant itself Full Disk Access; only the person in front of the
 * screen can, in a pane that is four clicks deep. The shell's job is to remove the hunt for the
 * switch, not to pretend it can flip it.
 *
 * The pane's URL scheme changed in macOS 13, so the modern one is tried first and the older one
 * is the fallback. Opening a pane also does not grant anything: TCC is read when a process
 * starts, which is why `relaunch` sits next to this and why both windows say so out loud.
 */
const FOCUS_PERMISSION_PANES = [
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
]
async function openFocusPermission(): Promise<void> {
  for (const pane of FOCUS_PERMISSION_PANES) {
    try {
      await shell.openExternal(pane)
      log('open-focus-permission')
      return
    } catch { /* the next scheme is the fallback, not a retry of this one */ }
  }
  report(new Error('could not open the permission settings pane'))
}
/**
 * Quitting is not a side effect here, it is the fix: the permission the user just granted is
 * read at process start, so a running app keeps the old answer until it restarts.
 */
function relaunch(): void {
  log('relaunch')
  app.relaunch()
  app.quit()
}
function reportBridge(record: BridgeLogRecord): void {
  console.info(JSON.stringify(record))
}
function notify(): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('desktop:changed', status())
  // The tray can already be gone: Quit destroys it and then stops the bridge, whose status
  // callback lands here. Touching a destroyed tray throws, and an exception on the way out
  // is how a clean shutdown turns into a hang.
  if (!tray || tray.isDestroyed()) return
  // No `setTitle`: the icon is the icon. State is on hover, and in the menu's first line.
  tray.setToolTip(`HostilePet · ${focusTooltip()}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    // One line about the sensor, then the actions. The bridge, agent and log diagnostics used to
    // sit here: they are developer state that nobody acts on from this menu, and the fact that
    // matters — no pack is installed — is still stated plainly in Settings.
    { label: focusLine(), enabled: false },
    { type: 'separator' },
    { label: 'Ask the pet now', click: () => { void turnRunner?.runNow('manual') } },
    // Next to the complaint rather than buried in Settings: this item only exists while the
    // sensor is running and macOS is refusing the read.
    ...(focusNeedsPermission() ? [
      { label: 'Grant permission…', click: () => { void openFocusPermission() } },
      { label: 'Quit and reopen HostilePet', click: relaunch }
    ] : []),
    { label: pet?.isVisible() ? 'Hide pet' : 'Show pet', click: () => { togglePet(!pet?.isVisible()) } },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit HostilePet', click: () => { log('quit'); app.quit() } }
  ]))
}
function togglePet(visible: boolean): void {
  if (visible) pet?.showInactive(); else pet?.hide()
  log(visible ? 'show-pet' : 'hide-pet'); notify()
}
/**
 * The pet's window is big enough for whatever it is wearing: a bare creature, or a creature
 * with a bubble above it. A line that arrives while the window is still 160 px wide would be
 * clipped by the window's own edge, which reads as a bug rather than as a remark.
 */
function refreshPet(): void {
  if (pet) {
    const line = presenter?.current() ?? null
    const expanded = preview !== 'idle' || line !== null
    const width = expanded ? 280 : 160
    const height = expanded ? 270 : 170
    const bounds = pet.getBounds()
    if (bounds.width !== width || bounds.height !== height) {
      pet.setBounds(fitInWorkArea({ x: bounds.x + Math.round((bounds.width - width) / 2),
        y: bounds.y + bounds.height - height, width, height }, screen.getDisplayMatching(bounds).workArea))
    }
    pet.showInactive()
  }
  notify()
}
function previewPet(value: DesktopStatus['preview']): void {
  preview = value
  log(`preview-${value}`)
  refreshPet()
}
/** The always-available escape from a line: dismissing it is one command, never a dialog. */
function dismissLine(): void {
  presenter?.dismiss()
  log('dismiss-line')
}
function secure(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => { event.preventDefault() })
  window.webContents.on('will-attach-webview', event => { event.preventDefault() })
}
async function load(window: BrowserWindow, surface: string): Promise<void> {
  secure(window)
  if (devURL) await window.loadURL(`${devURL}#${surface}`)
  else await window.loadFile(rendererFile, { hash: surface })
}
function report(error: unknown): void {
  console.error(JSON.stringify({ event: 'desktop.error', code: error instanceof Error ? error.name : 'UNKNOWN', packId: null, ruleId: null }))
}
function openSettings(): void {
  if (settings) { settings.show(); settings.focus(); return }
  settings = new BrowserWindow({ width: 780, height: 640, minWidth: 640, minHeight: 560,
    show: false, title: 'HostilePet', backgroundColor: '#f5f1e8', titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  settings.once('ready-to-show', () => { settings?.show() })
  settings.on('closed', () => { settings = undefined })
  void load(settings, 'settings').catch(report)
  log('open-settings')
}
function trusted(event: Electron.IpcMainInvokeEvent): boolean {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || (owner !== pet && owner !== settings) || event.senderFrame !== event.sender.mainFrame) return false
  return isTrustedURL(event.senderFrame.url, baseURL)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.setName('HostilePet')
  app.on('second-instance', openSettings)
  app.on('window-all-closed', () => { /* Tray owns app lifecycle. */ })
  app.on('activate', () => { togglePet(true) })
  app.on('before-quit', () => {
    focusWatcher?.stop(); focusWatcher = undefined
    turnRunner?.stop(); turnRunner = undefined
    // The last observations and the last receipt are worth keeping; a debounced write that
    // never lands would lose exactly the tail a demo is judged on.
    eventLog?.flush()
    tray?.destroy(); tray = undefined
  })
  // Quitting is the one shutdown we can act on. `will-quit` is held open just long enough
  // for the bridge to release every outstanding lease with `quit`, so an intervention never
  // outlives the app that raised it.
  let releasing = false
  app.on('will-quit', event => {
    if (releasing || !bridge) return
    releasing = true
    event.preventDefault()
    void bridge.stop().then(() => {
      // The second quit has to leave this stack first: Electron is still unwinding the quit
      // it is being asked to restart, and drops a re-entrant call.
      setImmediate(() => { app.quit() })
    })
  })
  void app.whenReady().then(async () => {
    app.dock?.hide()
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    session.defaultSession.setPermissionCheckHandler(() => false)
    ipcMain.handle('desktop:status', (event, ...args: unknown[]) => {
      if (!trusted(event) || args.length !== 0) throw new Error('INVALID_IPC')
      return status()
    })
    ipcMain.handle('desktop:command', (event, ...args: unknown[]) => {
      if (!trusted(event) || args.length !== 1) throw new Error('INVALID_IPC')
      const command = commandSchema.parse(args[0])
      if (command === 'open-settings') openSettings()
      else if (command === 'preview-thinking') previewPet('thinking')
      else if (command === 'preview-speaking') previewPet('speaking')
      else if (command === 'preview-idle') previewPet('idle')
      else if (command === 'open-focus-permission') void openFocusPermission()
      else if (command === 'relaunch') relaunch()
      else if (command === 'dismiss-line') dismissLine()
      else if (command === 'quit') { log('quit'); app.quit() }
      else togglePet(command === 'show-pet')
    })
    const area = screen.getPrimaryDisplay().workArea
    // The Focus sensor is the first real one, so it runs in a packaged build too. It reads
    // a TCC-protected file and reports `known: false` until the app holds Full Disk Access;
    // ADR 0007 owns that trade, including the env kill switch.
    if (focusSensorEnabled) {
      focusWatcher = startFocusWatcher({
        onChange: reportFocus,
        onError: error => { report(error) }
      })
    }
    // The event log is the memory the agent reads from, and the site catalog is the only place
    // a host name or a threshold lives (non-negotiable 1). Both are loaded before the bridge
    // starts, so the first tick already has somewhere to go.
    const loaded = loadSiteCatalog(catalogPaths(app.getAppPath(), process.resourcesPath))
    catalog = loaded.catalog
    catalogPath = loaded.path
    catalogDetail = loaded.detail
    if (catalog === null) reportBridge({ event: 'bridge.failed', code: 'catalog', detail: loaded.detail ?? 'no site catalog' })
    eventLog = createEventLog(join(app.getPath('userData'), 'events.json'))
    const logged = eventLog.stats()
    if (logged.detail !== null) reportBridge({ event: 'bridge.failed', code: 'event-log', detail: logged.detail })
    // The presenter is the only thing that can put a line on screen, and it tells the shell when
    // the pet's window has to grow or shrink around it.
    presenter = createPresenter({ onChange: refreshPet })
    // The bridge in this slice is a development surface: the admission check is `dev-open`,
    // and no pack runtime exists yet. It therefore does not run in a packaged build — see
    // `docs/protocol.md` §1.2, which owns that decision.
    if (app.isPackaged) {
      bridgeOffReason = 'the development bridge is disabled in a packaged build; it returns when a real pack runtime does.'
      reportBridge({ event: 'bridge.failed', code: 'packaged', detail: bridgeOffReason })
    } else {
      let handler: BridgeHandler
      if (handlerKind === 'mock') handler = createMockHandler()
      else {
        const kernel = createKernelHandler({ catalog, eventLog })
        handler = kernel.handler
        tracker = kernel.tracker
      }
      bridge = createBridge({
        host: BRIDGE_HOST,
        port: BRIDGE_DEFAULT_PORT,
        security: 'dev-open',
        handler,
        log: reportBridge,
        onStatus: () => { notify() }
      })
      const state = await bridge.start()
      if (state.phase !== 'listening') {
        reportBridge({ event: 'bridge.failed', code: state.phase, detail: state.detail ?? 'no detail' })
      }
    }
    pet = new BrowserWindow({ width: 160, height: 170, x: area.x + area.width - 190, y: area.y + area.height - 200,
      show: false, frame: false, transparent: true, resizable: false, hasShadow: false, alwaysOnTop: true,
      skipTaskbar: true, focusable: false,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    pet.once('ready-to-show', () => { pet?.showInactive(); notify() })
    pet.on('closed', () => { pet = undefined; notify() })
    const recover = (): void => {
      if (!pet) return
      const bounds = pet.getBounds()
      pet.setBounds(fitInWorkArea(bounds, screen.getDisplayMatching(bounds).workArea))
    }
    screen.on('display-removed', recover)
    screen.on('display-metrics-changed', recover)
    // Original geometric template icon, generated locally; no external art.
    const pixels = Buffer.alloc(16 * 16 * 4)
    for (let y = 3; y < 13; y++) for (let x = 2; x < 14; x++) {
      const border = x === 2 || x === 13 || y === 3 || y === 12
      const eye = y >= 6 && y <= 8 && (x === 5 || x === 10)
      if (border || eye) pixels[(y * 16 + x) * 4 + 3] = 255
    }
    const icon = nativeImage.createFromBitmap(pixels, { width: 16, height: 16, scaleFactor: 1 })
    icon.setTemplateImage(true)
    tray = new Tray(icon); notify()
    // The agent runs on its own slow clock, over what the tracker accumulated. With no catalog
    // there is nothing to accumulate and nothing to analyse, so no turn is ever requested — the
    // pet stays quiet and the tray says why.
    if (tracker && catalog && eventLog) {
      turnRunner = createTurnRunner({
        catalog,
        tracker,
        eventLog,
        provider: providerInfo.provider,
        apply: (outcome: AgentOutcome, level: number) => presenter?.present(outcome, level) ?? { result: 'unavailable', detail: 'the pet window is not ready' },
        intervalMs: agentIntervalMs
      })
      notify()
      turnRunner.start()
    }
    await load(pet, 'pet')
  }).catch(report)
}
