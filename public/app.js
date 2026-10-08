const cards = document.querySelector('#cards');
const message = document.querySelector('#message');
const token = document.querySelector('#token');
const pendingDeletes = new Set();
const itemSearchResults = new Map();
async function api(path, data, method) {
  const response = await fetch(path, { method: method || (data === undefined ? 'GET' : 'POST'), headers: { ...(token.value ? { authorization: `Bearer ${token.value}` } : {}), 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function node(tag, text, parent) { const element = document.createElement(tag); element.textContent = text; parent.append(element); return element; }
function button(label, parent, callback) { const el = node('button', label, parent); el.addEventListener('click', async () => { try { message.textContent = ''; message.className = ''; await callback(); await refresh(); } catch (error) { show(error); } }); }
function show(error) { message.textContent = error.message || String(error); message.className = 'error'; }
async function refresh() {
  try {
    const agents = await api('/api/agents');
    cards.replaceChildren();
    for (const agent of agents) {
      const card = document.createElement('article'); cards.append(card);
      node('h3', `${agent.profile.name} — ${agent.profile.role}`, card);
      node('p', `Status: ${agent.status} · Goal: ${agent.profile.goal}`, card);
      if (agent.connected && !agent.job) node('p', 'Idle — this bot waits for a task. The Goal field does not start work automatically.', card);
      node('p', `Minecraft game mode: ${agent.gameMode || 'unavailable'}`, card);
      node('p', agent.location ? `Live position: X ${agent.location.x} · Y ${agent.location.y} · Z ${agent.location.z}` : 'Live position: unavailable (offline or connecting)', card);
      button('View saved memory', card, async () => { const saved = await api(`/api/agents/${agent.profile.name}/memory`); alert(JSON.stringify(saved, null, 2)); });
      node('small', `Permissions: ${Object.entries(agent.profile.permissions).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none'}`, card);
      card.append(document.createElement('br'));
      if (!agent.profile.permissions.break || !agent.profile.permissions.craft) {
        button('Enable gathering (break + craft)', card, () => api(`/api/agents/${agent.profile.name}/enable-gathering`, {}));
      }
      if (agent.status === 'stopped') {
        button('Start', card, () => api(`/api/agents/${agent.profile.name}/start`, {}));
        button(pendingDeletes.has(agent.profile.name) ? 'Confirm permanent deletion' : 'Delete player', card, async () => {
          if (!pendingDeletes.has(agent.profile.name)) { pendingDeletes.add(agent.profile.name); return; }
          await api(`/api/agents/${agent.profile.name}`, undefined, 'DELETE');
          pendingDeletes.delete(agent.profile.name);
        });
        if (pendingDeletes.has(agent.profile.name)) {
          node('p', 'This permanently deletes the profile AND its saved memory.', card);
          button('Keep player', card, () => { pendingDeletes.delete(agent.profile.name); });
        }
      }
      else {
        button('Stop', card, () => api(`/api/agents/${agent.profile.name}/stop`, {}));
        if (agent.job && ['planning', 'finding_site', 'preparing_site', 'gathering', 'building', 'placing_item'].includes(agent.job.status)) button('Cancel task', card, () => api(`/api/agents/${agent.profile.name}/cancel`, {}));
        if (agent.connected) {
          const modeLabel = node('label', 'Request game mode (requires bot OP permission on server)', card);
          const select = document.createElement('select'); modeLabel.append(select);
          for (const mode of ['survival', 'creative', 'adventure', 'spectator']) {
            const option = document.createElement('option'); option.value = mode; option.textContent = mode; option.selected = mode === agent.gameMode; select.append(option);
          }
          button('Change game mode', card, () => api(`/api/agents/${agent.profile.name}/gamemode`, { mode: select.value }));
          const playerLabel = node('label', 'Your Minecraft username (not the bot name)', card);
          const player = document.createElement('input'); player.placeholder = 'e.g. Ankit'; playerLabel.append(player);
          const requestLabel = node('label', 'Task (house, Creative item, or add items to the completed house)', card);
          const request = document.createElement('input'); request.value = 'Build a 10x10 cobblestone house at my location'; requestLabel.append(request);
          button('Send task', card, () => api(`/api/agents/${agent.profile.name}/task`, { player: player.value.trim(), request: request.value }));
          const searchLabel = node('label', 'Search Creative items (all items for this Minecraft version)', card);
          const search = document.createElement('input'); search.placeholder = 'e.g. door'; searchLabel.append(search);
          button('Search items', card, async () => { itemSearchResults.set(agent.profile.name, await api(`/api/agents/${agent.profile.name}/items?q=${encodeURIComponent(search.value)}`)); });
          const results = itemSearchResults.get(agent.profile.name);
          if (results) node('small', `${results.total} matches; first 25: ${results.items.map(i => `${i.name}${i.placeable ? '' : ' (not directly placeable)'}`).join(', ')}`, card);
        }
      }
      if (agent.job) node('pre', `Task: ${agent.job.status}${agent.job.phase ? ` — ${agent.job.phase}` : ''} ${agent.job.progress ? `${agent.job.progress.placed ?? agent.job.progress.completed}/${agent.job.progress.total}` : ''}\n${agent.job.error || ''}`, card);
      const log = document.createElement('pre'); log.textContent = agent.events.slice(-8).map(e => `${e.at} ${e.message}`).join('\n'); card.append(log);
    }
  } catch (error) { show(error); }
}
document.querySelector('#create').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.target);
  try { await api('/api/agents', { name: form.get('name'), role: form.get('role'), personality: form.get('personality'), goal: form.get('goal'), model: form.get('model'), permissions: { move: form.has('move'), place: form.has('place'), break: form.has('break'), craft: form.has('craft') } }); event.target.reset(); await refresh(); }
  catch (error) { show(error); }
});
token.addEventListener('change', refresh);
refresh(); setInterval(() => { if (!cards.contains(document.activeElement)) refresh(); }, 3000);
