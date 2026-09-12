import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopAPI, DesktopCommand, DesktopStatus } from '../shared/desktop'
import './style.css'
declare global { interface Window { desktop: DesktopAPI } }
function Pet({ large = false, thinking = false }: { large?: boolean; thinking?: boolean }) {
  return <div className={`creature ${large ? 'large' : ''} ${thinking ? 'thinking' : ''}`} aria-label="Geometric placeholder pet"><div className="ear left"/><div className="ear right"/><div className="face"><i/><i/></div><div className="feet"><b/><b/></div></div>
}
/**
 * What the settings window may say about the bridge. It reports the transport, never
 * observation: the socket is real, the handler behind it is a mock, and no pack is
 * installed. Saying "connected" without a peer, or "monitoring" at all, would be the exact
 * overclaim `docs/hackathon.md` §4 forbids.
 */
function bridgeText(bridge?: DesktopStatus['bridge']): string {
  if (!bridge) return 'Reading bridge state…'
  if (bridge.phase === 'listening') {
    return bridge.peer
      ? `Extension v${bridge.peer.extensionVersion} is attached with ${bridge.peer.sensors} sensor(s) declared. ${bridge.activeLeases} active lease(s).`
      : `Waiting on ${bridge.host}:${bridge.port} for the browser extension. Nothing is being read yet.`
  }
  if (bridge.phase === 'port-in-use') return `Nothing is listening: port ${bridge.port} is already taken by another process.`
  if (bridge.phase === 'failed') return bridge.detail ?? 'The bridge could not start.'
  return bridge.detail ?? 'The bridge is stopped.'
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
  const preview = status?.preview ?? 'idle'
  if (location.hash === '#pet') return <main className="pet-window">
    {preview !== 'idle' && <div className="speech" role="status">
      <div className="speech-heading"><span>VISUAL DEMO</span><button aria-label="Dismiss preview" onClick={() => { command('preview-idle') }}>×</button></div>
      {preview === 'thinking' ? <p>Thinking<span className="thinking-dots" aria-hidden="true"><i/><i/><i/></span></p> : <p>Mình ở đây. Cứ làm việc của bạn đi.</p>}
    </div>}
    <div className="drag-pet" title="Drag to move · Settings in menu bar"><Pet thinking={preview === 'thinking'}/></div>
    {error && <span role="alert">{error}</span>}
  </main>
  return <main className="settings"><header className="titlebar"><span className="wordmark">hostilepet<span className="period">.</span></span><span className="build">DESKTOP / 0.1</span></header>
    <section className="intro"><div><p className="eyebrow">A LITTLE PRESENCE. YOUR OWN RULES.</p><h1>Meet your<br/><em>desktop companion.</em></h1><p className="lede">A place on your desktop.<br/>Nothing watching in the background.</p></div><div className="portrait"><Pet large/><span>CHARACTER STUDY / PLACEHOLDER</span></div></section>
    <section className="preferences" aria-label="Desktop settings"><div className="row"><div><h2>Keep me around</h2><p>Show the pet on your desktop. Drag it to move.</p></div><button className={`switch ${status?.petVisible ? 'on' : ''}`} role="switch" aria-checked={status?.petVisible ?? false} aria-label="Show desktop pet" disabled={!status} onClick={() => { command(status?.petVisible ? 'hide-pet' : 'show-pet') }}><span/></button></div>
    <div className="row"><div><h2>Your space stays yours</h2><p>No sensors, commitments or model connections yet.</p></div><span className="status"><i/>NOT OBSERVING</span></div>
    <div className="row"><div><h2>Browser bridge</h2><p>{bridgeText(status?.bridge)}</p></div><span className="status"><i/>MOCK HANDLER</span></div></section>
    <section className="preview-controls" aria-label="Pet visual preview"><div><h2>Try an expression</h2><p>Visual demo only · no model request.</p></div><div className="preview-buttons">{(['idle', 'thinking', 'speaking'] as const).map(value => <button key={value} aria-pressed={preview === value} onClick={() => { command(`preview-${value}`) }}>{value === 'speaking' ? 'Text above' : value === 'thinking' ? 'Thinking' : 'Idle'}</button>)}</div></section>
    <section className="coming"><span className="index">01 — FOUNDATION</span><p>The desktop shell is here. Browser packs, the agent and the Live2D character are still to come.</p></section>
    {error && <p className="error" role="alert">{error}</p>}
    <footer><span>Local shell. No account required.</span><button onClick={() => { command('quit') }}>Quit HostilePet ↗</button></footer>
  </main>
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<StrictMode><App/></StrictMode>)
