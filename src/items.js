import { Vec3 } from 'vec3';
import { approachPlacement } from './placement.js';
import { supplyCreative } from './creative.js';

const forbidden = new Set(['tnt', 'lava_bucket', 'fire_charge', 'flint_and_steel', 'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'jigsaw', 'bedrock', 'barrier', 'end_portal_frame']);

export function parseItemIntent(text) {
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
  return registry.itemsByName[query] || registry.itemsArray.find(item => item.name.includes(query)) || null;
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
  let target;
  if (lastHouse && (intent.context === 'to it' || intent.context === 'in the house' || (door && !intent.context))) {
    const { origin, spec } = lastHouse;
    target = new Vec3(origin.x + Math.floor(spec.size / 2), origin.y + 1, origin.z + (door ? 0 : 2));
  } else if (intent.context === 'to it' || intent.context === 'in the house') {
    throw new Error('No completed house found in this agent’s saved tasks; specify at my location');
  } else {
    target = new Vec3(Math.floor(position.x) + 2, Math.floor(position.y), Math.floor(position.z));
  }
  const block = bot.blockAt(target);
  if (!block || block.name !== 'air') throw new Error(`Target ${target} must be loaded and empty (currently ${block?.name || 'unloaded'})`);
  const ground = bot.blockAt(target.offset(0, -1, 0));
  if (!ground || ground.boundingBox !== 'block') throw new Error(`Item ${item.name} needs solid support under ${target}`);
  if (door && bot.blockAt(target.offset(0, 1, 0))?.name !== 'air') throw new Error('Door needs two clear blocks above the floor');
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
