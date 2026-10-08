import { Vec3 } from 'vec3';
import { findSite, prepareSite } from './site.js';
import { housePlan } from './plan.js';
import { supplyCreative } from './creative.js';
import { buildHouse } from './builder.js';

export const VILLAGE_SPEC = Object.freeze({ size: 7, material: 'cobblestone' });
const verified = (bot, origin) => housePlan(origin, VILLAGE_SPEC.size).every(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name === VILLAGE_SPEC.material);

// A bounded project, not a simulation of a civilization. Never overlaps
// recorded houses; each structure is server-verified before the next starts.
export async function createStarterVillage(bot, playerPosition, previousHouses, resumeHouses, signal, permissions, log, progress) {
  if (bot.game?.gameMode !== 'creative') throw new Error('Starter village currently requires server-confirmed Creative mode');
  const reserved = previousHouses.map(h => ({ x: h.origin.x, z: h.origin.z, size: h.spec.size }));
  const built = resumeHouses.filter(h => verified(bot, h.origin));
  for (const h of built) reserved.push({ x: h.origin.x, z: h.origin.z, size: VILLAGE_SPEC.size });
  for (let index = built.length; index < 3; index++) {
    if (signal?.aborted) throw new Error('Village project cancelled');
    const anchor = index === 0 ? playerPosition : index === 1
      ? { x: built[0].origin.x + VILLAGE_SPEC.size + 5, y: built[0].origin.y + 1, z: built[0].origin.z }
      : { x: built[0].origin.x, y: built[0].origin.y + 1, z: built[0].origin.z + VILLAGE_SPEC.size + 5 };
    const site = findSite(bot, anchor, VILLAGE_SPEC.size, VILLAGE_SPEC.material, index === 0 ? 18 : 12, reserved, true);
    const { origin } = site;
    reserved.push({ x: origin.x, z: origin.z, size: VILLAGE_SPEC.size });
    log(`Village house ${index + 1}/3: site ${origin.x},${origin.y},${origin.z}`);
    if (!permissions()) throw new Error('Village task needs Move, Break and Place permissions');
    if (site.fills.length) await supplyCreative(bot, 'dirt', site.fills.length, signal, log);
    await prepareSite(bot, site, signal, permissions, log);
    const missing = housePlan(origin, VILLAGE_SPEC.size).filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name === 'air').length;
    await supplyCreative(bot, VILLAGE_SPEC.material, missing, signal, log);
    await buildHouse(bot, origin, VILLAGE_SPEC, p => { if (p.placed % 20 === 0) log(`Village house ${index + 1}/3: ${p.placed}/${p.total} blocks`); }, signal, permissions);
    if (!verified(bot, origin)) throw new Error(`Village house ${index + 1} failed final inspection`);
    built.push({ origin, spec: { ...VILLAGE_SPEC } });
    progress(built);
    log(`Village house ${index + 1}/3 verified`);
  }
  return { houses: built, scope: 'three small cobblestone houses; no roads, farms or NPCs' };
}
