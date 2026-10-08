import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { prepareSite } from '../src/site.js';

test('Creative site preparation flies beside vegetation instead of asking airborne bot to walk', async () => {
  let plant = true;
  const bot = {
    game: { gameMode: 'creative' }, entity: { position: new Vec3(0.5, 10, 0.5), velocity: new Vec3(0, 0, 0) },
    creative: { startFlying: () => {} }, entities: {},
    pathfinder: { goto: () => { throw new Error('Creative must not walk'); } },
    blockAt: p => {
      const name = p.y === 0 ? 'dirt' : plant && p.x === 0 && p.y === 1 && p.z === 0 ? 'short_grass' : 'air';
      return { name, boundingBox: name === 'dirt' ? 'block' : 'empty', position: p };
    },
    dig: async () => { plant = false; }
  };
  await prepareSite(bot, { plants: [{ x: 0, y: 1, z: 0 }], cuts: [], fills: [] }, null, () => true);
  assert.equal(plant, false);
});
