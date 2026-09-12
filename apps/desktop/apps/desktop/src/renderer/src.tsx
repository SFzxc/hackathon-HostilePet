import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopAPI, DesktopCommand, DesktopStatus } from '../shared/desktop'
import { Pet } from './pet/Pet'
import './style.css'
declare global { interface Window { desktop: DesktopAPI } }
/**
 * What the settings window may say about Focus. It reports a reading or the reason there
 * is none — the one thing it may not do is turn "could not read" into "no Focus mode",
 * which is why the unread case has its own sentence rather than sharing the off one.
 */
function focusText(focus?: DesktopStatus['focus']): string {
  if (!focus) return 'Checking…'
  // Permission is the one cause a person can remove, so it gets the short sentence and the
  // button. Every other cause keeps its raw reason: "unreadable" with no detail is not a
  // diagnosis, and guessing "permission" would send the user to a switch that fixes nothing.
  if (focus.reason === 'permission') return 'Permission needed.'
  if (!focus.known) return focus.detail ? `Cannot read Focus mode: ${focus.detail}` : 'Cannot read Focus mode.'
  if (focus.active === true) {
    return `${focus.modeName ?? 'A Focus mode'} is on${focus.source === 'schedule' ? ', from its schedule' : ''}.`
  }
  return 'No Focus mode is on.'
}
function focusChip(focus?: DesktopStatus['focus']): string {
  if (!focus) return 'CHECKING'
  if (!focus.known) return focus.reason === 'permission' ? 'NO PERMISSION' : 'UNREADABLE'
  return focus.active === true ? 'FOCUS ON' : 'FOCUS OFF'
}
function App() {
  const [status, setStatus] = useState<DesktopStatus>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!window.desktop) { setError('Open this window in the desktop app.'); return }
    const unsubscribe = window.desktop.onStatus(setStatus)
    void window.desktop.status().then(setStatus).catch(() => { setError('Could not read desktop status.') })
    return unsubscribe
  }, [])
  const command = (value: DesktopCommand): void => {
    void window.desktop.command(value).catch(() => { setError('The desktop action could not complete. Please try again.') })
  }
  // The permission button appears for exactly one cause: macOS refusing the read. A sensor that
  // was switched off, or a database that is missing or malformed, is unread too — sending the
  // user to a permission switch for those would fix nothing.
  const needsPermission = status?.focus.reason === 'permission'
  // The pet's own line is the agent's. It always carries where it came from, and it can always
  // be dismissed — that escape is required of any intervention (`docs/agent.md` §8). A line
  // exists only when a model wrote one: there is no demo bubble and no stand-in copy to show in
  // its place (ADR 0011), so a pet with nothing to say is simply a pet with no bubble.
  const line = status?.petLine ?? null
  if (location.hash === '#pet') return <main className="pet-window">
    {line && <div className="speech agent" role="status">
      <div className="speech-heading"><span>HOSTILEPET · MODEL</span><button aria-label="Dismiss line" onClick={() => { command('dismiss-line') }}>×</button></div>
      <p>{line.say}</p>
    </div>}
    <div className="drag-pet" title="Drag to move · Settings in menu bar"><Pet expression={status?.petExpression ?? 'idle'}/></div>
    {error && <span role="alert">{error}</span>}
  </main>
  return <main className="settings"><header className="titlebar"><span className="wordmark">hostilepet<span className="period">.</span></span></header>
    <section className="intro"><div><h1>Meet your<br/><em>desktop companion.</em></h1><p className="lede">A place on your desktop.<br/>It follows your Focus mode.</p></div><div className="portrait"><Pet large/></div></section>
    <section className="preferences" aria-label="Desktop settings"><div className="row"><div><h2>Keep me around</h2><p>Show the pet on your desktop. Drag it to move.</p></div><button className={`switch ${status?.petVisible ? 'on' : ''}`} role="switch" aria-checked={status?.petVisible ?? false} aria-label="Show desktop pet" disabled={!status} onClick={() => { command(status?.petVisible ? 'hide-pet' : 'show-pet') }}><span/></button></div>
    <div className="row"><div><h2>Focus mode</h2><p>{focusText(status?.focus)}</p>{needsPermission && <p className="hint">macOS reads this permission when an app starts, so allow it, then quit and reopen.</p>}</div><div className="row-side"><span className="status"><i/>{focusChip(status?.focus)}</span>{needsPermission && <div className="row-actions"><button onClick={() => { command('open-focus-permission') }}>Grant permission…</button><button onClick={() => { command('relaunch') }}>Quit and reopen</button></div>}</div></div>
    <div className="row"><div><h2>Your space stays yours</h2><p>No browser pack and no commitment. Host names, how long one was looked at, and whether a Focus mode is on are read. Page content is not, and nothing leaves this machine.</p></div><span className="status"><i/>NO PACK</span></div></section>
    {error && <p className="error" role="alert">{error}</p>}
    <footer><button onClick={() => { command('quit') }}>Quit HostilePet ↗</button></footer>
  </main>
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<StrictMode><App/></StrictMode>)
