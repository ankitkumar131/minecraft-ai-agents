import test from 'node:test';
import assert from 'node:assert/strict';
import { findSite, inspectSite } from '../src/site.js';

test('finds a flat clear footprint near player without terrain modification', () => {
  const bot = { blockAt: p => ({ name: p.y === 63 ? 'dirt' : 'air', boundingBox: p.y === 63 ? 'block' : 'empty' }) };
  assert.deepEqual(findSite(bot, { x: 3.5, y: 64, z: 5 }, 10, 'cobblestone'), { x: 3, y: 63, z: 5 });
  assert.equal(inspectSite(bot, { x: 3, y: 62, z: 5 }, 10, 'cobblestone'), false);
});
test('rejects obstructed and unloaded sites', () => {
  const bot = { blockAt: p => p.x >= 0 && p.x < 10 && p.z >= 0 && p.z < 10 ? ({ name: p.y === 63 ? 'dirt' : p.x === 5 && p.y === 64 ? 'tree' : 'air', boundingBox: p.y === 63 || p.x === 5 && p.y === 64 ? 'block' : 'empty' }) : null };
  assert.throws(() => findSite(bot, { x: 0, y: 64, z: 0 }, 10, 'cobblestone', 1), /No clear flat/);
});
