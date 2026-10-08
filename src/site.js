import { Vec3 } from 'vec3';
import { housePlan } from './plan.js';
import pathfinderPackage from 'mineflayer-pathfinder';
const { goals } = pathfinderPackage;
import { navigateCreative, boundedMove } from './placement.js';

const soil = new Set(['dirt', 'grass_block']);
const floor = new Set(['dirt', 'grass_block', 'stone', 'cobblestone', 'sandstone']);
const plant = name => ['grass', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'dandelion', 'poppy', 'azure_bluet', 'blue_orchid', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'].includes(name) || name.endsWith('_tulip');
const at = (bot, x, y, z) => bot.blockAt(new Vec3(x, y, z));

// A candidate never contains buildings, wood, liquids, unknown ground, or unloaded blocks.
export function analyzeSite(bot, origin, size, material) {
  const cuts = [], fills = [], plants = [];
  for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) {
    const x = origin.x + dx, z = origin.z + dz;
    const base = at(bot, x, origin.y, z);
    const lower = at(bot, x, origin.y - 1, z);
    const upper = at(bot, x, origin.y + 1, z);
    if (!base || !lower || !upper) return null;
    if (floor.has(base.name)) { /* already level */ }
    else if (base.name === 'air' && floor.has(lower.name)) fills.push({ x, y: origin.y, z });
    else return null;
    if (soil.has(upper.name) && floor.has(base.name)) cuts.push({ x, y: origin.y + 1, z });
    else if (upper.name !== 'air' && !plant(upper.name) && upper.name !== material) return null;
    for (let h = 1; h <= 5; h++) {
      const block = at(bot, x, origin.y + h, z);
      if (!block) return null;
      if (h === 1 && soil.has(block.name) && floor.has(base.name)) continue;
      if (plant(block.name)) plants.push({ x, y: origin.y + h, z });
      else if (block.name !== 'air' && block.name !== material) return null;
    }
  }
  if (cuts.length + fills.length > 32 || fills.length > cuts.length) return null;
  return { origin, cuts, fills, plants };
}

export function inspectSite(bot, origin, size, material) {
  return housePlan(origin, size).every(p => at(bot, p.x, p.y, p.z)?.name === material || at(bot, p.x, p.y, p.z)?.name === 'air') &&
    Array.from({ length: size * size }, (_, i) => at(bot, origin.x + i % size, origin.y, origin.z + Math.floor(i / size))?.boundingBox === 'block').every(Boolean);
}

export function findSite(bot, playerPosition, size, material, radius = 24, reserved = [], requireEmpty = false) {
  const start = { x: Math.floor(playerPosition.x), y: Math.floor(playerPosition.y) - 1, z: Math.floor(playerPosition.z) };
  let best = null, score = Infinity;
  for (let distance = 0; distance <= radius; distance++) {
    for (let dx = -distance; dx <= distance; dx++) for (let dz = -distance; dz <= distance; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
      for (const dy of [0, -1, 1, -2, 2]) {
        const origin = { x: start.x + dx, y: start.y + dy, z: start.z + dz };
        if (reserved.some(h => origin.x < h.x + h.size + 3 && origin.x + size + 3 > h.x && origin.z < h.z + h.size + 3 && origin.z + size + 3 > h.z)) continue;
        if (requireEmpty && housePlan(origin, size).some(p => at(bot, p.x, p.y, p.z)?.name === material)) continue;
        const candidate = analyzeSite(bot, origin, size, material);
        if (!candidate) continue;
        const cost = distance * 4 + candidate.cuts.length * 4 + candidate.fills.length * 100 + candidate.plants.length;
        if (cost < score) { best = candidate; score = cost; }
        if (cost === 0) return candidate;
      }
    }
    if (best && best.fills.length === 0 && distance * 4 > score) break;
  }
  if (!best) throw new Error(`No safe ${size}x${size} site within ${radius} blocks: need natural ground with at most one-block height changes, no buildings or liquids, and enough high dirt to fill low spots.`);
  return best;
}

export async function approachSiteBlock(bot, target, signal, log = () => {}) {
  if (bot.game?.gameMode !== 'creative') {
    await boundedMove(bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2)), `Site path to ${target.x},${target.y},${target.z}`, 20000, signal);
    return;
  }
  const failures = [];
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
    if (signal?.aborted) throw new Error('Site preparation cancelled');
    const side = new Vec3(target.x + dx + 0.5, target.y + 1, target.z + dz + 0.5);
    const foot = bot.blockAt(side.floored()), head = bot.blockAt(side.floored().offset(0, 1, 0));
    if (!foot || !head || foot.boundingBox === 'block' || head.boundingBox === 'block') continue;
    try {
      await navigateCreative(bot, side, signal, log);
      if (bot.entity.position.distanceTo(target.offset(0.5, 0.5, 0.5)) <= 4.4) return;
      failures.push('out of reach');
    } catch (error) { if (signal?.aborted) throw error; failures.push(error.message); }
  }
  throw new Error(`Cannot approach site block ${target.x},${target.y},${target.z} from a clear side: ${[...new Set(failures)].slice(-2).join('; ') || 'all sides obstructed'}`);
}

export async function prepareSite(bot, site, signal, allowed, log = () => {}) {
  const check = () => { if (signal?.aborted) throw new Error('Site preparation cancelled'); if (!allowed()) throw new Error('Move, break and place permissions required for site preparation'); };
  for (const p of [...site.plants, ...site.cuts]) {
    check();
    const target = new Vec3(p.x, p.y, p.z);
    const block = bot.blockAt(target);
    if (block?.name === 'air') continue;
    await approachSiteBlock(bot, target, signal, log);
    check();
    await bot.dig(block);
  }
  // Wait briefly for mined dirt to enter inventory before using it to level holes.
  for (const p of site.fills) {
    check();
    const target = new Vec3(p.x, p.y, p.z);
    if (bot.blockAt(target)?.name !== 'air') throw new Error('Build site changed during preparation');
    const below = bot.blockAt(target.offset(0, -1, 0));
    if (!below || below.boundingBox !== 'block') throw new Error('Cannot support foundation');
    const deadline = Date.now() + 3000;
    while (!bot.inventory.items().some(i => i.name === 'dirt') && Date.now() < deadline) { check(); await new Promise(resolve => setTimeout(resolve, 100)); }
    const item = bot.inventory.items().find(i => i.name === 'dirt');
    if (!item) throw new Error('Not enough dirt collected to fill the low spots');
    // From Creative flight, stand beside the hole rather than inside it.
    // Survival retains normal pathfinder movement via the same bounded helper.
    await approachSiteBlock(bot, target, signal, log);
    check();
    if (Object.values(bot.entities || {}).some(entity => entity !== bot.entity && entity.position && Math.floor(entity.position.x) === p.x && Math.floor(entity.position.y) === p.y && Math.floor(entity.position.z) === p.z)) throw new Error(`An entity occupies the fill cell ${p.x},${p.y},${p.z}`);
    await bot.equip(item, 'hand');
    await bot.placeBlock(below, new Vec3(0, 1, 0));
    const until = Date.now() + 2000;
    while (bot.blockAt(target)?.name !== 'dirt' && Date.now() < until) { check(); await new Promise(resolve => setTimeout(resolve, 100)); }
    if (bot.blockAt(target)?.name !== 'dirt') throw new Error(`Server did not confirm dirt at ${p.x},${p.y},${p.z}; check server build permissions`);
  }
  log(`Cleared ${site.plants.length} plants, leveled ${site.cuts.length} high spots and filled ${site.fills.length} low spots`);
}
