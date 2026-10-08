import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

// Files are keyed by validated Minecraft names, never by untrusted paths.
export class MemoryStore {
  constructor(dir = 'data/memory') { this.dir = dir; this.pending = new Map(); }
  path(name) { if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Invalid agent name'); return join(this.dir, name + '.json'); }
  async get(name) {
    try { return JSON.parse(await readFile(this.path(name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { agent: name, events: [], tasks: [] }; throw error; }
  }
  async settled(name) { await this.pending.get(name); return this.get(name); }
  record(name, kind, data) {
    const prior = this.pending.get(name) || Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      const memory = await this.get(name);
      const entry = { at: new Date().toISOString(), ...data };
      if (kind === 'event') memory.events.push(entry);
      else if (kind === 'task') memory.tasks.push(entry);
      else throw new Error('Invalid memory kind');
      await mkdir(this.dir, { recursive: true });
      const path = this.path(name);
      await writeFile(path + '.tmp', JSON.stringify(memory, null, 2));
      await rename(path + '.tmp', path);
      return entry;
    });
    this.pending.set(name, next);
    return next;
  }
}
