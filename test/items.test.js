import test from 'node:test';
import assert from 'node:assert/strict';
import dataFactory from 'minecraft-data';
import { parseItemIntent, findItems, resolveItem, runItemTask } from '../src/items.js';

const registry = dataFactory('1.21.4');
test('generic door uses first matching item from current Minecraft registry', () => {
  assert.deepEqual(parseItemIntent('place a door'), { action: 'place_item', query: 'door', context: null });
  assert.equal(resolveItem(registry, 'door').name, registry.itemsArray.find(i => i.name.includes('door')).name);
  assert.equal(resolveItem(registry, 'oak_door').name, 'oak_door');
  assert.equal(findItems(registry, 'door').items[0].name, resolveItem(registry, 'door').name);
  assert.deepEqual(parseItemIntent('equip a diamond sword'), { action: 'equip_item', query: 'diamond_sword', context: null });
  assert.equal(parseItemIntent('build a house'), null);
});
test('nonplaceable items and hazardous blocks cannot be placed', async () => {
  const bot = { game: { gameMode: 'creative' }, version: '1.21.4', registry };
  await assert.rejects(runItemTask(bot, parseItemIntent('place diamond sword'), {}, null, null, () => true), /not a directly placeable block/);
  await assert.rejects(runItemTask(bot, parseItemIntent('place tnt'), {}, null, null, () => true), /hazardous-action/);
});
