import test from 'node:test';
import assert from 'node:assert/strict';
import { gatherForHouse } from '../src/gather.js';

test('does not gather when inventory already contains enough blocks', async () => {
  const bot = { inventory: { items: () => [{ name: 'stone', count: 242 }] }, blockAt: () => ({ name: 'air' }) };
  await gatherForHouse(bot, { x: 0, y: 64, z: 0 }, { material: 'stone', size: 10 });
});
test('explains why ordinary stone cannot be gathered as stone blocks', async () => {
  const bot = { inventory: { items: () => [] }, blockAt: () => ({ name: 'air' }) };
  await assert.rejects(gatherForHouse(bot, { x: 0, y: 64, z: 0 }, { material: 'stone', size: 10 }), /Request a cobblestone house/);
});
