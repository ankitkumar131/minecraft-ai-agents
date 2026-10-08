import { Vec3 } from 'vec3';
import { approachPlacement } from './placement.js';
import { housePlan } from './plan.js';

const directions = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
const solid = block => block && block.boundingBox === 'block';
const key = p => `${p.x},${p.y},${p.z}`;

export async function buildHouse(bot, origin, { size, material }, onProgress = () => {}, signal, authorize = () => true) {
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
    let lastError;
    for (const [dx, dy, dz] of directions) {
      if (!solid(bot.blockAt(target.offset(dx, dy, dz)))) continue;
      try {
        await approachPlacement(bot, target, signal);
        const reference = bot.blockAt(target.offset(dx, dy, dz));
        if (!solid(reference)) throw new Error('Reference block changed while moving');
        if (signal?.aborted) throw new Error('Build cancelled');
        if (!authorize()) throw new Error('Move/place permission revoked');
        // Do not place inside a player or another entity occupying this cell.
        if (Object.values(bot.entities).some(entity => entity !== bot.entity && entity.position && Math.floor(entity.position.x) === p.x && Math.floor(entity.position.y) === p.y && Math.floor(entity.position.z) === p.z)) throw new Error('Entity occupies target');
        await bot.placeBlock(reference, new Vec3(-dx, -dy, -dz));
        // Wait for the server block update rather than trusting a successful API call.
        const deadline = Date.now() + 2000;
        while (bot.blockAt(target)?.name !== material && Date.now() < deadline) {
          if (signal?.aborted) throw new Error('Build cancelled');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (bot.blockAt(target)?.name !== material) throw new Error('Server did not confirm placement');
        success = true;
        break;
      } catch (error) { lastError = error; }
    }
    if (!success) throw new Error(`Cannot place block at ${key(p)}: ${lastError?.message ?? 'no adjacent solid block'}`);
    placed++;
    onProgress({ placed, total: plan.length });
  }
  const missing = plan.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name !== material);
  if (missing.length) throw new Error(`Inspection found ${missing.length} missing blocks; first: ${key(missing[0])}`);
  return { placed, total: plan.length, verified: true };
}
