import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./schedule-time.test.mjs', import.meta.url));

for (const zone of ['UTC', 'Europe/Kyiv', 'America/Los_Angeles']) {
    test(`schedule clock and current-lesson UI pass with runner timezone ${zone}`, () => {
        // Isolate TZ changes from other tests; run only the clock fixture, not this matrix.
        const result = spawnSync(process.execPath, ['--test', fixture], {
            env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 15000
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, `${zone}\n${result.stdout}\n${result.stderr}`);
    });
}
