import { Vec3 } from 'vec3';

const key = p => `${p.x},${p.y},${p.z}`;
const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const center = p => new Vec3(p.x + 0.5, p.y, p.z + 0.5);
const cell = p => new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
const heuristic = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

export function clearFlightLine(bot, from, to) {
  const vector = to.minus(from);
  const steps = Math.max(1, Math.ceil(vector.norm() / 0.25));
  for (let i = 1; i <= steps; i++) {
    const pos = from.plus(vector.scaled(i / steps));
    for (const [dx, dz] of [[0, 0], [-0.28, 0.28], [0.28, -0.28]]) {
      for (const dy of [0, 1.7]) {
        const block = bot.blockAt(new Vec3(Math.floor(pos.x + dx), Math.floor(pos.y + dy), Math.floor(pos.z + dz)));
        if (!block || block.boundingBox === 'block' || block.name === 'water' || block.name === 'lava') return false;
      }
    }
  }
  return true;
}

// Air-only 3D A* (no digging or teleporting). Bounded search prevents hanging on
// blocked/protected worlds. Returns a sequence of safe bot-feet coordinates.
export function findFlightRoute(bot, from, destination, maxNodes = 5000) {
  const start = cell(from), goal = cell(destination);
  const low = { x: Math.min(start.x, goal.x) - 16, y: Math.min(start.y, goal.y) - 8, z: Math.min(start.z, goal.z) - 16 };
  const high = { x: Math.max(start.x, goal.x) + 16, y: Math.max(start.y, goal.y) + 8, z: Math.max(start.z, goal.z) + 16 };
  const passable = p => {
    if (p.x < low.x || p.x > high.x || p.y < low.y || p.y > high.y || p.z < low.z || p.z > high.z) return false;
    for (const y of [p.y, p.y + 1]) {
      const b = bot.blockAt(new Vec3(p.x, y, p.z));
      if (!b || b.boundingBox === 'block' || b.name === 'water' || b.name === 'lava') return false;
    }
    return true;
  };
  if (!passable(goal)) throw new Error(`Creative destination ${key(goal)} is obstructed or unloaded`);
  const open = [{ p: start, g: 0, f: heuristic(start, goal) }];
  const best = new Map([[key(start), 0]]), parent = new Map(), closed = new Set();
  for (let visited = 0; open.length && visited < maxNodes; visited++) {
    let index = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[index].f) index = i;
    const current = open.splice(index, 1)[0];
    const currentKey = key(current.p);
    if (closed.has(currentKey)) continue;
    if (currentKey === key(goal)) {
      const path = [];
      let cursor = currentKey;
      while (cursor !== key(start)) {
        const [x, y, z] = cursor.split(',').map(Number);
        path.push(center({ x, y, z }));
        cursor = parent.get(cursor);
      }
      path.reverse();
      // Merge consecutive air-only steps into longer safe flight segments.
      const waypoints = [];
      let anchor = from;
      for (let i = 0; i < path.length; i++) {
        if (!clearFlightLine(bot, anchor, path[i])) {
          if (i === 0 || !clearFlightLine(bot, anchor, path[i - 1])) throw new Error('Route segment is blocked despite passable cells');
          waypoints.push(path[i - 1]);
          anchor = path[i - 1];
        }
      }
      if (!clearFlightLine(bot, anchor, destination)) {
        if (path.length && clearFlightLine(bot, anchor, path.at(-1)) && clearFlightLine(bot, path.at(-1), destination)) waypoints.push(path.at(-1));
        else throw new Error('Final Creative approach is obstructed');
      }
      waypoints.push(destination);
      return waypoints;
    }
    closed.add(currentKey);
    for (const [dx, dy, dz] of directions) {
      const p = new Vec3(current.p.x + dx, current.p.y + dy, current.p.z + dz);
      const nextKey = key(p), cost = current.g + 1;
      if (closed.has(nextKey) || (best.has(nextKey) && best.get(nextKey) <= cost) || !passable(p)) continue;
      best.set(nextKey, cost);
      parent.set(nextKey, currentKey);
      open.push({ p, g: cost, f: cost + heuristic(p, goal) });
    }
  }
  throw new Error(`No unobstructed Creative route from ${key(start)} to ${key(goal)} within ${maxNodes} search steps; entrance may be closed or the region unloaded`);
}
