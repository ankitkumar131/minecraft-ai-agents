import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
const { pathfinder, Movements } = pathfinderPackage;
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildHouse } from './builder.js';
import { interpret, providersFromEnv } from './ollama.js';
import { MemoryStore } from './memory.js';
import { ProfileStore } from './profiles.js';

const env = process.env;
const host = env.HTTP_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !env.API_TOKEN) throw new Error('API_TOKEN required for non-loopback HTTP binding');
const store = new ProfileStore(env.PROFILES_FILE || 'data/profiles.json');
await store.load();
const agents = new Map();
const draining = new Map();
const memory = new MemoryStore(env.MEMORY_DIR || 'data/memory');
const providers = providersFromEnv(env);
const recent = state => ({ profile: state.profile, connected: state.connected, status: state.status, job: state.job, events: state.events, location: state.connected && state.bot?.entity?.position ? { x: Math.floor(state.bot.entity.position.x), y: Math.floor(state.bot.entity.position.y), z: Math.floor(state.bot.entity.position.z) } : null });
function event(state, message) {
  if (state.retired) return;
  state.events.push({ at: new Date().toISOString(), message });
  if (state.events.length > 100) state.events.shift();
  void memory.record(state.profile.name, 'event', { message }).catch(error => console.error('Memory write failed:', error));
}
function start(profile) {
  const previous = agents.get(profile.name);
  if (previous) {
    if (previous.connected || previous.status === 'connecting') throw new Error('Agent already started');
    stop(previous);
  }
  const state = { profile, connected: false, status: 'connecting', job: null, controller: null, events: [], bot: null };
  agents.set(profile.name, state);
  try {
    const bot = mineflayer.createBot({ host: env.MC_HOST || 'localhost', port: Number(env.MC_PORT || 25565),
      username: profile.name, auth: env.MC_AUTH || 'offline', version: env.MC_VERSION || undefined });
    state.bot = bot;
    bot.loadPlugin(pathfinder);
    bot.on('spawn', () => { bot.pathfinder.setMovements(new Movements(bot)); state.connected = true; state.status = 'online'; event(state, 'Joined Minecraft'); });
    bot.on('end', () => { state.connected = false; state.status = 'offline'; state.controller?.abort(); event(state, 'Disconnected'); });
    bot.on('error', error => {
      state.status = 'error';
      // Mineflayer can emit the same socket error twice in quick succession.
      const message = String(error.message);
      if (state.lastError === message && Date.now() - state.lastErrorAt < 5000) return;
      state.lastError = message;
      state.lastErrorAt = Date.now();
      event(state, `Connection error: ${message}`);
      if (/ECONNREFUSED/i.test(message)) {
        event(state, `No Minecraft server is accepting connections at ${env.MC_HOST || 'localhost'}:${env.MC_PORT || 25565}. Keep the world open to LAN, check the port shown in Minecraft chat, then restart the bot.`);
      } else if (/No data available for version|unsupported.*version/i.test(message)) {
        event(state, 'Minecraft version is not supported by the installed Mineflayer protocol data. Use a separate, backed-up world on a supported Java version; changing MC_VERSION alone cannot make an incompatible server work.');
      }
    });
    bot.on('kicked', reason => event(state, `Kicked: ${String(reason).slice(0, 200)}`));
    bot.on('chat', (username, message) => {
      if (username === bot.username || !message.toLowerCase().startsWith(`!${profile.name.toLowerCase()} `)) return;
      if (!env.MC_ALLOWED_PLAYERS?.split(',').map(x => x.trim()).includes(username)) return;
      const player = bot.players[username]?.entity;
      if (!player) return bot.chat('I cannot see your position. Come closer.');
      submit(state, message.slice(profile.name.length + 2), player.position.clone())
        .then(() => bot.chat('Task accepted; check the console for progress.'))
        .catch(error => bot.chat(error.message.slice(0, 200)));
    });
  } catch (error) { agents.delete(profile.name); throw error; }
  event(state, 'Connecting to Minecraft');
  return state;
}
function stop(state) {
  state.retired = true;
  state.controller?.abort();
  state.bot?.pathfinder?.stop();
  try { state.bot?.quit(); } catch (error) { console.error('Bot quit failed:', error); }
  agents.delete(state.profile.name);
  if (state.taskPromise) {
    const pending = state.taskPromise.catch(error => console.error('Task drain failed:', error));
    draining.set(state.profile.name, pending);
    void pending.finally(() => { if (draining.get(state.profile.name) === pending) draining.delete(state.profile.name); });
  }
}
function submit(state, text, position) {
  if (!state.connected) throw new Error('Agent is not online');
  if (!state.profile.permissions.move || !state.profile.permissions.place) throw new Error('Move and place permissions required');
  if (state.job && ['planning', 'building'].includes(state.job.status)) throw new Error('Agent is busy');
  const controller = new AbortController();
  state.controller = controller;
  const job = { status: 'planning', request: text };
  state.job = job;
  event(state, `Planning: ${text}`);
  state.taskPromise = (async () => {
    try {
      const spec = await interpret(text, { providers, signal: controller.signal, onAttempt: name => event(state, `Trying AI provider: ${name}`) });
      if (controller.signal.aborted) throw new Error('Cancelled');
      job.spec = spec;
      job.status = 'building';
      job.origin = { x: Math.floor(position.x), y: Math.floor(position.y) - 1, z: Math.floor(position.z) };
      event(state, `Building ${spec.size}x${spec.size} ${spec.material} house`);
      job.result = await buildHouse(state.bot, job.origin, spec, progress => { job.progress = progress; if (progress.placed % 20 === 0) event(state, `Placed ${progress.placed}/${progress.total} blocks`); }, controller.signal, () => state.profile.permissions.move && state.profile.permissions.place);
      job.status = 'done'; event(state, 'House completed');
    } catch (error) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error.message;
      event(state, `${job.status}: ${error.message}`);
    } finally {
      try { await memory.record(state.profile.name, 'task', { request: text, status: job.status, spec: job.spec, origin: job.origin, result: job.result, error: job.error }); }
      catch (error) { event(state, `Memory write failed: ${error.message}`); }
    }
  })();
  return job;
}
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('Request too large'); }
  return JSON.parse(text);
}
const server = createServer(async (req, res) => {
  const reply = (code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/') {
    const html = await readFile(new URL('../public/index.html', import.meta.url));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" });
    return res.end(html);
  }
  if (req.method === 'GET' && req.url === '/app.js') {
    const js = await readFile(new URL('../public/app.js', import.meta.url));
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(js);
  }
  if (env.API_TOKEN && req.headers.authorization !== `Bearer ${env.API_TOKEN}`) return reply(401, { error: 'Unauthorized' });
  const memoryMatch = req.url?.match(/^\/api\/agents\/([A-Za-z0-9_]{3,16})\/memory$/);
  if (req.method === 'GET' && memoryMatch) return reply(store.profiles.has(memoryMatch[1]) ? 200 : 404, store.profiles.has(memoryMatch[1]) ? await memory.settled(memoryMatch[1]) : { error: 'Unknown agent' });
  if (req.method === 'GET' && req.url === '/api/agents') return reply(200, [...store.profiles.values()].map(profile => agents.has(profile.name) ? recent(agents.get(profile.name)) : { profile, connected: false, status: 'stopped', job: null, events: [] }));
  try {
    if (req.method === 'POST' && req.url === '/api/agents') return reply(201, await store.add(await body(req)));
    const deletion = req.url?.match(/^\/api\/agents\/([A-Za-z0-9_]{3,16})$/);
    if (deletion && req.method === 'DELETE') {
      const name = deletion[1];
      if (!store.profiles.has(name)) return reply(404, { error: 'Unknown agent' });
      if (agents.has(name)) return reply(409, { error: 'Stop the agent before deleting it' });
      await draining.get(name);
      // Remove the persisted profile before its history; on memory failure the API reports it.
      await store.remove(name);
      await memory.remove(name);
      return reply(200, { deleted: true });
    }
    const match = req.url?.match(/^\/api\/agents\/([A-Za-z0-9_]{3,16})\/(start|stop|task|cancel)$/);
    if (!match || req.method !== 'POST') return reply(404, { error: 'Not found' });
    const profile = store.profiles.get(match[1]);
    if (!profile) return reply(404, { error: 'Unknown agent' });
    if (match[2] === 'start') return reply(202, recent(start(profile)));
    const state = agents.get(profile.name);
    if (!state) throw new Error('Agent is not started');
    if (match[2] === 'stop') { stop(state); return reply(200, { stopped: true }); }
    if (match[2] === 'cancel') { state.controller?.abort(); state.bot.pathfinder.stop(); return reply(200, { cancelled: !!state.controller }); }
    const { request, player } = await body(req);
    if (typeof request !== 'string' || !request.trim() || request.length > 300) throw new Error('Invalid task');
    const position = state.bot.players[player]?.entity?.position;
    if (!position) throw new Error('Player must be visible to this bot');
    return reply(202, submit(state, request, position.clone()));
  } catch (error) { return reply(/already|busy/i.test(error.message) ? 409 : 400, { error: error.message }); }
});
server.listen(Number(env.HTTP_PORT || 3000), host, () => console.log(`AI Players listening on ${host}:${server.address().port}`));
