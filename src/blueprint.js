import { Vec3 } from 'vec3';
import { navigateCreative } from './placement.js';
import { supplyCreative } from './creative.js';

const sides = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
const key = p => `${p.x},${p.y},${p.z}`;
const solid = b => b?.boundingBox === 'block';

export function validateBlueprint(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || raw.name.length > 100 || !Array.isArray(raw.blocks) || !raw.blocks.length || raw.blocks.length > 512) throw new Error('Blueprint requires a name and 1–512 blocks; split larger tasks');
  const seen = new Set();
  const blocks = raw.blocks.map(b => {
    if (![b?.x, b?.y, b?.z].every(Number.isInteger) || b.x < -16 || b.x > 16 || b.z < -16 || b.z > 16 || b.y < 1 || b.y > 16 || !/^[a-z0-9_]{2,80}$/.test(b.item || '')) throw new Error('Blueprint block has invalid coordinates or item');
    const position = `${b.x},${b.y},${b.z}`;
    if (seen.has(position)) throw new Error(`Duplicate blueprint block ${position}`);
    seen.add(position);
    return { x: b.x, y: b.y, z: b.z, item: b.item };
  });
  return { name: raw.name, blocks };
}

// Provider failure is retried; malformed or truncated responses can also fall through
// to the next provider. No canned village is substituted for an arbitrary request.
export function validateRequestDimensions(text, blueprint) {
  const match = text.match(/\b(\d+)\s*[x×]\s*(\d+)\b/i);
  if (!match) return blueprint;
  const [width, depth] = match.slice(1).map(Number);
  const xs = blueprint.blocks.map(b => b.x), zs = blueprint.blocks.map(b => b.z);
  const actual = [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...zs) - Math.min(...zs) + 1];
  if (!((actual[0] === width && actual[1] === depth) || (actual[0] === depth && actual[1] === width))) throw new Error(`AI blueprint footprint ${actual.join('x')} does not match requested ${width}x${depth}`);
  return blueprint;
}

export async function requestBlueprint(text, observation, { providers, signal, onAttempt = () => {}, fetchImpl = fetch }) {
  const prompt = `Design a COMPLETE Minecraft Creative construction blueprint for the exact user request. Return ONLY JSON {"name":"description","blocks":[{"x":0,"y":1,"z":0,"item":"cobblestone"}]}. Coordinates are offsets from the player's ground block: y=1 is one block ABOVE ground; x/z are offsets from the player's block coordinates. Include EVERY block, not just an outline or example. Use only ordinary full solid blocks (no doors, stairs, slabs, beds, liquids, falling sand, or redstone), so all blocks can be placed against solid faces. Limit 512 blocks, horizontal offsets -16..16 and height 1..16. If the complete request cannot fit or needs unsupported mechanics, return {"error":"clear explanation"} instead of omitting features or substituting a smaller project. Do not use commands or overwrite terrain. World context: ${JSON.stringify(observation)}. Exact user request: ${JSON.stringify(text)}`;
  const failures = [];
  for (const provider of providers) {
    if (signal?.aborted) throw new Error('Blueprint cancelled');
    onAttempt(provider.name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const ollama = provider.type === 'ollama';
      const response = await fetchImpl(new URL(ollama ? '/api/generate' : 'chat/completions', provider.url.endsWith('/') ? provider.url : provider.url + '/'), {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(provider.key ? { authorization: `Bearer ${provider.key}` } : {}) },
        body: JSON.stringify(ollama ? { model: provider.model, stream: false, format: 'json', prompt } : { model: provider.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const raw = JSON.parse(ollama ? data.response : data.choices?.[0]?.message?.content);
      if (raw.error) throw new Error(`AI cannot blueprint this request: ${String(raw.error).slice(0, 180)}`);
      return { ...validateRequestDimensions(text, validateBlueprint(raw)), provider: provider.name };
    } catch (error) {
      if (signal?.aborted) throw new Error('Blueprint cancelled');
      if (error.message.startsWith('AI cannot blueprint')) throw error;
      failures.push(`${provider.name}: ${error.message}`);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  throw new Error(`No valid complete blueprint from AI providers: ${failures.join('; ') || 'no providers configured'}`);
}

export async function executeBlueprint(bot, blueprint, playerPosition, signal, authorize, log = () => {}, progress = () => {}) {
  if (bot.game?.gameMode !== 'creative') throw new Error('AI block blueprints currently require Creative mode');
  const anchor = { x: Math.floor(playerPosition.x), y: Math.floor(playerPosition.y) - 1, z: Math.floor(playerPosition.z) };
  const pending = new Map();
  const counts = new Map();
  // Preflight the ENTIRE footprint before moving, supplying or modifying anything.
  for (const b of blueprint.blocks) {
    const p = new Vec3(anchor.x + b.x, anchor.y + b.y, anchor.z + b.z);
    const item = bot.registry?.itemsByName?.[b.item];
    const blockType = bot.registry?.blocksByName?.[b.item];
    if (!item || !blockType || blockType.boundingBox !== 'block') throw new Error(`Blueprint item ${b.item} is not a known full solid block`);
    const current = bot.blockAt(p);
    if (!current || (current.name !== 'air' && current.name !== b.item)) throw new Error(`Blueprint obstructed or unloaded at ${key(p)} (${current?.name || 'unloaded'})`);
    if (current.name === 'air') { pending.set(key(p), { p, item: b.item }); counts.set(b.item, (counts.get(b.item) || 0) + 1); }
  }
  // Require a support chain grounded in existing terrain. Reject floating islands before work.
  const available = new Set([...pending.values()].filter(({ p }) => sides.some(([dx, dy, dz]) => solid(bot.blockAt(p.offset(dx, dy, dz))))).map(({ p }) => key(p)));
  const unresolved = new Set(pending.keys());
  while (available.size) {
    const next = [...available]; available.clear();
    for (const k of next) {
      if (!unresolved.delete(k)) continue;
      const { p } = pending.get(k);
      for (const [dx, dy, dz] of sides) { const n = key(p.offset(dx, dy, dz)); if (unresolved.has(n)) available.add(n); }
    }
  }
  if (unresolved.size) throw new Error(`Blueprint has ${unresolved.size} unsupported blocks; first ${[...unresolved][0]}`);
  if (!authorize()) throw new Error('Move/place permission required');
  for (const [item, amount] of counts) await supplyCreative(bot, item, amount, signal, log);
  let placed = blueprint.blocks.length - pending.size;
  progress({ placed, total: blueprint.blocks.length });
  while (pending.size) {
    if (signal?.aborted || !authorize()) throw new Error('Blueprint cancelled or permissions revoked');
    let candidate;
    for (const entry of pending.values()) {
      if (solid(bot.blockAt(entry.p)) && bot.blockAt(entry.p)?.name === entry.item) { pending.delete(key(entry.p)); placed++; continue; }
      const ref = sides.find(([dx, dy, dz]) => solid(bot.blockAt(entry.p.offset(dx, dy, dz))));
      if (ref) { candidate = { ...entry, ref }; break; }
    }
    if (!candidate) throw new Error(`No supported next block; first ${pending.keys().next().value}`);
    const { p, item, ref } = candidate;
    let done = false; const errors = [];
    for (const [vx, vz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      if (signal?.aborted || !authorize()) throw new Error('Blueprint cancelled or permissions revoked');
      const vantage = new Vec3(p.x + vx + 0.5, p.y + 1, p.z + vz + 0.5);
      if (bot.blockAt(vantage.floored())?.name !== 'air' || bot.blockAt(vantage.floored().offset(0, 1, 0))?.name !== 'air') continue;
      try {
        await navigateCreative(bot, vantage, signal, log);
        if (bot.entity.position.distanceTo(p.offset(0.5, 0.5, 0.5)) > 4.4) throw new Error('out of reach');
        if (bot.blockAt(p)?.name === item) { done = true; break; }
        if (bot.blockAt(p)?.name !== 'air') throw new Error('target changed');
        if (Object.values(bot.entities || {}).some(e => e !== bot.entity && e.position && e.position.floored().equals(p))) throw new Error('entity in target');
        const reference = bot.blockAt(p.offset(...ref));
        if (!solid(reference)) throw new Error('support changed');
        const held = bot.inventory.items().find(i => i.name === item);
        if (!held) throw new Error(`out of ${item}`);
        await bot.equip(held, 'hand');
        try { await bot.placeBlock(reference, new Vec3(...ref.map(n => -n))); }
        catch (error) { if (bot.blockAt(p)?.name !== item) throw error; }
        const until = Date.now() + 2000;
        while (bot.blockAt(p)?.name !== item && Date.now() < until) { if (signal?.aborted) throw new Error('Blueprint cancelled'); await new Promise(resolve => setTimeout(resolve, 100)); }
        if (bot.blockAt(p)?.name !== item) throw new Error('server did not confirm placement');
        done = true; break;
      } catch (error) { if (signal?.aborted) throw error; errors.push(error.message); }
    }
    if (!done) throw new Error(`Cannot place blueprint block ${item} at ${key(p)}: ${errors.slice(-3).join('; ') || 'no clear side'}`);
    pending.delete(key(p)); placed++;
    progress({ placed, total: blueprint.blocks.length });
    if (placed % 20 === 0) log(`Blueprint: ${placed}/${blueprint.blocks.length} blocks verified`);
  }
  for (const b of blueprint.blocks) {
    const p = new Vec3(anchor.x + b.x, anchor.y + b.y, anchor.z + b.z);
    if (bot.blockAt(p)?.name !== b.item) throw new Error(`Final blueprint inspection failed at ${key(p)}`);
  }
  return { name: blueprint.name, placed, total: blueprint.blocks.length, verified: true, anchor };
}
