import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeJsonSecureAtomic, readJson } from '../src/utils/fs.mjs';

test('writeJsonSecureAtomic writes and replaces secure JSON files without temp leftovers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rappi-cli-fs-test-'));

  try {
    const target = path.join(tmpDir, 'session-state.json');

    writeJsonSecureAtomic(target, { token: 'first', count: 1 });
    writeJsonSecureAtomic(target, { token: 'second', count: 2 });

    const saved = readJson(target);
    assert.deepEqual(saved, { token: 'second', count: 2 });

    const files = fs.readdirSync(tmpDir);
    assert.deepEqual(files, ['session-state.json']);

    const mode = fs.statSync(target).mode & 0o777;
    assert.equal(mode & 0o077, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
