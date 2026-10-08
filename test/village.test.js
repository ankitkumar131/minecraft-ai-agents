import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { createStarterVillage } from '../src/village.js';
import { findSite } from '../src/site.js';
import { boundedFallback, validatePlan } from '../src/agent-planner.js';

test('village request has a bounded three-house fallback when providers fail', () => {
  assert.deepEqual(boundedFallback('create a village', { mode: 'creative' }), [{ action: 'create_village', houses: 3 }]);
  assert.deepEqual(validatePlan({ steps: [{ action: 'create_village', houses: 900 }] }), [{ action: 'create_village', houses: 3 }]);
  assert.throws(() => validatePlan({ steps: [{ action: 'create_village' }, { action: 'place_item', item: 'tnt' }] }), /separate tasks/);
});
test('site finder avoids recorded houses for new village buildings', () => {
  const bot = { blockAt: p => ({ name: p.y === 63 ? 'dirt' : 'air', boundingBox: p.y === 63 ? 'block' : 'empty' }) };
  const site = findSite(bot, new Vec3(0, 64, 0), 7, 'cobblestone', 15, [{ x: 0, z: 0, size: 7 }], true);
  assert.ok(site.origin.x + 7 + 3 <= 0 || site.origin.x >= 10 || site.origin.z + 7 + 3 <= 0 || site.origin.z >= 10);
});
test('village can resume a fully verified project without placing again', async () => {
  const bot = { game: { gameMode: 'creative' }, blockAt: p => ({ name: p.y >= 65 && p.y <= 69 ? 'cobblestone' : 'dirt' }) };
  const resume = [0, 1, 2].map(i => ({ origin: { x: i * 12, y: 64, z: 0 }, spec: { size: 7, material: 'cobblestone' } }));
  const result = await createStarterVillage(bot, { x: 0, y: 65, z: 0 }, [], resume, null, () => true, () => {}, () => {});
  assert.equal(result.houses.length, 3);
});
