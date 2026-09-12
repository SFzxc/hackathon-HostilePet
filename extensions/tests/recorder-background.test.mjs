import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

/**
 * The desktop link is wired, and it stays optional.
 *
 * This file used to assert the opposite — that the recorder background never referenced the
 * bridge, because the link was deliberately paused. It has been resumed, so the guard now
 * checks the two properties that still matter rather than the absence of one: the bridge is
 * started, and the recorder's own storage path never waits on it.
 */
test('browser telemetry background starts the desktop bridge without depending on it', async () => {
 const source=await fs.readFile(new URL('../extension/recorder-background.js',import.meta.url),'utf8');
 assert.match(source,/import \{createDesktopBridge\} from '\.\/desktop-bridge\.js'/);
 assert.match(source,/desktop\.start\(\);/);
 // The tick is sent only after the event is already durable, and its result is ignored:
 // a desktop that is not running must never cost the recorder an event.
 assert.match(source,/await chrome\.storage\.local\.set\(changes\);desktop\.sendRecorderEvent\(/);
});
