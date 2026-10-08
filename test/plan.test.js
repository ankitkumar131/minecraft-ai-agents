import test from 'node:test';
import assert from 'node:assert/strict';
import { housePlan, parseCommand } from '../src/plan.js';

test('parses supported requests without Ollama', () => {
  assert.deepEqual(parseCommand('Build a 10×10 stone house at my location.'), { size: 10, material: 'stone' });
  assert.deepEqual(parseCommand('build cobblestone house'), { size: 10, material: 'cobblestone' });
  assert.equal(parseCommand('destroy the village'), null);
  assert.throws(() => parseCommand('build 8x10 stone house'), /square/);
});

test('blueprint leaves a two-high entrance and has unique blocks', () => {
  const plan = housePlan({ x: 3, y: 64, z: -4 });
  assert.equal(new Set(plan.map(p => `${p.x},${p.y},${p.z}`)).size, plan.length);
  assert.equal(plan.length, 4 * (4 * 10 - 4) - 2 + 100);
  assert.ok(!plan.some(p => p.x === 8 && p.z === -4 && p.y <= 66));
  assert.ok(plan.some(p => p.x === 8 && p.z === -4 && p.y === 67));
  assert.ok(plan.some(p => p.x === 8 && p.z === 1 && p.y === 69));
  assert.throws(() => housePlan({ x: 0, y: 0, z: 0 }, 17));
});
