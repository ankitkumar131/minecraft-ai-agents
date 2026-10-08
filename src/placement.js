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

// Mineflayer's creative.flyTo waits for a final 'move' event even when it has
// reached its destination. Step client movement like it does, but finish based
// on distance, while keeping the action interruptible and time bounded.
export async function flyCreative(bot, destination, signal, timeoutMs = 20000) {
  if (bot.game?.gameMode !== 'creative') throw new Error('Creative flight requires Creative mode');
  bot.creative.startFlying();
  const deadline = Date.now() + timeoutMs;
  while (bot.entity.position.distanceTo(destination) > 0.55) {
    if (signal?.aborted) throw new Error('Flight cancelled');
    if (Date.now() >= deadline) throw new Error(`Creative flight to ${destination.x.toFixed(1)},${destination.y.toFixed(1)},${destination.z.toFixed(1)} timed out; bot at ${bot.entity.position.x.toFixed(1)},${bot.entity.position.y.toFixed(1)},${bot.entity.position.z.toFixed(1)}`);
    const vector = destination.minus(bot.entity.position);
    bot.entity.velocity = new Vec3(0, 0, 0);
    bot.entity.position = bot.entity.position.plus(vector.scaled(0.5 / vector.norm()));
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  bot.entity.position = destination;
  await new Promise(resolve => setTimeout(resolve, 100));
  if (signal?.aborted) throw new Error('Flight cancelled');
  if (bot.entity.position.distanceTo(destination) > 0.75) throw new Error('Minecraft server corrected the Creative flight position');
}

export async function approachInterior(bot, origin, size, target, signal, log = () => {}) {
  const pos = bot.entity.position;
  const inside = pos.x > origin.x + 1 && pos.x < origin.x + size - 1 && pos.z > origin.z + 1 && pos.z < origin.z + size - 1 && pos.y > origin.y && pos.y < origin.y + 4.5;
  if (inside) return approachPlacement(bot, target, signal);
  const x = origin.x + Math.floor(size / 2);
  const entrance = new Vec3(x, origin.y + 1, origin.z);
  if (bot.blockAt(entrance)?.name !== 'air' || bot.blockAt(entrance.offset(0, 1, 0))?.name !== 'air') {
    throw new Error('House entrance is blocked (possibly by an iron door). Finish interior before installing the door, or clear the entrance. No blocks were broken.');
  }
  const waypoints = [
    new Vec3(pos.x, origin.y + 8, pos.z),
    new Vec3(x + 0.5, origin.y + 8, origin.z - 2.5),
    new Vec3(x + 0.5, origin.y + 1, origin.z - 2.5),
    new Vec3(x + 0.5, origin.y + 1, origin.z + 1.5)
  ];
  for (const [index, waypoint] of waypoints.entries()) {
    if (signal?.aborted) throw new Error('Interior navigation cancelled');
    log(`Navigating to house interior: waypoint ${index + 1}/${waypoints.length}`);
    await flyCreative(bot, waypoint, signal);
  }
  await approachPlacement(bot, target, signal);
}

export async function approachPlacement(bot, target, signal, timeoutMs = 20000) {
  if (signal?.aborted) throw new Error('Build cancelled');
  if (bot.game?.gameMode === 'creative') {
    const hover = new Vec3(target.x + 0.5, target.y + 1.5, target.z + 0.5);
    await flyCreative(bot, hover, signal, timeoutMs);
  } else {
    await boundedMove(bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2)), `Path to ${target.x},${target.y},${target.z}`, timeoutMs, signal);
  }
  if (signal?.aborted) throw new Error('Build cancelled');
  const feet = bot.entity?.position;
  if (!feet || feet.distanceTo(new Vec3(target.x + 0.5, target.y + 0.5, target.z + 0.5)) > 3.5) {
    throw new Error(`Bot is out of reach of ${target.x},${target.y},${target.z} (bot at ${feet?.x?.toFixed(1)},${feet?.y?.toFixed(1)},${feet?.z?.toFixed(1)})`);
  }
}
