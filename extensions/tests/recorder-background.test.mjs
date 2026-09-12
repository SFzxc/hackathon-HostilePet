import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('browser telemetry background does not start the paused local-server bridge', async () => {
 const source=await fs.readFile(new URL('../extension/recorder-background.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/desktop-bridge\.js/);
 assert.doesNotMatch(source,/desktopBridge\.start\(/);
});
