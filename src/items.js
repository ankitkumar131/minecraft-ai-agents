import { Vec3 } from 'vec3';
import { approachPlacement } from './placement.js';
import { supplyCreative } from './creative.js';
import { housePlan } from './plan.js';

const forbidden = new Set(['tnt', 'lava_bucket', 'fire_charge', 'flint_and_steel', 'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'jigsaw', 'bedrock', 'barrier', 'end_portal_frame']);

export function parseItemIntent(text) {
  const multi = text.trim().match(/^add\s+(.+?)\s+to\s+it[.!]?$/i);
  if (multi && /,|\s+and\s+/i.test(multi[1])) {
    const queries = multi[1].split(/\s*,\s*|\s+and\s+/i).map(part => part.trim().replace(/^(?:a|an|some)\s+/i, '').replace(/\s+/g, '_').toLowerCase());
    if (queries.length < 2 || queries.length > 6 || queries.some(q => !/^[a-z0-9_]{2,80}$/.test(q))) throw new Error('Use 2–6 item names separated by commas');
    return { action: 'item_sequence', queries, context: 'to it' };
  }
  const match = text.trim().match(/^(place|add|equip|hold)\s+(?:(?:a|an|some)\s+)?(.+?)(?:\s+(at my location|to it|in the house))?[.!]?$/i);
  if (!match) return null;
  const query = match[2].trim().replace(/^minecraft:/i, '').replace(/\s+/g, '_').toLowerCase();
  if (!/^[a-z0-9_]{2,80}$/.test(query)) throw new Error('Use an item name, such as oak door, door, or diamond sword');
  return { action: ['equip', 'hold'].includes(match[1].toLowerCase()) ? 'equip_item' : 'place_item', query, context: match[3] || null };
}

export function findItems(registry, query, offset = 0, limit = 25) {
  const needle = query.toLowerCase().replace(/\s+/g, '_');
  const matching = registry.itemsArray.filter(item => item.name.includes(needle));
  return { total: matching.length, items: matching.slice(offset, offset + limit).map(item => ({ name: item.name, displayName: item.displayName, placeable: !!registry.blocksByName[item.name] })) };
}

export function resolveItem(registry, query) {
  // For a generic name, use the *first* match in this server version's registry.
  // Exact names remain exact. Example 1.21.4: 'door' -> iron_door.
  if (registry.itemsByName[query]) return registry.itemsByName[query];
  // 'bed' must not resolve to bedrock, which is not a bed.
  if (query === 'bed') return registry.itemsArray.find(item => item.name.endsWith('_bed')) || null;
  return registry.itemsArray.find(item => item.name.includes(query)) || null;
}

export async function runItemTask(bot, intent, position, lastHouse, signal, allowed, log = () => {}) {
  if (bot.game?.gameMode !== 'creative') throw new Error('Creative item tasks require server-confirmed Creative mode');
  const item = resolveItem(bot.registry, intent.query);
  if (!item) throw new Error(`No Creative item matches '${intent.query}' in Minecraft ${bot.version}`);
  log(`Resolved '${intent.query}' to first matching item: ${item.name}`);
  if (signal?.aborted) throw new Error('Task cancelled');
  if (intent.action === 'equip_item') {
    await supplyCreative(bot, item.name, 1, signal, log);
    await bot.equip(bot.inventory.items().find(i => i.name === item.name), 'hand');
    return { item: item.name, equipped: true };
  }
  if (!allowed()) throw new Error('Move and Place permissions required');
  if (forbidden.has(item.name)) throw new Error(`${item.name} needs a hazardous-action approval workflow; placement is disabled`);
  if (!bot.registry.blocksByName[item.name]) throw new Error(`${item.name} is an item, not a directly placeable block. Try 'equip ${item.name}'.`);
  const door = item.name.endsWith('_door');
  const bed = item.name.endsWith('_bed');
  const lamp = item.name.includes('lamp') || item.name.includes('lantern');
  let target;
  if (lastHouse && (intent.context === 'to it' || intent.context === 'in the house' || (door && !intent.context))) {
    const { origin, spec } = lastHouse;
    target = door ? new Vec3(origin.x + Math.floor(spec.size / 2), origin.y + 1, origin.z)
      : lamp ? new Vec3(origin.x + spec.size - 3, origin.y + 1, origin.z + 2)
        : bed ? new Vec3(origin.x + 2, origin.y + 1, origin.z + 2)
          : new Vec3(origin.x + Math.floor(spec.size / 2), origin.y + 1, origin.z + 2);
  } else if (intent.context === 'to it' || intent.context === 'in the house') {
    throw new Error('No completed house found in this agent’s saved tasks; specify at my location');
  } else {
    target = new Vec3(Math.floor(position.x) + 2, Math.floor(position.y), Math.floor(position.z));
  }
  const block = bot.blockAt(target);
  if (block?.name === item.name) {
    log(`${item.name} already exists at ${target.x},${target.y},${target.z}; leaving it in place`);
    return { item: item.name, placedAt: { x: target.x, y: target.y, z: target.z }, alreadyPresent: true };
  }
  if (!block || block.name !== 'air') throw new Error(`Target ${target} must be loaded and empty (currently ${block?.name || 'unloaded'})`);
  const ground = bot.blockAt(target.offset(0, -1, 0));
  if (!ground || ground.boundingBox !== 'block') throw new Error(`Item ${item.name} needs solid support under ${target}`);
  if (door && bot.blockAt(target.offset(0, 1, 0))?.name !== 'air') throw new Error('Door needs two clear blocks above the floor');
  if (bed && ![target.offset(1, 0, 0), target.offset(-1, 0, 0), target.offset(0, 0, 1), target.offset(0, 0, -1)].some(p => bot.blockAt(p)?.name === 'air' && bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block')) throw new Error('Bed needs a second clear, supported cell');
  await supplyCreative(bot, item.name, 1, signal, log);
  await bot.equip(bot.inventory.items().find(i => i.name === item.name), 'hand');
  if (door) {
    // Two-block-high doors would intersect a bot hovering directly over them.
    const beside = new Vec3(target.x + 0.5, target.y, target.z - 1.5);
    if (bot.blockAt(new Vec3(target.x, target.y, target.z - 2))?.name !== 'air' || bot.blockAt(new Vec3(target.x, target.y + 1, target.z - 2))?.name !== 'air') throw new Error('Door approach needs two clear blocks outside the entrance');
    await bot.creative.flyTo(beside);
    if (bot.entity.position.distanceTo(target.offset(0.5, 0.5, 0.5)) > 3.5) throw new Error('Bot cannot reach the door position');
  } else await approachPlacement(bot, target, signal);
  if (!allowed() || signal?.aborted) throw new Error('Item task cancelled or Place permission revoked');
  if (bot.blockAt(target)?.name !== 'air') throw new Error('Target changed while approaching');
  await bot.placeBlock(bot.blockAt(target.offset(0, -1, 0)), new Vec3(0, 1, 0));
  const deadline = Date.now() + 2000;
  while (bot.blockAt(target)?.name !== item.name && Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Task cancelled');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (bot.blockAt(target)?.name !== item.name) throw new Error(`Server did not confirm ${item.name} placement at ${target}`);
  log(`Verified ${item.name} at ${target.x},${target.y},${target.z}`);
  return { item: item.name, placedAt: { x: target.x, y: target.y, z: target.z } };
}

export async function runItemSequence(bot, intent, position, lastHouse, signal, allowed, log = () => {}, progress = () => {}) {
  if (!lastHouse) throw new Error('No completed house in this agent’s saved memory for “to it”');
  if (bot.game?.gameMode !== 'creative') throw new Error('Creative item sequences require Creative mode');
  // Validate all names before modifying the world. A roof is a structural check,
  // not an item with the word "roof" in its registry name.
  for (const query of intent.queries) {
    if (query === 'roof') continue;
    const item = resolveItem(bot.registry, query);
    if (!item) throw new Error(`No Creative item matches '${query}'`);
    if (forbidden.has(item.name) || !bot.registry.blocksByName[item.name]) throw new Error(`${item.name} cannot be safely placed`);
  }
  if (intent.queries.includes('roof')) {
    const { origin, spec } = lastHouse;
    const missing = housePlan(origin, spec.size).filter(p => p.y === origin.y + 5 && bot.blockAt(new Vec3(p.x, p.y, p.z))?.name !== spec.material);
    if (missing.length) throw new Error(`House roof has ${missing.length} missing blocks; roof repair is not yet supported`);
    log(`Verified existing ${spec.size}x${spec.size} roof; no new roof needed`);
  }
  const results = [];
  for (const query of intent.queries) {
    if (signal?.aborted) throw new Error('Task cancelled');
    const result = query === 'roof' ? { item: 'roof', verified: true }
      : await runItemTask(bot, { action: 'place_item', query, context: 'to it' }, position, lastHouse, signal, allowed, log);
    results.push(result);
    progress({ completed: results.length, total: intent.queries.length, results });
  }
  return { items: results };
}
