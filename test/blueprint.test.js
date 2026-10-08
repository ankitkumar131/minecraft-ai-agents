import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { validateBlueprint, validateRequestDimensions, requestBlueprint, executeBlueprint } from '../src/blueprint.js';

const block = (x, y, z, item = 'cobblestone') => ({ x, y, z, item });
test('rejects duplicate, floating and oversized blueprints before editing world', async () => {
  assert.throws(() => validateBlueprint({ name: 'bad', blocks: [block(0, 1, 0), block(0, 1, 0)] }), /Duplicate/);
  assert.throws(() => validateBlueprint({ name: 'big', blocks: Array(513).fill(block(0, 1, 0)) }), /512/);
  assert.throws(() => validateBlueprint({ name: 'bad', blocks: [block(0, 0, 0)] }), /invalid coordinates/);
  assert.throws(() => validateRequestDimensions('Build a 10x10 house', validateBlueprint({ name: 'tiny', blocks: [block(0, 1, 0)] })), /footprint/);
  let supplied = false;
  const bot = {
    game: { gameMode: 'creative' }, registry: { itemsByName: { cobblestone: { id: 1 } }, blocksByName: { cobblestone: { boundingBox: 'block' } } },
    blockAt: p => ({ name: p.y === 0 ? 'dirt' : 'air', boundingBox: p.y === 0 ? 'block' : 'empty' }),
    inventory: { items: () => { supplied = true; return []; } }
  };
  await assert.rejects(executeBlueprint(bot, validateBlueprint({ name: 'island', blocks: [block(0, 5, 0)] }), new Vec3(0.5, 1, 0.5), null, () => true), /unsupported blocks/);
  assert.equal(supplied, false);
});

test('forwards exact request and falls through invalid provider blueprint', async () => {
  const attempts = [], prompts = [];
  const result = await requestBlueprint('Build a 10x10 cobblestone house at my location', { mode: 'creative' }, {
    providers: [{ name: 'bad', type: 'ollama', url: 'http://localhost:11434', model: 'a' }, { name: 'good', type: 'ollama', url: 'http://localhost:11434', model: 'b' }],
    onAttempt: name => attempts.push(name),
    fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body); prompts.push(body.prompt);
      return { ok: true, json: async () => ({ response: JSON.stringify(body.model === 'a' ? { name: 'bad', blocks: [block(0, 0, 0)] } : { name: 'house', blocks: [block(0, 1, 0), block(9, 1, 9)] }) }) };
    }
  });
  assert.deepEqual(attempts, ['bad', 'good']);
  assert.equal(result.provider, 'good');
  assert.ok(prompts.every(prompt => prompt.includes('Build a 10x10 cobblestone house at my location')));
});

test('refuses unrelated existing blocks before supplying anything', async () => {
  const bot = {
    game: { gameMode: 'creative' }, registry: { itemsByName: { cobblestone: { id: 1 } }, blocksByName: { cobblestone: { boundingBox: 'block' } } },
    blockAt: p => ({ name: p.y === 1 ? 'chest' : 'dirt', boundingBox: 'block' }),
    inventory: { items: () => { throw new Error('Should not supply'); } }
  };
  await assert.rejects(executeBlueprint(bot, validateBlueprint({ name: 'house', blocks: [block(0, 1, 0)] }), new Vec3(0.5, 1, 0.5), null, () => true), /obstructed/);
});

test('executes a supported Creative block and verifies server placement', async () => {
  let placed = false, placements = 0;
  const bot = {
    game: { gameMode: 'creative' },
    registry: { itemsByName: { cobblestone: { id: 1 } }, blocksByName: { cobblestone: { boundingBox: 'block' } } },
    entity: { position: new Vec3(10.5, 2, 8.5), velocity: new Vec3(0, 0, 0) },
    entities: {}, creative: { startFlying: () => {} },
    inventory: { items: () => [{ name: 'cobblestone', count: 1 }] },
    blockAt: p => ({ name: p.y === 0 ? 'dirt' : placed && p.x === 10 && p.y === 1 && p.z === 10 ? 'cobblestone' : 'air', boundingBox: p.y === 0 || placed && p.x === 10 && p.y === 1 && p.z === 10 ? 'block' : 'empty', position: p }),
    equip: async () => {}, placeBlock: async () => { placements++; placed = true; }
  };
  const result = await executeBlueprint(bot, validateBlueprint({ name: 'test', blocks: [block(0, 1, 0)] }), new Vec3(10.5, 1, 10.5), null, () => true);
  assert.equal(result.verified, true);
  assert.equal(placements, 1);
});
