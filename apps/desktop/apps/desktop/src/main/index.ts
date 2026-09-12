import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, Tray } from 'electron'
import { BRIDGE_DEFAULT_PORT, BRIDGE_HOST } from '@hostile-pet/contracts'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { commandSchema, type DesktopStatus } from '../shared/desktop'
import { createMockHandler } from './bridge/mock-handler'
import { createBridge } from './bridge/server'
import type { Bridge, BridgeLogRecord } from './bridge/types'
import { fitInWorkArea } from './window-position'
import { isTrustedURL } from './trusted-url'

let pet: BrowserWindow | undefined
let settings: BrowserWindow | undefined
let tray: Tray | undefined
let bridge: Bridge | undefined
let preview: DesktopStatus['preview'] = 'idle'
/** Why the bridge is not running, when that decision was ours rather than a failure. */
let bridgeOffReason: string | null = null
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
const status = (): DesktopStatus => ({ petVisible: pet?.isVisible() ?? false,
  preview, bridge: bridgeSnapshot(), browser: 'no-pack-installed', handler: 'mock',
  agent: 'not-configured', character: 'placeholder' })
function log(action: string): void {
  console.info(JSON.stringify({ event: 'desktop.action', action, packId: null, ruleId: null, source: 'user-shell' }))
}
/**
 * One human-readable line about the bridge. It never says "connected" without a peer and
 * never says "observing": the handler behind the socket is a mock until the pack runtime
 * exists, and `docs/browser-pack.md` §5 keeps those two claims apart.
 */
function bridgeLine(): string {
  const state = bridgeSnapshot()
  if (state.phase === 'listening') {
    return state.peer
      ? `Bridge listening on ${state.host}:${state.port} · extension v${state.peer.extensionVersion} · ${state.peer.sensors} sensor(s) declared · ${state.activeLeases} active lease(s)`
      : `Bridge listening on ${state.host}:${state.port} · no extension connected`
  }
  if (state.phase === 'port-in-use') return `Bridge not listening · port ${state.port} is already in use`
  if (state.phase === 'failed') return `Bridge failed · ${state.detail ?? 'no detail'}`
  return `Bridge stopped${state.detail ? ` · ${state.detail}` : ''}`
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
  const state = bridgeSnapshot()
  tray.setToolTip(`HostilePet · ${state.phase === 'listening' && state.peer ? 'extension connected' : 'not observing'}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'HostilePet · desktop scaffold', enabled: false },
    { label: 'Not observing · mock handler, no packs installed', enabled: false },
    { label: bridgeLine(), enabled: false },
    { type: 'separator' },
    { label: pet?.isVisible() ? 'Hide pet' : 'Show pet', click: () => { togglePet(!pet?.isVisible()) } },
    { label: 'Settings…', click: openSettings },
    { label: 'Pet preview', submenu: (['idle', 'thinking', 'speaking'] as const).map(value => ({
      label: value === 'idle' ? 'Idle / dismiss' : value === 'thinking' ? 'Thinking' : 'Text above pet',
      type: 'radio' as const, checked: preview === value, click: () => { previewPet(value) }
    })) },
    { type: 'separator' },
    { label: 'Quit HostilePet', click: () => { log('quit'); app.quit() } }
  ]))
}
function togglePet(visible: boolean): void {
  if (visible) pet?.showInactive(); else pet?.hide()
  log(visible ? 'show-pet' : 'hide-pet'); notify()
}
function previewPet(value: DesktopStatus['preview']): void {
  preview = value
  if (pet) {
    const bounds = pet.getBounds()
    const width = value === 'idle' ? 160 : 280
    const height = value === 'idle' ? 170 : 270
    pet.setBounds(fitInWorkArea({ x: bounds.x + Math.round((bounds.width - width) / 2),
      y: bounds.y + bounds.height - height, width, height }, screen.getDisplayMatching(bounds).workArea))
    pet.showInactive()
  }
  log(`preview-${value}`); notify()
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
  app.on('before-quit', () => { tray?.destroy(); tray = undefined })
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
      else if (command === 'quit') { log('quit'); app.quit() }
      else togglePet(command === 'show-pet')
    })
    const area = screen.getPrimaryDisplay().workArea
    // The bridge in this slice is a development surface: the admission check is `dev-open`
    // and the only handler is a mock. It therefore does not run in a packaged build — see
    // `docs/protocol.md` §1.2, which owns that decision.
    if (app.isPackaged) {
      bridgeOffReason = 'the development bridge is disabled in a packaged build; it returns when a real pack runtime does.'
      reportBridge({ event: 'bridge.failed', code: 'packaged', detail: bridgeOffReason })
    } else {
      bridge = createBridge({
        host: BRIDGE_HOST,
        port: BRIDGE_DEFAULT_PORT,
        security: 'dev-open',
        handler: createMockHandler(),
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
    tray = new Tray(icon); tray.setToolTip('HostilePet · not observing'); notify()
    await load(pet, 'pet')
  }).catch(report)
}
