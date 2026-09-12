#!/usr/bin/env node
/**
 * HostilePet — macOS Focus mode reader (local demo POC).
 *
 * Reads the current macOS Focus / Do Not Disturb state from the system
 * DoNotDisturb database. This is the only route that exposes the *mode name*
 * ("Work", "Sleep", …); Apple ships no public API for that.
 *
 * Requirements: Full Disk Access for the process that runs this file.
 *   - via Terminal:      grant FDA to Terminal.app
 *   - via Electron dev:  grant FDA to node_modules/electron/dist/Electron.app
 *   - packaged app:      grant FDA to HostilePet.app
 * Then QUIT and relaunch that app — TCC changes do not apply to a running process.
 *
 * Run `node scripts/focus-state.cjs --doctor` to see exactly which binary needs it.
 * Run `node scripts/focus-state.cjs --selftest` to verify the parsing logic
 * without any permission (uses fixtures).
 *
 * The database schema is undocumented and Apple has changed it across releases.
 * Everything here is written defensively; `--dump` prints the real structure so
 * the parser can be corrected against the machine it runs on.
 *
 * CLI:
 *   (no args)        one line, human readable
 *   --json           machine readable state
 *   --watch[=MS]     poll (default 2000ms) and print transitions
 *   --doctor         check permissions and report which binary needs FDA
 *   --dump           print the shape of both database files
 *   --fixture <dir>  read from <dir> instead of the system database
 *   --selftest       run the pure-logic fixtures and exit
 *   --grant          open the Full Disk Access settings pane
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_DB_DIR = path.join(os.homedir(), 'Library', 'DoNotDisturb', 'DB');
const ASSERTIONS_FILE = 'Assertions.json';
const MODE_CONFIGS_FILE = 'ModeConfigurations.json';

/** CFAbsoluteTime epoch (2001-01-01T00:00:00Z) in Unix milliseconds. */
const MAC_EPOCH_MS = 978307200000;

// ---------------------------------------------------------------------------
// Pure logic — no filesystem, no clock. Everything below is unit-testable.
// ---------------------------------------------------------------------------

/** Both files wrap their payload in `data: [store]`. */
function firstStore(json) {
  if (!json || !Array.isArray(json.data) || json.data.length === 0) return null;
  return json.data[0] ?? null;
}

/** Accepts a CFAbsoluteTime (seconds since 2001), Unix milliseconds, or an ISO string. */
function toUnixMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // DND stores CFAbsoluteTime (~8e8 today). Anything above 1e11 is already
    // Unix milliseconds (~1.8e12), which some builds use instead.
    return value > 1e11 ? value : value * 1000 + MAC_EPOCH_MS;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** A lifetime of 0 / missing / infinite means "until turned off". */
function lifetimeDurationSeconds(details) {
  const candidates = [
    details?.assertionDuration,
    details?.assertionLifetime?.lifetimeDuration,
    details?.lifetimeDuration,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      // Absurdly large values are how "indefinite" is spelled in some builds.
      if (candidate >= 315360000) return null;
      return candidate;
    }
  }
  return null;
}

/**
 * Active manual assertions. A schedule-driven Focus does NOT appear here.
 * Returns records newest-first, with `active` computed from the lifetime.
 */
function parseAssertionRecords(assertionsJson, now = Date.now()) {
  const store = firstStore(assertionsJson);
  const records = store?.storeAssertionRecords;
  if (!Array.isArray(records)) return [];

  const parsed = [];
  for (const record of records) {
    const details = record?.assertionDetails ?? record;
    const modeId = details?.assertionDetailsModeIdentifier;
    if (typeof modeId !== 'string' || modeId.length === 0) continue;

    const startMs = toUnixMs(details?.assertionStartDate ?? record?.assertionStartDate);
    const durationSec = lifetimeDurationSeconds(details);
    const expiresMs = startMs !== null && durationSec !== null ? startMs + durationSec * 1000 : null;

    parsed.push({
      modeId,
      uuid: record?.assertionUUID ?? null,
      startMs,
      expiresMs,
      active: expiresMs === null || now < expiresMs,
    });
  }

  parsed.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));
  return parsed;
}

/** `enabledSetting`: 0 = off, 1 = on, 2 = on (custom schedule). */
function triggerEnabled(enabledSetting) {
  return enabledSetting === 1 || enabledSetting === 2;
}

/**
 * `timePeriodRepeatOn` is a weekday bitmask with Sunday as bit 0,
 * e.g. 62 = Mon–Fri, 127 = every day. Missing means "every day".
 */
function repeatMatchesDay(repeatOn, day) {
  if (Array.isArray(repeatOn)) return repeatOn.map(Number).includes(day);
  if (typeof repeatOn === 'number' && Number.isFinite(repeatOn)) {
    return (repeatOn & (1 << day)) !== 0;
  }
  return true;
}

function minutesOfDay(hour, minute) {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Half-open window; wraps past midnight when start > end. */
function withinWindow(minutes, start, end) {
  if (start === null || end === null || start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

/**
 * Day a wrapping window belongs to: a 23:00–07:00 window that is still running
 * at 01:00 on Tuesday was started on Monday, so Monday's repeat bit decides.
 */
function windowStartDay(day, minutes, start, end) {
  if (start !== null && end !== null && start > end && minutes < end) return (day + 6) % 7;
  return day;
}

/** Schedule-driven modes that should be on right now (heuristic). */
function scheduleCandidates(modeConfigurations, now = Date.now()) {
  const date = new Date(now);
  const day = date.getDay();
  const minutes = date.getHours() * 60 + date.getMinutes();
  const hits = [];

  for (const [modeId, config] of Object.entries(modeConfigurations ?? {})) {
    const triggers = config?.triggers?.triggers;
    if (!Array.isArray(triggers)) continue;

    for (const trigger of triggers) {
      if (!triggerEnabled(trigger?.enabledSetting)) continue;
      const start = minutesOfDay(trigger?.timePeriodStartTimeHour, trigger?.timePeriodStartTimeMinute);
      const end = minutesOfDay(trigger?.timePeriodEndTimeHour, trigger?.timePeriodEndTimeMinute);
      if (start === null || end === null) continue;
      if (!repeatMatchesDay(trigger?.timePeriodRepeatOn, windowStartDay(day, minutes, start, end))) continue;
      if (!withinWindow(minutes, start, end)) continue;
      hits.push({ modeId, name: config?.mode?.name ?? null });
    }
  }
  return hits;
}

/**
 * @returns {{active: boolean, modeId: string|null, modeName: string|null,
 *            source: 'assertion'|'schedule'|null, candidates: object[]}}
 */
function deriveFocusState({ assertionsJson = null, modeConfigsJson = null } = {}, now = Date.now()) {
  const modeConfigurations = firstStore(modeConfigsJson)?.modeConfigurations ?? {};
  const nameOf = (modeId) => modeConfigurations?.[modeId]?.mode?.name ?? null;

  const assertions = parseAssertionRecords(assertionsJson, now);
  const activeAssertion = assertions.find((record) => record.active);

  if (activeAssertion) {
    const scheduled = scheduleCandidates(modeConfigurations, now).map((hit) => hit.modeId);
    return {
      active: true,
      modeId: activeAssertion.modeId,
      modeName: nameOf(activeAssertion.modeId),
      source: 'assertion',
      // A manual assertion can coincide with a scheduled window; keep it visible.
      candidates: [{ modeId: activeAssertion.modeId, source: 'assertion' },
        ...scheduled.map((modeId) => ({ modeId, source: 'schedule' }))],
    };
  }

  const scheduled = scheduleCandidates(modeConfigurations, now);
  if (scheduled.length > 0) {
    return {
      active: true,
      modeId: scheduled[0].modeId,
      modeName: scheduled[0].name,
      source: 'schedule',
      candidates: scheduled.map(({ modeId }) => ({ modeId, source: 'schedule' })),
    };
  }

  return { active: false, modeId: null, modeName: null, source: null, candidates: [] };
}

// ---------------------------------------------------------------------------
// Change detection — this is what turns "state" into an event.
// ---------------------------------------------------------------------------

/** Everything that makes a transition worth emitting. */
function transitionKey(state) {
  return JSON.stringify([state.known, state.active, state.modeId, state.source]);
}

function isTransition(previous, next) {
  return previous === null || transitionKey(previous) !== transitionKey(next);
}

/**
 * Watches Focus state and calls `onChange(next, previous)` on transitions only.
 *
 * Two triggers feed the same check:
 *   - `fs.watch` on the database directory — near-instant, but the DND files are
 *     rewritten quickly and a read can land mid-write, and TCC may refuse the
 *     watch outright;
 *   - a poll interval as the safety net.
 * A read that fails right after a filesystem event is retried before it is
 * allowed to emit, so a torn read cannot masquerade as "Focus turned off".
 */
function startFocusWatcher({
  dbDir = DEFAULT_DB_DIR,
  intervalMs = 2000,
  useFsWatch = true,
  retryDelayMs = 150,
  retries = 3,
  onChange = () => {},
  onError = () => {},
  initial = true,
} = {}) {
  let current = readFocusState({ dbDir });
  let stopped = false;
  let watcher = null;
  let timer = null;

  const check = (attempt = 0) => {
    if (stopped) return;
    const next = readFocusState({ dbDir });

    // A read that failed while we previously had an answer is more likely a
    // torn write than a real change: retry before emitting.
    if (next.known === false && current.known !== false && attempt < retries) {
      setTimeout(() => check(attempt + 1), retryDelayMs);
      return;
    }
    if (!isTransition(current, next)) return;
    const previous = current;
    current = next;
    onChange(next, previous);
  };

  if (useFsWatch) {
    try {
      watcher = fs.watch(dbDir, { persistent: true }, () => check());
      watcher.on('error', (error) => onError(error));
    } catch (error) {
      onError(error);
      watcher = null;
    }
  }
  timer = setInterval(() => check(), intervalMs);

  if (initial) onChange(current, null);

  return {
    get state() {
      return current;
    },
    get mode() {
      return watcher ? 'fs.watch+poll' : 'poll';
    },
    stop() {
      stopped = true;
      if (watcher) watcher.close();
      if (timer) clearInterval(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readFocusState({ dbDir = DEFAULT_DB_DIR, now = Date.now() } = {}) {
  const assertionsPath = path.join(dbDir, ASSERTIONS_FILE);
  const modeConfigsPath = path.join(dbDir, MODE_CONFIGS_FILE);
  const result = { dbDir, assertionsPath, modeConfigsPath, errors: [] };

  for (const [key, filePath] of [['assertionsJson', assertionsPath], ['modeConfigsJson', modeConfigsPath]]) {
    try {
      result[key] = readJsonFile(filePath);
    } catch (error) {
      result[key] = null;
      result.errors.push({ file: filePath, code: error.code ?? 'UNKNOWN', message: error.message });
    }
  }

  const degraded = result.errors.length > 0;

  // Without Assertions.json we cannot tell whether Focus is on. Report that
  // honestly instead of claiming "off" — see the never-fabricate rule.
  if (result.assertionsJson === null) {
    return { ...result, known: false, degraded, active: null, modeId: null, modeName: null, source: null, candidates: [] };
  }

  // Losing ModeConfigurations.json still leaves a trustworthy on/off answer,
  // but mode names may be missing.
  return { ...result, known: true, degraded, ...deriveFocusState(result, now) };
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Nearest enclosing .app bundle — that is what TCC wants in the FDA list. */
function enclosingAppBundle(execPath) {
  const parts = execPath.split(path.sep);
  const appIndex = parts.findIndex((part) => part.endsWith('.app'));
  if (appIndex === -1) return null;
  return parts.slice(0, appIndex + 1).join(path.sep);
}

/**
 * TCC attributes a bare binary to the app that launched it, so the FDA entry
 * has to name that app rather than the binary itself.
 */
/** TERM_PROGRAM values we know, mapped to the bundle TCC charges for this process. */
const TERMINAL_APPS = {
  Apple_Terminal: '/System/Applications/Utilities/Terminal.app',
  'iTerm.app': '/Applications/iTerm.app',
  iTerm: '/Applications/iTerm.app',
  vscode: '/Applications/Visual Studio Code.app',
  WezTerm: '/Applications/WezTerm.app',
  ghostty: '/Applications/Ghostty.app',
  Hyper: '/Applications/Hyper.app',
};

const APP_SEARCH_DIRS = ['/Applications', '/System/Applications/Utilities'];

/**
 * Resolve a TERM_PROGRAM nobody enumerated by finding the installed bundle it names, so
 * the answer stays a real path instead of a plausible-looking guess.
 */
function findAppByName(name) {
  const wanted = name.replace(/\.app$/i, '').toLowerCase();
  if (wanted.length < 3) return null;
  for (const dir of APP_SEARCH_DIRS) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue;
      const base = entry.slice(0, -4).toLowerCase();
      if (base === wanted || base.startsWith(wanted)) return path.join(dir, entry);
    }
  }
  return null;
}

function fdaTarget({ execPath = process.execPath, env = process.env } = {}) {
  const bundle = enclosingAppBundle(execPath);
  if (bundle) return { target: bundle, reason: 'this process already runs from an app bundle' };

  const program = env.TERM_PROGRAM;
  if (typeof program === 'string' && program.length > 0) {
    const mapped = TERMINAL_APPS[program];
    if (mapped && fs.existsSync(mapped)) {
      return { target: mapped, reason: `launched from ${program}, so TCC attributes access to it` };
    }
    const found = findAppByName(program);
    if (found) return { target: found, reason: `launched from ${program}, so TCC attributes access to it` };
  }

  return { target: null, reason: 'no enclosing app bundle and no known terminal host' };
}

/**
 * The Electron package sits *below* the workspace root that holds this script
 * (<repo>/apps/desktop/apps/desktop), so walking up alone never finds it.
 * Check each ancestor, then its `apps/*` children.
 */
function findDesktopDir(startDir = __dirname, maxLevels = 6) {
  const looksLikeApp = (dir) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      return pkg?.name === '@hostile-pet/desktop' || Boolean(pkg?.build?.appId);
    } catch {
      return false;
    }
  };
  const scan = (dir) => {
    for (const root of [dir, path.join(dir, 'apps')]) {
      if (looksLikeApp(root)) return root;
      let entries;
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const child = path.join(root, entry.name);
        if (looksLikeApp(child)) return child;
      }
    }
    return null;
  };

  let dir = startDir;
  for (let level = 0; level < maxLevels; level += 1) {
    const found = scan(dir);
    if (found) return found;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir, '..');
}

/**
 * Every .app a local demo might need in the Full Disk Access list.
 * Granting the host app makes the CLI work; granting the bundle makes the pet work.
 */
function fdaCandidates({ desktopDir = findDesktopDir(), env = process.env, execPath = process.execPath } = {}) {
  const candidates = [];
  const seen = new Set();
  const push = (target, label) => {
    if (!target || seen.has(target)) return;
    seen.add(target);
    candidates.push({ path: target, label, exists: fs.existsSync(target) });
  };

  const attributed = fdaTarget({ execPath, env });
  if (attributed.target) push(attributed.target, `runs this process — ${attributed.reason}`);

  // electron-builder --dir output: release/mac*/<productName>.app
  try {
    const releaseDir = path.join(desktopDir, 'release');
    for (const entry of fs.readdirSync(releaseDir)) {
      if (!entry.startsWith('mac')) continue;
      const platformDir = path.join(releaseDir, entry);
      for (const app of fs.readdirSync(platformDir)) {
        if (app.endsWith('.app')) push(path.join(platformDir, app), 'local packaged build — grant this for the pet app');
      }
    }
  } catch {
    // release/ does not exist yet — run `pnpm package` first.
  }

  push(path.join(desktopDir, 'node_modules', 'electron', 'dist', 'Electron.app'), 'pnpm dev — the running process is Electron, not your bundle');
  push(path.join(desktopDir, '..', '..', 'node_modules', 'electron', 'dist', 'Electron.app'), 'pnpm dev, hoisted install at the workspace root');
  push('/Applications/HostilePet.app', 'only if you copied a build there');
  return candidates;
}

const FDA_HINT =
  'Full Disk Access is required, and TCC only applies it to a freshly started process. ' +
  'Grant it, then QUIT and relaunch the app that runs this script.';

function diagnose({ dbDir = DEFAULT_DB_DIR } = {}) {
  const bundle = enclosingAppBundle(process.execPath);
  const attributed = fdaTarget();
  const candidates = fdaCandidates();
  const lines = [];
  lines.push(`script        : ${__filename}`);
  lines.push(`node/electron : ${process.execPath}`);
  lines.push(`app bundle    : ${bundle ?? '(none)'}`);
  lines.push(`database dir  : ${dbDir}`);
  lines.push('');

  let blocked = false;
  for (const file of [ASSERTIONS_FILE, MODE_CONFIGS_FILE]) {
    const filePath = path.join(dbDir, file);
    if (!fs.existsSync(filePath)) {
      lines.push(`✗ ${file}: not found at ${filePath}`);
      continue;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      lines.push(`✓ ${file}: readable (${raw.length} bytes)`);
    } catch (error) {
      blocked = true;
      lines.push(`✗ ${file}: ${error.code} — ${error.message}`);
    }
  }

  lines.push('');
  if (!blocked) {
    lines.push('Verdict: readable. Run without --doctor to read the current Focus state.');
    return { blocked, bundle, candidates, report: lines.join('\n') };
  }

  lines.push(`Verdict: ${FDA_HINT}`);
  lines.push('');
  lines.push('Grant Full Disk Access to one of these (System Settings → Privacy & Security → Full Disk Access):');
  for (const candidate of candidates) {
    const mark = candidate.exists ? '✓' : '✗';
    const suffix = candidate.exists ? '' : '  (does not exist — build it first)';
    lines.push(`  ${mark} ${candidate.path}`);
    lines.push(`      ${candidate.label}${suffix}`);
  }

  const primary = primaryGrantCandidate(candidates);
  if (primary?.exists) {
    const signature = inspectSignature(primary.path);
    if (signature) {
      lines.push('');
      lines.push(`signature of the primary bundle: ${signature.signature ?? 'unknown'} (Identifier=${signature.identifier})`);
      if (signature.adhoc) {
        lines.push('  ↳ An ad-hoc signed bundle is listed under that identifier and its grant may not');
        lines.push('    stick. Re-sign it so the entry is stable and reads as your app:');
        lines.push(`      codesign --force --deep --sign - "${primary.path}"`);
      }
    }
  }

  const installed = candidates.find((candidate) => candidate.kind === 'installed' && candidate.exists);
  const packaged = candidates.find((candidate) => candidate.kind === 'packaged' && candidate.exists);
  if (installed && packaged) {
    const installedSignature = inspectSignature(installed.path);
    const packagedSignature = inspectSignature(packaged.path);
    if (installedSignature?.cdhash && packagedSignature?.cdhash && installedSignature.cdhash !== packagedSignature.cdhash) {
      lines.push('');
      lines.push('⚠ The installed copy differs from the fresh build in release/ — you would be');
      lines.push('  launching the older binary. Replace it, then grant access again:');
      lines.push(`      rm -rf "${installed.path}" && cp -R "${packaged.path}" /Applications/`);
    }
  }

  lines.push('');
  lines.push('After granting: QUIT and relaunch that app — TCC does not apply to a running process.');
  lines.push('Open the pane with: node scripts/focus-state.cjs --grant');
  return { blocked, bundle, candidates, report: lines.join('\n') };
}

/**
 * A `--dir` build with `identity: null` is never re-signed, so the bundle keeps
 * Electron's own ad-hoc signature. TCC then sees the app as "Electron" and the
 * designated requirement is too weak to hold a Full Disk Access grant.
 */
function inspectSignature(appPath) {
  try {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const identifier = /^Identifier=(.+)$/m.exec(output)?.[1]?.trim() ?? null;
    const signature = /^Signature=(.+)$/m.exec(output)?.[1]?.trim() ?? null;
    const flags = /flags=([^\n]+)/.exec(output)?.[1]?.trim() ?? null;
    const cdhash = /^CDHash=(.+)$/m.exec(output)?.[1]?.trim() ?? null;
    if (!identifier) return null;
    return { identifier, signature, flags, cdhash, adhoc: signature === 'adhoc' || /adhoc/.test(flags ?? '') };
  } catch {
    return null;
  }
}

function readProductName(desktopDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
    return pkg?.build?.productName ?? 'HostilePet';
  } catch {
    return 'HostilePet';
  }
}

/**
 * Every .app a local demo might need in the Full Disk Access list.
 * Order is the order the doctor reports them, installed app first.
 */
function fdaCandidates({ desktopDir = findDesktopDir(), env = process.env, execPath = process.execPath } = {}) {
  const candidates = [];
  const seen = new Set();
  const push = (target, kind, label) => {
    if (!target || seen.has(target)) return;
    seen.add(target);
    candidates.push({ path: target, kind, label, exists: fs.existsSync(target) });
  };

  const productName = readProductName(desktopDir);
  const installed = path.join('/Applications', `${productName}.app`);
  push(installed, 'installed', fs.existsSync(installed) ? 'installed app — this is the copy you run, grant this' : 'not installed yet — `pnpm package` then copy the build here');

  // electron-builder --dir output: release/mac*/<productName>.app
  try {
    const releaseDir = path.join(desktopDir, 'release');
    for (const entry of fs.readdirSync(releaseDir)) {
      if (!entry.startsWith('mac')) continue;
      const platformDir = path.join(releaseDir, entry);
      for (const app of fs.readdirSync(platformDir)) {
        if (app.endsWith('.app')) push(path.join(platformDir, app), 'packaged', 'local packaged build — grant this for the pet app');
      }
    }
  } catch {
    // release/ does not exist yet — run `pnpm package` first.
  }

  const attributed = fdaTarget({ execPath, env });
  if (attributed.target) push(attributed.target, 'host', `runs this process — ${attributed.reason}`);

  push(path.join(desktopDir, 'node_modules', 'electron', 'dist', 'Electron.app'), 'dev', 'pnpm dev — the running process is Electron, not your bundle');
  push(path.join(desktopDir, '..', '..', 'node_modules', 'electron', 'dist', 'Electron.app'), 'dev', 'pnpm dev, hoisted install at the workspace root');
  return candidates;
}

/** The entry most likely to make the local demo work. The installed app wins:
 * TCC records a grant per path, so granting the build output does nothing for
 * the copy you actually launch from /Applications.
 */
const KIND_ORDER = ['installed', 'packaged', 'host', 'dev'];
function primaryGrantCandidate(candidates) {
  for (const kind of KIND_ORDER) {
    const match = candidates.find((candidate) => candidate.exists && candidate.kind === kind);
    if (match) return match;
  }
  return candidates[0] ?? null;
}

/**
 * The app TCC actually charges for *this* process — the one that launched it, not the
 * package being developed. Granting this unblocks the CLI; the pet app needs its own
 * entry, because a grant is recorded per path. Null when the host cannot be identified,
 * which is better than naming an app that would not help.
 */
function grantTargetForThisProcess() {
  return fdaCandidates().find((candidate) => candidate.kind === 'host' && candidate.exists) ?? null;
}

/**
 * Printed when the database cannot be read. Without it the only feedback is a bare
 * `EPERM`, which reads like a broken tool rather than a missing permission.
 */
function printPermissionHelp() {
  const target = grantTargetForThisProcess();
  console.error('');
  console.error('Cannot read the Focus database — macOS is refusing access (TCC).');
  console.error('Full Disk Access is required for the app that runs this command:');
  if (target) {
    console.error(`  ${target.path}`);
    console.error(`      ${target.label}`);
  } else {
    console.error('  (could not tell which app launched this process)');
    console.error('  Grant it to whatever you are running this from — Terminal, iTerm, VS Code, Warp, …');
  }
  console.error('  1. System Settings → Privacy & Security → Full Disk Access → add that app');
  console.error('  2. QUIT it completely and reopen it — TCC does not apply to a running process');
  console.error('  3. Run this command again, and confirm with: node scripts/focus-state.cjs --doctor');
  console.error('');
}

function dumpShape(json, depth = 0, maxDepth = 3) {
  const pad = '  '.repeat(depth);
  if (json === null) return `${pad}null`;
  if (Array.isArray(json)) {
    if (json.length === 0) return `${pad}[]`;
    const head = json.slice(0, 2).map((entry) => dumpShape(entry, depth + 1, maxDepth));
    return `${pad}[ ${json.length} item(s)\n${head.join('\n')}\n${pad}]`;
  }
  if (typeof json === 'object') {
    if (depth >= maxDepth) return `${pad}{ … }`;
    return Object.entries(json)
      .map(([key, value]) => `${pad}${key}: ${dumpShape(value, depth + 1, maxDepth)}`)
      .join('\n');
  }
  if (typeof json === 'string') return `${pad}"${json.length > 60 ? `${json.slice(0, 60)}…` : json}"`;
  return `${pad}${String(json)}`;
}

// ---------------------------------------------------------------------------
// Self test — runs the pure logic against fixtures. No permissions needed.
// ---------------------------------------------------------------------------

async function selftest() {
  const failures = [];
  const check = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = predicate();
      if (value) return value;
      if (Date.now() > deadline) return null;
      await delay(50);
    }
  };

  const modeConfigs = {
    data: [{
      modeConfigurations: {
        'mode.work': {
          mode: { name: 'Work' },
          triggers: { triggers: [{ enabledSetting: 2, timePeriodStartTimeHour: 9, timePeriodStartTimeMinute: 0, timePeriodEndTimeHour: 17, timePeriodEndTimeMinute: 0, timePeriodRepeatOn: 62 }] },
        },
        'mode.sleep': {
          mode: { name: 'Sleep' },
          triggers: { triggers: [{ enabledSetting: 2, timePeriodStartTimeHour: 23, timePeriodStartTimeMinute: 0, timePeriodEndTimeHour: 7, timePeriodEndTimeMinute: 0, timePeriodRepeatOn: 127 }] },
        },
        'mode.off': {
          mode: { name: 'Disabled' },
          triggers: { triggers: [{ enabledSetting: 0, timePeriodStartTimeHour: 0, timePeriodStartTimeMinute: 0, timePeriodEndTimeHour: 23, timePeriodEndTimeMinute: 59, timePeriodRepeatOn: 127 }] },
        },
      },
    }],
  };

  // 2026-09-14 is a Monday.
  const monday10am = new Date(2026, 8, 14, 10, 0, 0).getTime();
  const monday20pm = new Date(2026, 8, 14, 20, 0, 0).getTime();
  const saturday10am = new Date(2026, 8, 19, 10, 0, 0).getTime();
  const tuesday1am = new Date(2026, 8, 15, 1, 0, 0).getTime();

  check('schedule: Monday 10:00 → Work', deriveFocusState({ modeConfigsJson: modeConfigs }, monday10am).modeName, 'Work');
  check('schedule: Monday 20:00 → off', deriveFocusState({ modeConfigsJson: modeConfigs }, monday20pm).active, false);
  check('schedule: Saturday 10:00 → off (repeat mask)', deriveFocusState({ modeConfigsJson: modeConfigs }, saturday10am).active, false);
  check('schedule: Tuesday 01:00 → Sleep (wraps midnight)', deriveFocusState({ modeConfigsJson: modeConfigs }, tuesday1am).modeName, 'Sleep');

  // Assertions: CFAbsoluteTime, one expired and one live.
  const now = new Date(2026, 8, 14, 12, 0, 0).getTime();
  const nowMac = now / 1000 - MAC_EPOCH_MS / 1000;
  const assertions = {
    data: [{
      storeAssertionRecords: [
        { assertionUUID: 'stale', assertionDetails: { assertionDetailsModeIdentifier: 'mode.sleep', assertionStartDate: nowMac - 7200, assertionDuration: 3600 } },
        { assertionUUID: 'live', assertionDetails: { assertionDetailsModeIdentifier: 'mode.work', assertionStartDate: nowMac - 60, assertionDuration: 1800 } },
      ],
    }],
  };
  const fromAssertion = deriveFocusState({ assertionsJson: assertions, modeConfigsJson: modeConfigs }, now);
  check('assertion: expired record ignored, live one wins', [fromAssertion.modeName, fromAssertion.source], ['Work', 'assertion']);

  const expiredOnly = {
    data: [{ storeAssertionRecords: [{ assertionDetails: { assertionDetailsModeIdentifier: 'mode.sleep', assertionStartDate: nowMac - 7200, assertionDuration: 3600 } }] }],
  };
  // No mode configs here on purpose: `now` is Monday 12:00, inside the Work
  // schedule window, which would otherwise keep the state active.
  check('assertion: all expired → off', deriveFocusState({ assertionsJson: expiredOnly, modeConfigsJson: null }, now).active, false);

  const indefinite = {
    data: [{ storeAssertionRecords: [{ assertionDetails: { assertionDetailsModeIdentifier: 'mode.sleep', assertionStartDate: nowMac - 7200 } }] }],
  };
  check('assertion: no duration → indefinite', deriveFocusState({ assertionsJson: indefinite, modeConfigsJson: modeConfigs }, now).modeName, 'Sleep');

  check('repeat mask 62 excludes Sunday', [repeatMatchesDay(62, 0), repeatMatchesDay(62, 1), repeatMatchesDay(62, 6)], [false, true, false]);
  check('window wraps midnight', [withinWindow(60, 1380, 420), withinWindow(1380, 1380, 420), withinWindow(420, 1380, 420)], [true, true, false]);

  // The event path: drive a real directory and assert transitions are emitted.
  // Uses a trigger-free mode config so the result does not depend on wall-clock time.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostilepet-focus-'));
  try {
    fs.writeFileSync(
      path.join(dir, MODE_CONFIGS_FILE),
      JSON.stringify({ data: [{ modeConfigurations: { 'mode.work': { mode: { name: 'Work' } } } }] }),
    );
    const writeAssertions = (records) =>
      fs.writeFileSync(path.join(dir, ASSERTIONS_FILE), JSON.stringify({ data: [{ storeAssertionRecords: records }] }));
    const liveAssertion = () => [{
      assertionUUID: 'live',
      assertionDetails: {
        assertionDetailsModeIdentifier: 'mode.work',
        assertionStartDate: Date.now() / 1000 - MAC_EPOCH_MS / 1000,
        assertionDuration: 3600,
      },
    }];
    writeAssertions([]);

    const seen = [];
    const watcher = startFocusWatcher({
      dbDir: dir,
      intervalMs: 120,
      onChange: (next, previous) => seen.push({ active: next.active, modeName: next.modeName, initial: previous === null }),
    });

    await waitFor(() => seen.length >= 1, 2000);
    check('events: initial state emitted once', [seen.length, seen[0]?.initial], [1, true]);

    writeAssertions(liveAssertion());
    const on = await waitFor(() => seen.find((entry) => entry.active === true), 4000);
    check('events: focus turns on', on ? [on.active, on.modeName] : null, [true, 'Work']);

    writeAssertions([]);
    const off = await waitFor(() => seen.filter((entry) => entry.active === false).length >= 2, 4000);
    check('events: focus turns off', Boolean(off), true);
    check('events: no duplicate emissions', seen.length, 3);

    watcher.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`selftest FAILED (${failures.length})`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    return 1;
  }
  console.log('selftest passed: 13 checks (schedules, midnight wrap, repeat mask, assertion expiry, change events)');
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { watch: false, intervalMs: 2000, json: false, dbDir: DEFAULT_DB_DIR };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--doctor') options.mode = 'doctor';
    else if (arg === '--dump') options.mode = 'dump';
    else if (arg === '--selftest') options.mode = 'selftest';
    else if (arg === '--grant') options.mode = 'grant';
    else if (arg === '--events') options.mode = 'events';
    else if (arg.startsWith('--events=')) {
      options.intervalMs = Math.max(250, Number(arg.slice('--events='.length)) || 2000);
      options.mode = 'events';
    } else if (arg === '--poll-only') options.useFsWatch = false;
    else if (arg === '--watch') options.watch = true;
    else if (arg.startsWith('--watch=')) {
      options.watch = true;
      options.intervalMs = Math.max(500, Number(arg.slice('--watch='.length)) || 2000);
    } else if (arg.startsWith('--now=')) {
      const parsed = Date.parse(arg.slice('--now='.length));
      if (Number.isNaN(parsed)) {
        console.error(`--now expects an ISO date, got: ${arg.slice('--now='.length)}`);
        options.mode = 'help';
      } else options.now = parsed;
    } else if (arg.startsWith('--fixture=')) options.dbDir = arg.slice('--fixture='.length);
    else if (arg === '--fixture') options.expectFixture = true;
    else if (options.expectFixture) {
      options.dbDir = arg;
      options.expectFixture = false;
    } else if (arg === '--help' || arg === '-h') options.mode = 'help';
    else {
      console.error(`unknown argument: ${arg}`);
      options.mode = 'help';
    }
  }
  return options;
}

const HELP = `HostilePet — macOS Focus mode reader (local demo POC)

  node scripts/focus-state.cjs                 current state, one line
  node scripts/focus-state.cjs --json          machine readable
  node scripts/focus-state.cjs --events[=MS]   NDJSON event per transition (default poll 2000ms)
  node scripts/focus-state.cjs --watch[=MS]    print transitions as text
  node scripts/focus-state.cjs --doctor        which binary needs Full Disk Access
  node scripts/focus-state.cjs --dump          print the database shape
  node scripts/focus-state.cjs --grant         open the Full Disk Access pane
  node scripts/focus-state.cjs --selftest      verify parsing and event logic, no permission
  node scripts/focus-state.cjs --fixture=DIR   read a copy of the DB instead
  node scripts/focus-state.cjs --now=ISO       evaluate the schedule at a fixed time
                                               e.g. --now=2026-09-14T10:00:00
  --poll-only                                  skip fs.watch, poll only`;

/**
 * The payload the pet reacts to. Shape follows the kernel signal convention
 * `signal.<packId>.<name>`: this becomes `signal.hp.focus-mode.changed`.
 */
function toFocusEvent(state, previous, at = Date.now()) {
  return {
    type: 'focus.changed',
    at: new Date(at).toISOString(),
    initial: previous === null,
    known: state.known,
    active: state.active,
    modeId: state.modeId,
    modeName: state.modeName,
    source: state.source,
  };
}

function formatState(state, { json }) {
  if (json) return JSON.stringify(state, null, 2);
  if (state.known === false) {
    const codes = (state.errors ?? []).map((error) => `${path.basename(error.file)}:${error.code}`).join(', ');
    return `focus state unknown (${codes}) — run --doctor`;
  }
  if (!state.active) {
    return state.degraded ? 'no focus mode active (mode names unavailable)' : 'no focus mode active';
  }
  const name = state.modeName ?? state.modeId ?? 'unnamed mode';
  return `focus active: ${name} (via ${state.source})`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === 'help') return console.log(HELP), 0;
  if (options.mode === 'selftest') return selftest();
  if (options.mode === 'grant') {
    const { spawn, spawnSync } = require('node:child_process');
    const candidates = fdaCandidates();
    const primary = primaryGrantCandidate(candidates);

    spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'], { stdio: 'ignore', detached: true }).unref();
    console.log('Opened Settings → Privacy & Security → Full Disk Access.');

    if (primary?.exists) {
      spawn('open', ['-R', primary.path], { stdio: 'ignore', detached: true }).unref();
      try {
        spawnSync('pbcopy', { input: primary.path });
        console.log(`Revealed in Finder and copied to clipboard:\n  ${primary.path}`);
      } catch {
        console.log(`Revealed in Finder:\n  ${primary.path}`);
      }
      console.log('');
      console.log('To add it: click + in the list, then in the file sheet press ⌘⇧G, paste, Return.');
      console.log('Or simply drag the revealed app from Finder into the list.');
    } else {
      console.log('No local app bundle found — build one first with `pnpm package`, then re-run --grant.');
    }

    console.log('');
    console.log('Other entries you may need:');
    for (const candidate of candidates) {
      console.log(`  ${candidate.exists ? '✓' : '✗'} ${candidate.path} — ${candidate.label}`);
    }
    console.log('');
    console.log('Then QUIT and relaunch that app: TCC does not apply to a running process.');
    console.log('Rebuilding replaces the binary and can invalidate the grant — if reading stops');
    console.log('working after `pnpm package`, remove the entry and add it again.');
    return 0;
  }
  if (options.mode === 'doctor') {
    const { blocked, report } = diagnose({ dbDir: options.dbDir });
    console.log(report);
    return blocked ? 1 : 0;
  }
  if (options.mode === 'dump') {
    for (const file of [ASSERTIONS_FILE, MODE_CONFIGS_FILE]) {
      const filePath = path.join(options.dbDir, file);
      console.log(`\n=== ${filePath}`);
      try {
        console.log(dumpShape(readJsonFile(filePath)));
      } catch (error) {
        console.log(`  unreadable: ${error.code} — ${FDA_HINT}`);
      }
    }
    return 0;
  }

  if (options.mode === 'events') {
    const watcher = startFocusWatcher({
      dbDir: options.dbDir,
      intervalMs: options.intervalMs,
      useFsWatch: options.useFsWatch ?? true,
      onChange: (next, previous) => process.stdout.write(`${JSON.stringify(toFocusEvent(next, previous))}\n`),
      onError: (error) => console.error(`[watch] ${error.code ?? ''} ${error.message} — polling only`),
    });
    console.error(`focus events as NDJSON (${watcher.mode}) — Ctrl-C to stop`);
    // A sensor that cannot read anything is silent by design. Say why once, on stderr, so
    // an empty stream is never mistaken for "Focus never changed".
    if (watcher.state.known === false) printPermissionHelp();
    return 0;
  }

  if (!options.watch) {
    const state = readFocusState({ dbDir: options.dbDir, now: options.now });
    console.log(formatState(state, options));
    return state.known === false ? 1 : 0;
  }

  let previous = null;
  console.log(`watching Focus state every ${options.intervalMs}ms — Ctrl-C to stop`);
  const tick = () => {
    const state = readFocusState({ dbDir: options.dbDir, now: options.now });
    const signature = JSON.stringify([state.known, state.active, state.modeId, state.source, state.degraded]);
    if (signature !== previous) {
      previous = signature;
      const stamp = new Date().toLocaleTimeString();
      console.log(`[${stamp}] ${formatState(state, options)}`);
    }
  };
  tick();
  if (!readFocusState({ dbDir: options.dbDir, now: options.now }).known) printPermissionHelp();
  setInterval(tick, options.intervalMs);
  return 0;
}

if (require.main === module) {
  const result = main();
  if (result && typeof result.then === 'function') result.then((code) => { process.exitCode = code; });
  else process.exitCode = result;
}

module.exports = {
  deriveFocusState,
  parseAssertionRecords,
  scheduleCandidates,
  repeatMatchesDay,
  withinWindow,
  windowStartDay,
  readFocusState,
  startFocusWatcher,
  toFocusEvent,
  transitionKey,
  diagnose,
  fdaTarget,
  fdaCandidates,
  primaryGrantCandidate,
  grantTargetForThisProcess,
  printPermissionHelp,
  enclosingAppBundle,
  selftest,
  DEFAULT_DB_DIR,
};
