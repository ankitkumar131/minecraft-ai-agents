import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function validateProfile(input) {
  if (!input || typeof input !== 'object') throw new Error('Profile required');
  const name = String(input.name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Name must be a Minecraft username (3-16 letters, numbers or underscores)');
  const role = String(input.role || '').trim();
  const personality = String(input.personality || '').trim();
  const goal = String(input.goal || '').trim();
  if (!role || role.length > 80 || personality.length > 300 || !goal || goal.length > 500) throw new Error('Invalid role, personality or goal');
  const permissions = { move: input.permissions?.move === true, place: input.permissions?.place === true };
  const model = String(input.model || 'qwen2.5:7b').trim();
  if (!model || model.length > 100) throw new Error('Invalid model');
  return { name, role, personality, goal, permissions, model };
}

export class ProfileStore {
  constructor(path) { this.path = path; this.profiles = new Map(); }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      for (const profile of data) this.profiles.set(profile.name, validateProfile(profile));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async add(input) {
    const profile = validateProfile(input);
    if (this.profiles.has(profile.name)) throw new Error('Agent name already exists');
    this.profiles.set(profile.name, profile);
    try { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path + '.tmp', JSON.stringify([...this.profiles.values()], null, 2)); await rename(this.path + '.tmp', this.path); }
    catch (error) { this.profiles.delete(profile.name); throw error; }
    return profile;
  }
}
