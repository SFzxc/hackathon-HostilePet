// Run with Electron against the built application. Uses a temporary user-data directory.
const { app, BrowserWindow } = require('electron')
const { mkdtemp, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const timeout = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1) }, 20000)
async function run() {
  app.setPath('userData', await mkdtemp(join(tmpdir(), 'hostilepet-smoke-')))
  require('../out/main/index.js')
  await app.whenReady()
  let pet
  for (let i = 0; i < 100; i++) {
    pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#pet'))
    if (pet && !pet.webContents.isLoading()) break
    await wait(100)
  }
  assert.ok(pet, 'pet window created')
  await wait(300)
  const read = () => pet.webContents.executeJavaScript('window.desktop.status()')
  assert.equal((await read()).character, 'placeholder')
  // The bridge transport is real and the kernel handler is real; what is missing is the pack
  // that would give either of them something to observe. Both facts are asserted, because
  // asserting only the first is how a missing pack starts reading as a working one.
  assert.equal((await read()).browser, 'no-pack-installed')
  assert.equal((await read()).handler, 'kernel')
  assert.equal((await read()).bridge.phase, 'listening',
    'expected the bridge listening on 54321; stop any other bridge:mock host holding that port first')
  assert.equal((await read()).bridge.peer, null)
  assert.equal((await read()).bridge.activeLeases, 0)
  assert.equal(pet.isAlwaysOnTop(), true)
  assert.equal(pet.isFocusable(), false)
  const boundary = await pet.webContents.executeJavaScript('({ node: typeof process, require: typeof require })')
  assert.deepEqual(boundary, { node: 'undefined', require: 'undefined' })
  await pet.webContents.executeJavaScript("window.desktop.command('hide-pet')")
  assert.equal((await read()).petVisible, false)
  await pet.webContents.executeJavaScript("window.desktop.command('show-pet')")
  assert.equal((await read()).petVisible, true)
  const initialBounds = pet.getBounds()
  pet.setPosition(initialBounds.x - 100, initialBounds.y)
  const originalBounds = pet.getBounds()
  // Nothing is previewed on demand and no model has run in this sandbox, so there is no bubble
  // and the window stays at its resting size. The example bubble that used to be asserted here
  // is gone by decision (ADR 0011) — the pet only speaks when a model gives it a line.
  assert.equal((await read()).petLine, null)
  assert.equal(await pet.webContents.executeJavaScript("!!document.querySelector('.speech')"), false)
  assert.deepEqual(pet.getBounds(), originalBounds)
  await writeFile(join(tmpdir(), 'hostilepet-pet.png'), (await pet.webContents.capturePage()).toPNG())
  assert.equal(await pet.webContents.executeJavaScript("!!document.querySelector('.placeholder-label')"), false)
  await pet.webContents.executeJavaScript("window.desktop.command('open-settings')")
  let settings
  for (let i = 0; i < 100; i++) {
    settings = BrowserWindow.getAllWindows().find(w => w !== pet)
    if (settings && !settings.webContents.isLoading()) break
    await wait(100)
  }
  assert.ok(settings)
  await wait(300)
  const copy = await settings.webContents.executeJavaScript('document.body.innerText')
  // The window may describe the transport and the log, never observation: no pack is installed,
  // so nothing can be watched, and no sentence may imply otherwise.
  assert.match(copy, /NO PACK/)
  assert.doesNotMatch(copy, /observing|Observing/)
  assert.doesNotMatch(copy, /could not|Could not/)
  await writeFile(join(tmpdir(), 'hostilepet-settings.png'), (await settings.webContents.capturePage()).toPNG())
  const closed = once(settings, 'closed')
  settings.close()
  await closed
  assert.equal(pet.isDestroyed(), false)
  assert.equal(BrowserWindow.getAllWindows().length, 1)
  console.info('PASS: sandbox, preload, real IPC, show/hide, settings, close-to-tray. Screenshot: ' + join(tmpdir(), 'hostilepet-settings.png'))
  clearTimeout(timeout)
  app.quit()
}
run().catch(error => { console.error(error); app.exit(1) })
