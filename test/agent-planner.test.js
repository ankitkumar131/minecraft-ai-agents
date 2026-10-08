import test from 'node:test';
import assert from 'node:assert/strict';
import { planTask, validatePlan } from '../src/agent-planner.js';
import { parseItemIntent } from '../src/items.js';

test('compound request bypasses single-item parser and reaches provider plan', async () => {
  const request = 'add all interior items and also fix the roof and add a door';
  assert.equal(parseItemIntent(request), null);
  const attempts = [];
  const result = await planTask(request, { mode: 'creative', lastHouse: { size: 10 } }, { providers: [
    { name: 'primary', type: 'openai-compatible', url: 'https://example.test/v1/', model: 'm', key: 'secret' },
    { name: 'backup', type: 'ollama', url: 'http://127.0.0.1:11434', model: 'm' }
  ], onAttempt: name => attempts.push(name), fetchImpl: async url => url.hostname === 'example.test' ? { ok: false, status: 503 } : {
    ok: true, json: async () => ({ response: JSON.stringify({ steps: [{ action: 'repair_roof' }, { action: 'furnish_house' }, { action: 'place_item', item: 'iron_door' }] }) })
  } });
  assert.deepEqual(attempts, ['primary', 'backup']);
  assert.deepEqual(result.steps.map(s => s.action), ['repair_roof', 'furnish_house', 'place_item']);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('planner refuses commands, oversized plans and mixed building operations', () => {
  assert.throws(() => validatePlan({ steps: [{ action: 'minecraft_command', command: '/fill' }] }), /unsupported action/);
  assert.throws(() => validatePlan({ steps: Array(9).fill({ action: 'repair_roof' }) }), /1–8/);
  assert.throws(() => validatePlan({ steps: [{ action: 'build_house', size: 10, material: 'stone' }, { action: 'repair_roof' }] }), /separate tasks/);
});

test('bounded fallback still turns the reported compound request into safe actions when AI is down', async () => {
  const result = await planTask('add all interior items and also fix the roof and add a door', { mode: 'creative', lastHouse: { size: 10 } }, {
    providers: [{ name: 'down', type: 'ollama', url: 'http://localhost:11434', model: 'm' }],
    fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.deepEqual(result.steps.map(s => s.action), ['repair_roof', 'furnish_house', 'place_item']);
  assert.match(result.provider, /fallback/);
});
