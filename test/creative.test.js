import test from 'node:test';
import assert from 'node:assert/strict';
import dataFactory from 'minecraft-data';
import { supplyCreative } from '../src/creative.js';

test('creative supply uses empty slots without replacing other items', async () => {
  const slots = Array(45).fill(null);
  slots[36] = { name: 'diamond_sword', count: 1 };
  const bot = { game: { gameMode: 'creative' }, registry: dataFactory('1.21.4'), inventory: { slots, items: () => slots.filter(Boolean) }, creative: { setInventorySlot: async (slot, item) => { slots[slot] = item; } } };
  await supplyCreative(bot, 'cobblestone', 130);
  assert.equal(slots[36].name, 'diamond_sword');
  assert.equal(slots.filter(i => i?.name === 'cobblestone').reduce((n, i) => n + i.count, 0), 130);
});
test('survival cannot invoke creative supply', async () => {
  await assert.rejects(supplyCreative({ game: { gameMode: 'survival' } }, 'dirt', 5), /server-confirmed creative/);
});
