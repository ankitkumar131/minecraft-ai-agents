import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { clearFlightLine, findFlightRoute } from '../src/flight-route.js';

const bot = { blockAt: p => {
  const inHouse = p.x >= 0 && p.x <= 4 && p.z >= 0 && p.z <= 4;
  const wall = inHouse && (p.x === 0 || p.x === 4 || p.z === 0 || p.z === 4) && p.y >= 65 && p.y <= 68;
  const doorway = p.x === 2 && p.z === 0 && (p.y === 65 || p.y === 66);
  const roof = inHouse && p.y === 69;
  const solid = p.y <= 64 || roof || (wall && !doorway);
  return { name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty' };
} };

test('routes out of a roofed room through its doorway rather than straight through roof', () => {
  const start = new Vec3(2.5, 66, 2.5), end = new Vec3(2.5, 70.5, 2.5);
  assert.equal(clearFlightLine(bot, start, end), false);
  const route = findFlightRoute(bot, start, end);
  assert.ok(route.some(p => p.z < 0), 'route must travel outside before ascending');
  assert.deepEqual(route.at(-1), end);
  let previous = start;
  for (const point of route) { assert.ok(clearFlightLine(bot, previous, point)); previous = point; }
});
