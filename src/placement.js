import { Vec3 } from 'vec3';
import pathfinderPackage from 'mineflayer-pathfinder';
const { goals } = pathfinderPackage;

export async function boundedMove(promise, description, timeoutMs, signal) {
  if (signal?.aborted) throw new Error('Movement cancelled');
  let timer, onAbort;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${description} timed out after ${Math.round(timeoutMs / 1000)}s; check whether the bot is stuck or chunks are unloaded`)), timeoutMs);
    if (signal) { onAbort = () => reject(new Error('Movement cancelled')); signal.addEventListener('abort', onAbort, { once: true }); }
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort); }
}

export async function approachPlacement(bot, target, signal, timeoutMs = 20000) {
  if (signal?.aborted) throw new Error('Build cancelled');
  if (bot.game?.gameMode === 'creative') {
    // Pathfinder walks in Creative and can fall into caves; hover above the target.
    const hover = new Vec3(target.x + 0.5, target.y + 1.5, target.z + 0.5);
    await boundedMove(bot.creative.flyTo(hover), `Creative flight to ${target.x},${target.y},${target.z}`, timeoutMs, signal);
  } else {
    await boundedMove(bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2)), `Path to ${target.x},${target.y},${target.z}`, timeoutMs, signal);
  }
  if (signal?.aborted) throw new Error('Build cancelled');
  const feet = bot.entity?.position;
  if (!feet || feet.distanceTo(new Vec3(target.x + 0.5, target.y + 0.5, target.z + 0.5)) > 3.5) {
    throw new Error(`Bot is out of reach of ${target.x},${target.y},${target.z} (bot at ${feet?.x?.toFixed(1)},${feet?.y?.toFixed(1)},${feet?.z?.toFixed(1)})`);
  }
}
