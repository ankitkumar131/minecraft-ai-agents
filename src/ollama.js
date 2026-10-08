import { parseCommand } from './plan.js';

export function providersFromEnv(env = process.env) {
  // Configuration is server-side only. Never return credentials in API responses.
  const configured = env.AI_PROVIDERS ? JSON.parse(env.AI_PROVIDERS) : [
    { name: 'local', type: 'ollama', url: env.OLLAMA_URL || 'http://127.0.0.1:11434', model: env.OLLAMA_MODEL || 'qwen2.5:7b' }
  ];
  if (!Array.isArray(configured) || !configured.length) throw new Error('AI_PROVIDERS must be a non-empty array');
  return configured.map((p, i) => {
    if (!p || !['ollama', 'openai-compatible'].includes(p.type) || typeof p.url !== 'string' || !/^https?:\/\//.test(p.url) || typeof p.model !== 'string' || !p.model || typeof p.name !== 'string' || !p.name) throw new Error(`Invalid provider at index ${i}`);
    if (p.type === 'openai-compatible' && (!p.keyEnv || !env[p.keyEnv])) throw new Error(`Missing credential for provider ${p.name}`);
    return { name: p.name, type: p.type, url: p.url, model: p.model, key: p.type === 'openai-compatible' ? env[p.keyEnv] : undefined };
  });
}

function validate(output) {
  if (output.action !== 'build_house' || !Number.isInteger(output.size) || output.size < 5 || output.size > 16 || !['stone', 'cobblestone'].includes(output.material)) throw new Error('Unsupported or invalid plan');
  return { size: output.size, material: output.material };
}

export async function interpret(text, { providers, onAttempt = () => {}, signal, fetchImpl = fetch }) {
  const direct = parseCommand(text);
  if (direct) return { ...direct, provider: 'deterministic' };
  const prompt = 'Translate this Minecraft request into JSON only: {"action":"build_house","size":10,"material":"stone"}. Allowed action: build_house. Allowed material: stone or cobblestone. Size integer 5 to 16. For unsupported requests return {"action":"unsupported"}. Request: ' + JSON.stringify(text);
  let lastError;
  for (const provider of providers) {
    if (signal?.aborted) throw new Error('Cancelled');
    onAttempt(provider.name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const isOllama = provider.type === 'ollama';
      const response = await fetchImpl(new URL(isOllama ? '/api/generate' : 'chat/completions', provider.url.endsWith('/') ? provider.url : provider.url + '/'), {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(provider.key ? { authorization: `Bearer ${provider.key}` } : {}) },
        body: JSON.stringify(isOllama ? { model: provider.model, stream: false, format: 'json', prompt } : {
          model: provider.model, temperature: 0, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const content = isOllama ? data.response : data.choices?.[0]?.message?.content;
      const plan = validate(JSON.parse(content));
      return { ...plan, provider: provider.name };
    } catch (error) {
      if (signal?.aborted) throw new Error('Cancelled');
      lastError = error;
      // Only failures move to the next provider; an explicit unsupported request does not.
      if (error.message === 'Unsupported or invalid plan') throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  throw new Error(`All AI providers failed: ${lastError?.message || 'none available'}`);
}
