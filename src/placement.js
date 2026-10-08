import { Vec3 } from 'vec3';
import pathfinderPackage from 'mineflayer-pathfinder';
const { goals } = pathfinderPackage;

export async function approachPlacement(bot, target, signal) {
  if (signal?.aborted) throw new Error('Build cancelled');
  if (bot.game?.gameMode === 'creative') {
    // Pathfinder walks in Creative and can fall into caves; hover above the target.
    const hover = new Vec3(target.x + 0.5, target.y + 1.5, target.z + 0.5);
    await bot.creative.flyTo(hover);
  } else {
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2));
  }
  if (signal?.aborted) throw new Error('Build cancelled');
  const feet = bot.entity?.position;
  if (!feet || feet.distanceTo(new Vec3(target.x + 0.5, target.y + 0.5, target.z + 0.5)) > 3.5) {
    throw new Error(`Bot is out of reach of ${target.x},${target.y},${target.z} (bot at ${feet?.x?.toFixed(1)},${feet?.y?.toFixed(1)},${feet?.z?.toFixed(1)})`);
  }
}
