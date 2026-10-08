import { Vec3 } from 'vec3';
import { housePlan } from './plan.js';

export function inspectSite(bot, origin, size, material) {
  for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) {
    const ground = bot.blockAt(new Vec3(origin.x + dx, origin.y, origin.z + dz));
    if (!ground || ground.boundingBox !== 'block') return false;
  }
  return housePlan(origin, size).every(p => {
    const block = bot.blockAt(new Vec3(p.x, p.y, p.z));
    return block && (block.name === 'air' || block.name === material);
  });
}

// Bounded search; never modifies or levels terrain, never accepts unloaded cells.
export function findSite(bot, playerPosition, size, material, radius = 16) {
  const start = { x: Math.floor(playerPosition.x), y: Math.floor(playerPosition.y) - 1, z: Math.floor(playerPosition.z) };
  for (let distance = 0; distance <= radius; distance++) {
    for (let dx = -distance; dx <= distance; dx++) for (let dz = -distance; dz <= distance; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
      for (const dy of [0, -1, 1, -2, 2]) {
        const origin = { x: start.x + dx, y: start.y + dy, z: start.z + dz };
        if (inspectSite(bot, origin, size, material)) return origin;
      }
    }
  }
  throw new Error(`No clear flat ${size}x${size} site found within ${radius} blocks of your position. Move to a flat open area and try again.`);
}
