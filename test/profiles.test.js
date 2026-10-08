import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore, validateProfile } from '../src/profiles.js';

test('validates names and defaults permissions to disabled', () => {
  assert.throws(() => validateProfile({ name: '../bad', role: 'Builder', goal: 'Build' }), /Name/);
  assert.deepEqual(validateProfile({ name: 'Aria', role: 'Builder', goal: 'Build' }).permissions, { move: false, place: false });
});
test('profiles persist and duplicates are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-players-'));
  try {
    const path = join(dir, 'profiles.json');
    const store = new ProfileStore(path);
    await store.add({ name: 'Aria', role: 'Builder', goal: 'Build', permissions: { move: true, place: true } });
    await assert.rejects(store.add({ name: 'Aria', role: 'Miner', goal: 'Mine' }), /already exists/);
    const loaded = new ProfileStore(path);
    await loaded.load();
    assert.equal(loaded.profiles.get('Aria').goal, 'Build');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
