import mcDataFactory from 'minecraft-data';
import { Vec3 } from 'vec3';
import { housePlan } from './plan.js';
import pathfinderPackage from 'mineflayer-pathfinder';
const { goals } = pathfinderPackage;

const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const check = (signal, allowed) => { if (signal?.aborted) throw new Error('Gathering cancelled'); if (!allowed()) throw new Error('Mining permission required'); };
const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const exposed = (bot, block) => neighbors.some(([x, y, z]) => bot.blockAt(block.position.offset(x, y, z))?.name === 'air');

async function craft(bot, data, name, times, table) {
  const recipe = bot.recipesFor(data.itemsByName[name].id, null, 1, table || null)[0];
  if (!recipe) throw new Error(`Cannot craft ${name} with available ingredients`);
  await bot.craft(recipe, times, table || null);
}

async function makePickaxe(bot, data, site, signal, allowed, log) {
  if (bot.inventory.items().filter(i => i.name.endsWith('_pickaxe')).length >= 6) return;
  const wood = 'oak_log';
  for (let attempts = 0; count(bot, wood) < 7 && attempts < 18; attempts++) {
    check(signal, allowed);
    const block = bot.findBlock({ matching: data.blocksByName[wood].id, maxDistance: 32,
      useExtraInfo: b => exposed(bot, b) && Math.abs(b.position.x - site.x) > 2 && Math.abs(b.position.z - site.z) > 2 });
    if (!block) throw new Error('No accessible oak logs nearby to craft a wooden pickaxe');
    await bot.collectBlock.collect(block);
    log(`Collected oak logs: ${count(bot, wood)}/7`);
  }
  check(signal, allowed);
  if (count(bot, 'oak_planks') < 28) await craft(bot, data, 'oak_planks', 7, null);
  if (count(bot, 'stick') < 12) await craft(bot, data, 'stick', 3, null);
  if (!count(bot, 'crafting_table')) await craft(bot, data, 'crafting_table', 1, null);
  // Place our own table outside the build footprint; never overwrite existing blocks.
  const position = new Vec3(site.x - 2, site.y + 1, site.z - 2);
  const below = bot.blockAt(position.offset(0, -1, 0));
  if (!below || below.boundingBox !== 'block' || bot.blockAt(position)?.name !== 'air') throw new Error('Cannot place a crafting table beside the site; clear the southwest side');
  await bot.equip(bot.inventory.items().find(i => i.name === 'crafting_table'), 'hand');
  await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 2));
  check(signal, allowed);
  await bot.placeBlock(below, new Vec3(0, 1, 0));
  const table = bot.blockAt(position);
  if (table?.name !== 'crafting_table') throw new Error('Crafting table placement was not confirmed');
  await craft(bot, data, 'wooden_pickaxe', 6, table);
  log('Crafted six wooden pickaxes for gathering');
}

export async function gatherForHouse(bot, site, spec, signal, allowed, log = () => {}) {
  const plan = housePlan(site, spec.size);
  const needed = plan.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name === 'air').length;
  if (count(bot, spec.material) >= needed) return;
  if (spec.material !== 'cobblestone') throw new Error('Mining stone drops cobblestone, not stone. Request a cobblestone house for automatic gathering.');
  const data = mcDataFactory(bot.version);
  if (!data?.blocksByName?.stone) throw new Error(`No block data for Minecraft ${bot.version}`);
  await makePickaxe(bot, data, site, signal, allowed, log);
  const excluded = new Set(plan.map(p => `${p.x},${p.y},${p.z}`));
  let attempts = 0;
  while (count(bot, 'cobblestone') < needed && attempts++ < needed * 3) {
    check(signal, allowed);
    const block = bot.findBlock({ matching: data.blocksByName.stone.id, maxDistance: 32,
      useExtraInfo: b => exposed(bot, b) && !excluded.has(`${b.position.x},${b.position.y},${b.position.z}`) && b.position.y < site.y });
    if (!block) throw new Error(`Only ${count(bot, 'cobblestone')}/${needed} cobblestone collected; no exposed reachable stone in 32 blocks. Try a rocky area.`);
    const before = count(bot, 'cobblestone');
    await bot.collectBlock.collect(block);
    if (count(bot, 'cobblestone') > before && count(bot, 'cobblestone') % 16 === 0) log(`Gathered ${count(bot, 'cobblestone')}/${needed} cobblestone`);
  }
  if (count(bot, 'cobblestone') < needed) throw new Error(`Gathering stopped at ${count(bot, 'cobblestone')}/${needed} cobblestone`);
}
