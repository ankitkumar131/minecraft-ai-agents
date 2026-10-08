// The LLM chooses among audited, bounded actions. It never emits executable code,
// raw Minecraft commands, coordinates to overwrite, or permissions.
export function validatePlan(value) {
  if (value?.action === 'unsupported') throw new Error('No supported Minecraft actions for this request');
  if (!Array.isArray(value?.steps) || !value.steps.length || value.steps.length > 8) throw new Error('Planner must return 1–8 supported steps');
  const steps = value.steps.map(step => {
    if (step?.action === 'create_village') return { action: 'create_village', houses: 3 };
    if (step?.action === 'repair_roof' || step?.action === 'furnish_house') return { action: step.action };
    if (step?.action === 'place_item' || step?.action === 'equip_item') {
      const query = String(step.item || '').trim().toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_');
      if (!/^[a-z0-9_]{2,80}$/.test(query)) throw new Error('Planner returned invalid item name');
      return { action: step.action, item: query };
    }
    if (step?.action === 'build_house' && Number.isInteger(step.size) && step.size >= 5 && step.size <= 16 && ['stone', 'cobblestone'].includes(step.material)) return { action: 'build_house', size: step.size, material: step.material };
    throw new Error('Planner returned an unsupported action');
  });
  if (steps.some(s => ['build_house', 'create_village'].includes(s.action)) && steps.length !== 1) throw new Error('Building and furnishing must be separate tasks');
  return steps;
}

export function boundedFallback(text, observation) {
  if (observation?.mode === 'creative' && /\b(build|create|make|develop)\b.*\bvillage\b/i.test(text)) return [{ action: 'create_village', houses: 3 }];
  if (!observation?.lastHouse || observation.mode !== 'creative') return null;
  const lower = text.toLowerCase();
  const steps = [];
  if (/\b(roof|repair)\b/.test(lower) && /\b(fix|repair|roof)\b/.test(lower)) steps.push({ action: 'repair_roof' });
  if (/\b(interior|furnish)\b/.test(lower)) steps.push({ action: 'furnish_house' });
  if (/\bdoor\b/.test(lower)) steps.push({ action: 'place_item', item: 'door' });
  return steps.length ? steps : null;
}

export async function planTask(text, observation, { providers, onAttempt = () => {}, signal, fetchImpl = fetch }) {
  const prompt = `Plan a Minecraft player task using ONLY these safe actions: repair_roof (the agent's last completed house), furnish_house (a small starter interior: bed, chest, crafting table, furnace, lantern), place_item (one Creative placeable item), equip_item (one Creative item), build_house (stone or cobblestone, integer size 5-16), create_village (bounded project of three 7x7 cobblestone houses in Creative, never an entire autonomous town). Respond with JSON ONLY: {"steps":[{"action":"repair_roof"},{"action":"furnish_house"},{"action":"place_item","item":"iron_door"}]}. If no supported action can satisfy the request, return {"action":"unsupported"}. Never claim these actions cover all Minecraft tasks. Do not add more than 8 steps or output arbitrary commands. World observation: ${JSON.stringify(observation)}. User request: ${JSON.stringify(text)}`;
  const failures = [];
  for (const provider of providers) {
    if (signal?.aborted) throw new Error('Planning cancelled');
    onAttempt(provider.name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const ollama = provider.type === 'ollama';
      const response = await fetchImpl(new URL(ollama ? '/api/generate' : 'chat/completions', provider.url.endsWith('/') ? provider.url : provider.url + '/'), {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(provider.key ? { authorization: `Bearer ${provider.key}` } : {}) },
        body: JSON.stringify(ollama ? { model: provider.model, stream: false, format: 'json', prompt } : {
          model: provider.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const parsed = JSON.parse(ollama ? data.response : data.choices?.[0]?.message?.content);
      return { steps: validatePlan(parsed), provider: provider.name };
    } catch (error) {
      if (signal?.aborted) throw new Error('Planning cancelled');
      if (error.message === 'No supported Minecraft actions for this request') {
        const fallback = boundedFallback(text, observation);
        if (fallback) return { steps: fallback, provider: 'bounded fallback (AI returned unsupported)' };
        throw error;
      }
      failures.push(`${provider.name}: ${error.cause?.code || error.message || 'request failed'}`);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  const fallback = boundedFallback(text, observation);
  if (fallback) return { steps: fallback, provider: 'bounded fallback (AI unavailable)' };
  throw new Error(`AI planning failed across all providers: ${failures.join('; ') || 'none available'}. Check provider URL/key, network/TLS and whether Ollama is running.`);
}
