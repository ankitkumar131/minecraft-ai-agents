import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory.js';
import { interpret, providersFromEnv } from '../src/ollama.js';

test('memory isolated by agent and persists across store instances and provider changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'player-memory-'));
  try {
    const store = new MemoryStore(dir);
    await Promise.all([store.record('Aria', 'task', { status: 'done' }), store.record('Aria', 'event', { message: 'built' }), store.record('Bruno', 'event', { message: 'mining' })]);
    const reopened = new MemoryStore(dir);
    assert.equal((await reopened.get('Aria')).tasks.length, 1);
    assert.equal((await reopened.get('Aria')).events.length, 1);
    assert.equal((await reopened.get('Bruno')).tasks.length, 0);
    assert.throws(() => reopened.path('../escape'), /Invalid/);
    await reopened.remove('Aria');
    assert.deepEqual(await reopened.get('Aria'), { agent: 'Aria', events: [], tasks: [] });
    assert.equal((await reopened.get('Bruno')).events.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('provider failover preserves validated structured output and never leaks keys', async () => {
  const providers = providersFromEnv({ PRIMARY_KEY: 'secret', AI_PROVIDERS: JSON.stringify([
    { name: 'first', type: 'openai-compatible', url: 'https://example.test/v1/', model: 'm', keyEnv: 'PRIMARY_KEY' },
    { name: 'second', type: 'ollama', url: 'http://127.0.0.1:11434', model: 'm' }
  ]) });
  const attempts = [];
  const plan = await interpret('please construct a home', { providers, onAttempt: name => attempts.push(name), fetchImpl: async url => {
    if (url.hostname === 'example.test') return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ response: '{"action":"build_house","size":10,"material":"stone"}' }) };
  } });
  assert.deepEqual(attempts, ['first', 'second']);
  assert.equal(plan.provider, 'second');
  assert.equal(JSON.stringify(plan).includes('secret'), false);
});
test('unsupported plans are not silently reinterpreted by the next provider', async () => {
  await assert.rejects(interpret('please destroy world', { providers: [{ name: 'one', type: 'ollama', url: 'http://localhost', model: 'm' }, { name: 'two', type: 'ollama', url: 'http://localhost', model: 'm' }], fetchImpl: async () => ({ ok: true, json: async () => ({ response: '{"action":"unsupported"}' }) }) }), /Unsupported/);
});

test('provider keyEnv is a variable name, not a secret, and errors never print secrets', () => {
  const provider = { name: 'cloud', type: 'openai-compatible', url: 'https://example.test/v1/', model: 'm' };
  assert.throws(() => providersFromEnv({ AI_PROVIDERS: JSON.stringify([{ ...provider, keyEnv: 'sk-secret-value ' }]) }), /Invalid keyEnv.*variable name/);
  assert.throws(() => providersFromEnv({ AI_PROVIDERS: JSON.stringify([{ ...provider, keyEnv: 'CLOUD_API_KEY' }]) }), /set the CLOUD_API_KEY environment variable/);
  const parsed = providersFromEnv({ CLOUD_API_KEY: 'secret', AI_PROVIDERS: JSON.stringify([{ ...provider, keyEnv: 'CLOUD_API_KEY' }]) });
  assert.equal(parsed[0].key, 'secret');
});
