import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { approachPlacement } from '../src/placement.js';

test('creative placement hovers above its target rather than pathfinding into a cave', async () => {
  const bot = { game: { gameMode: 'creative' }, entity: { position: new Vec3(0, 91, 0) },
    creative: { flyTo: async target => { bot.entity.position = target; } },
    pathfinder: { goto: () => { throw new Error('should not pathfind'); } } };
  await approachPlacement(bot, new Vec3(3, 107, 4));
  assert.equal(bot.entity.position.y, 108.5);
});
test('rejects faraway placement rather than asking Minecraft to place out of reach', async () => {
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0, 91, 0) }, pathfinder: { goto: async () => {} } };
  await assert.rejects(approachPlacement(bot, new Vec3(3, 107, 4)), /out of reach/);
});
