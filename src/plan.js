// A deliberately small, auditable blueprint. Coordinates are absolute block coordinates.
export function housePlan(origin, size = 10) {
  if (!Number.isInteger(size) || size < 5 || size > 16) throw new Error('House size must be between 5 and 16');
  if (![origin.x, origin.y, origin.z].every(Number.isInteger)) throw new Error('Origin must be integer block coordinates');
  const { x, y, z } = origin;
  const blocks = [];
  // Keep the existing terrain as a floor. Front door is in the south wall.
  for (let h = 1; h <= 4; h++) {
    for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) {
      if (dx !== 0 && dz !== 0 && dx !== size - 1 && dz !== size - 1) continue;
      if (dz === 0 && dx === Math.floor(size / 2) && h <= 2) continue;
      blocks.push({ x: x + dx, y: y + h, z: z + dz });
    }
  }
  // Roof grows inwards from the supported walls. The bot needs a route to each block.
  for (let layer = 0; layer < Math.ceil(size / 2); layer++) {
    for (let dx = layer; dx < size - layer; dx++) for (let dz = layer; dz < size - layer; dz++) {
      if (dx === layer || dz === layer || dx === size - 1 - layer || dz === size - 1 - layer) {
        blocks.push({ x: x + dx, y: y + 5, z: z + dz });
      }
    }
  }
  return blocks;
}

export function parseCommand(text) {
  const match = text.trim().match(/^build\s+(?:a\s+)?(?:(\d+)\s*[x×]\s*(\d+)\s+)?(stone|cobblestone)\s+house(?:\s+at\s+my\s+location)?[.!]?$/i);
  if (!match) return null;
  if (match[1] && match[1] !== match[2]) throw new Error('Only square houses are supported');
  const size = match[1] ? Number(match[1]) : 10;
  if (!Number.isInteger(size) || size < 5 || size > 16) throw new Error('House size must be between 5 and 16');
  return { size, material: match[3].toLowerCase() };
}
