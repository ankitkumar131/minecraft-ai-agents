import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { approachPlacement, boundedMove } from '../src/placement.js';

test('creative placement hovers above its target rather than pathfinding into a cave', async () => {
  const bot = { game: { gameMode: 'creative' }, entity: { position: new Vec3(0, 91, 0) },
    creative: { startFlying: () => {} },
    pathfinder: { goto: () => { throw new Error('should not pathfind'); } } };
  await approachPlacement(bot, new Vec3(3, 107, 4));
  assert.equal(bot.entity.position.y, 108.5);
});
test('rejects faraway placement rather than asking Minecraft to place out of reach', async () => {
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0, 91, 0) }, pathfinder: { goto: async () => {} } };
  await assert.rejects(approachPlacement(bot, new Vec3(3, 107, 4)), /out of reach/);
});

test('stalled Creative flight reports a bounded timeout instead of leaving job running forever', async () => {
  await assert.rejects(boundedMove(new Promise(() => {}), 'Creative flight to 1,2,3', 25), /timed out/);
});

test('interior approach enters through the house doorway instead of crossing the roof', async () => {
  const { approachInterior } = await import('../src/placement.js');
  const bot = { game: { gameMode: 'creative' }, entity: { position: new Vec3(5, 70, 5), velocity: null },
    creative: { startFlying: () => {} }, blockAt: () => ({ name: 'air' }) };
  const logs = [];
  await approachInterior(bot, { x: 0, y: 64, z: 0 }, 10, new Vec3(7, 65, 2), null, message => logs.push(message));
  assert.equal(logs.length, 4);
  assert.match(logs[0], /waypoint 1\/4/);
  assert.equal(bot.entity.position.y, 66.5);
});
test('blocked house entrance produces an explicit error before Creative flight', async () => {
  const { approachInterior } = await import('../src/placement.js');
  const bot = { game: { gameMode: 'creative' }, entity: { position: new Vec3(5, 70, 5) },
    blockAt: () => ({ name: 'iron_door' }) };
  await assert.rejects(approachInterior(bot, { x: 0, y: 64, z: 0 }, 10, new Vec3(7, 65, 2)), /entrance is blocked/);
});
