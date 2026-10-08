import { Vec3 } from 'vec3';
import { approachPlacement, navigateCreative } from './placement.js';
import { housePlan } from './plan.js';

const directions = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
const solid = block => block && block.boundingBox === 'block';
const key = p => `${p.x},${p.y},${p.z}`;

export async function buildHouse(bot, origin, { size, material }, onProgress = () => {}, signal, authorize = () => true, onEvent = () => {}) {
  const plan = housePlan(origin, size);
  // Never overwrite terrain, buildings, fluids, or a player's position.
  for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) {
    const ground = bot.blockAt(new Vec3(origin.x + dx, origin.y, origin.z + dz));
    if (!solid(ground)) throw new Error('Build site must have solid ground across the entire footprint');
  }
  for (const p of plan) {
    const block = bot.blockAt(new Vec3(p.x, p.y, p.z));
    if (!block || (block.name !== 'air' && block.name !== material)) throw new Error(`Build site obstructed or unloaded at ${key(p)}`);
  }
  const needed = plan.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z)).name === 'air').length;
  const available = bot.inventory.items().filter(item => item.name === material).reduce((sum, item) => sum + item.count, 0);
  if (available < needed) throw new Error(`Need ${needed} ${material} blocks; bot has ${available}. Supply blocks before building.`);
  let placed = 0;
  for (const p of plan) {
    if (signal?.aborted) throw new Error('Build cancelled');
    if (!authorize()) throw new Error('Move/place permission revoked');
    const target = new Vec3(p.x, p.y, p.z);
    if (bot.blockAt(target)?.name === material) { placed++; continue; }
    const item = bot.inventory.items().find(i => i.name === material);
    if (!item) throw new Error(`Ran out of ${material}`);
    await bot.equip(item, 'hand');
    let success = false;
    const failures = [];
    let attempts = 0;
    const creative = bot.game?.gameMode === 'creative';
    // A solid reference is mandatory: placeBlock cannot create a block in air.
    // A side position avoids intersecting the target with the bot's server-side
    // hitbox, which a hover directly over the block can do on laggy LAN worlds.
    const vantages = creative ? [[2, 0], [-2, 0], [0, 2], [0, -2]] : [[0, 0]];
    for (const [dx, dy, dz] of directions) {
      if (success) break;
      for (const [vx, vz] of vantages) {
        if (success || attempts >= 12) break;
        if (!solid(bot.blockAt(target.offset(dx, dy, dz)))) continue;
        attempts++;
        try {
          if (signal?.aborted || !authorize()) throw new Error('Build cancelled or permission revoked');
          if (creative) {
            const vantage = new Vec3(p.x + vx + 0.5, p.y + 1, p.z + vz + 0.5);
            if (bot.blockAt(vantage.floored())?.name !== 'air' || bot.blockAt(vantage.floored().offset(0, 1, 0))?.name !== 'air') throw new Error('Side position obstructed');
            await navigateCreative(bot, vantage, signal, onEvent);
          } else await approachPlacement(bot, target, signal);
          if (signal?.aborted || !authorize()) throw new Error('Build cancelled or permission revoked');
          if (bot.blockAt(target)?.name === material) { success = true; break; }
          if (bot.blockAt(target)?.name !== 'air') throw new Error('Target changed while moving');
          if (bot.entity.position.distanceTo(target.offset(0.5, 0.5, 0.5)) > 4.4) throw new Error('Bot is out of placement range');
          if (Object.values(bot.entities || {}).some(entity => entity !== bot.entity && entity.position && Math.floor(entity.position.x) === p.x && Math.floor(entity.position.y) === p.y && Math.floor(entity.position.z) === p.z)) throw new Error('Entity occupies target');
          const reference = bot.blockAt(target.offset(dx, dy, dz));
          if (!solid(reference)) throw new Error('Reference block changed while moving');
          try { await bot.placeBlock(reference, new Vec3(-dx, -dy, -dz)); }
          catch (error) { if (bot.blockAt(target)?.name !== material) throw error; }
          const deadline = Date.now() + 2000;
          while (bot.blockAt(target)?.name !== material && Date.now() < deadline) {
            if (signal?.aborted) throw new Error('Build cancelled');
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (bot.blockAt(target)?.name !== material) throw new Error('Server did not confirm placement');
          success = true;
          if (attempts > 1) onEvent(`Placement at ${key(p)} recovered using another side/reference after ${attempts} attempts`);
        } catch (error) {
          if (signal?.aborted) throw new Error('Build cancelled');
          failures.push(error.message);
        }
      }
    }
    if (!success) {
      const support = directions.some(([dx, dy, dz]) => solid(bot.blockAt(target.offset(dx, dy, dz))));
      throw new Error(`Cannot place ${material} at ${key(p)}: ${support ? `${attempts} side/reference attempts failed (${[...new Set(failures)].slice(-3).join('; ')})` : 'no adjacent solid support; temporary staging would be required'}`);
    }
    placed++;
    onProgress({ placed, total: plan.length });
  }
  const missing = plan.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name !== material);
  if (missing.length) throw new Error(`Inspection found ${missing.length} missing blocks; first: ${key(missing[0])}`);
  return { placed, total: plan.length, verified: true };
}
