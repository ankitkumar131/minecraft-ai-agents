import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { housePlan } from '../src/plan.js';
import { buildHouse } from '../src/builder.js';

test('Creative builder retries placement from another clear side while retaining solid support', async () => {
  const origin = { x: 0, y: 0, z: 0 };
  const plan = housePlan(origin, 5);
  const planned = new Set(plan.map(p => `${p.x},${p.y},${p.z}`));
  const first = plan[0];
  const targetKey = `${first.x},${first.y},${first.z}`;
  let placed = false;
  const bot = {
    game: { gameMode: 'creative' }, entity: { position: new Vec3(-4.5, 2, 0.5), velocity: new Vec3(0, 0, 0) }, entities: {},
    creative: { startFlying: () => {} }, inventory: { items: () => [{ name: 'cobblestone', count: 1 }] }, equip: async () => {},
    blockAt: p => {
      const k = `${p.x},${p.y},${p.z}`;
      const name = p.y === 0 ? 'dirt' : planned.has(k) && (k !== targetKey || placed) ? 'cobblestone' : 'air';
      return { name, boundingBox: name === 'air' ? 'empty' : 'block', position: p };
    },
    placeBlock: async (reference, face) => {
      assert.equal(reference.position.y, 0); // Ground is the supporting block.
      assert.equal(reference.position.plus(face).toString(), new Vec3(first.x, first.y, first.z).toString());
      placed = true;
    }
  };
  const logs = [];
  const result = await buildHouse(bot, origin, { size: 5, material: 'cobblestone' }, () => {}, null, () => true, message => logs.push(message));
  assert.equal(result.verified, true);
  assert.ok(logs.some(message => message.includes('recovered')));
});
