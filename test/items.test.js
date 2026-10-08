import test from 'node:test';
import assert from 'node:assert/strict';
import dataFactory from 'minecraft-data';
import { parseItemIntent, findItems, resolveItem, runItemTask, runItemSequence, repairRoof } from '../src/items.js';

const registry = dataFactory('1.21.4');
test('generic door uses first matching item from current Minecraft registry', () => {
  assert.deepEqual(parseItemIntent('place a door'), { action: 'place_item', query: 'door', context: null });
  assert.equal(resolveItem(registry, 'door').name, registry.itemsArray.find(i => i.name.includes('door')).name);
  assert.equal(resolveItem(registry, 'oak_door').name, 'oak_door');
  assert.equal(findItems(registry, 'door').items[0].name, resolveItem(registry, 'door').name);
  assert.deepEqual(parseItemIntent('equip a diamond sword'), { action: 'equip_item', query: 'diamond_sword', context: null });
  assert.equal(parseItemIntent('build a house'), null);
  assert.deepEqual(parseItemIntent('add a door, bed, lamp, roof to it'), { action: 'item_sequence', queries: ['door', 'bed', 'lamp', 'roof'], context: 'to it' });
  assert.equal(resolveItem(registry, 'bed').name, 'white_bed');
  assert.deepEqual(parseItemIntent('add a bed inside house'), { action: 'place_item', query: 'bed', context: 'in the house' });
});
test('nonplaceable items and hazardous blocks cannot be placed', async () => {
  const bot = { game: { gameMode: 'creative' }, version: '1.21.4', registry };
  await assert.rejects(runItemTask(bot, parseItemIntent('place diamond sword'), {}, null, null, () => true), /not a directly placeable block/);
  await assert.rejects(runItemTask(bot, parseItemIntent('place tnt'), {}, null, null, () => true), /hazardous-action/);
});

test('roof in multi-item task verifies the prior house instead of inventing a roof item', async () => {
  const bot = { game: { gameMode: 'creative' }, registry, blockAt: p => ({ name: p.y === 69 ? 'cobblestone' : 'air' }) };
  const prior = { origin: { x: 0, y: 64, z: 0 }, spec: { size: 5, material: 'cobblestone' } };
  const result = await runItemSequence(bot, { action: 'item_sequence', queries: ['roof'], context: 'to it' }, null, prior, null, () => true);
  assert.deepEqual(result, { items: [{ item: 'roof', verified: true }] });
});

test('roof repair fills a missing roof block and verifies it', async () => {
  const { Vec3 } = await import('vec3');
  const broken = new Set(['0,69,0']);
  const bot = {
    game: { gameMode: 'creative' }, registry,
    entity: { position: new Vec3(0, 70, 0) },
    blockAt: p => ({ name: p.y === 69 && broken.has(`${p.x},${p.y},${p.z}`) ? 'air' : 'cobblestone', boundingBox: 'block', position: p }),
    inventory: { items: () => [{ name: 'cobblestone', count: 64 }] },
    equip: async () => {},
    creative: { startFlying: () => {} },
    placeBlock: async (ref, face) => { broken.delete(ref.position.plus(face).toString().replace(/[() ]/g, '')); }
  };
  // Vec3.toString is '(0, 69, 0)'; the mock converts it to a coordinate key.
  const result = await repairRoof(bot, { origin: { x: 0, y: 64, z: 0 }, spec: { size: 5, material: 'cobblestone' } }, null, () => true);
  assert.equal(result.repaired, 1);
  assert.equal(broken.size, 0);
});
