const cards = document.querySelector('#cards');
const message = document.querySelector('#message');
const token = document.querySelector('#token');
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(token.value ? { authorization: `Bearer ${token.value}` } : {}), 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function node(tag, text, parent) { const element = document.createElement(tag); element.textContent = text; parent.append(element); return element; }
function button(label, parent, callback) { const el = node('button', label, parent); el.addEventListener('click', async () => { try { await callback(); await refresh(); } catch (error) { show(error); } }); }
function show(error) { message.textContent = error.message || String(error); message.className = 'error'; }
async function refresh() {
  try {
    const agents = await api('/api/agents');
    cards.replaceChildren();
    for (const agent of agents) {
      const card = document.createElement('article'); cards.append(card);
      node('h3', `${agent.profile.name} — ${agent.profile.role}`, card);
      node('p', `Status: ${agent.status} · Goal: ${agent.profile.goal}`, card);
      node('p', agent.location ? `Live position: X ${agent.location.x} · Y ${agent.location.y} · Z ${agent.location.z}` : 'Live position: unavailable (offline or connecting)', card);
      button('View saved memory', card, async () => { const saved = await api(`/api/agents/${agent.profile.name}/memory`); alert(JSON.stringify(saved, null, 2)); });
      node('small', `Permissions: ${Object.entries(agent.profile.permissions).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none'}`, card);
      card.append(document.createElement('br'));
      if (agent.status === 'stopped') button('Start', card, () => api(`/api/agents/${agent.profile.name}/start`, {}));
      else {
        button('Stop', card, () => api(`/api/agents/${agent.profile.name}/stop`, {}));
        if (agent.job && ['planning', 'building'].includes(agent.job.status)) button('Cancel task', card, () => api(`/api/agents/${agent.profile.name}/cancel`, {}));
        const player = document.createElement('input'); player.placeholder = 'Your Minecraft name'; card.append(player);
        const request = document.createElement('input'); request.value = 'Build a 10x10 stone house at my location'; card.append(request);
        button('Send task', card, () => api(`/api/agents/${agent.profile.name}/task`, { player: player.value, request: request.value }));
      }
      if (agent.job) node('pre', `Task: ${agent.job.status} ${agent.job.progress ? `${agent.job.progress.placed}/${agent.job.progress.total}` : ''}\n${agent.job.error || ''}`, card);
      const log = document.createElement('pre'); log.textContent = agent.events.slice(-8).map(e => `${e.at} ${e.message}`).join('\n'); card.append(log);
    }
    message.textContent = ''; message.className = '';
  } catch (error) { show(error); }
}
document.querySelector('#create').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.target);
  try { await api('/api/agents', { name: form.get('name'), role: form.get('role'), personality: form.get('personality'), goal: form.get('goal'), model: form.get('model'), permissions: { move: form.has('move'), place: form.has('place') } }); event.target.reset(); await refresh(); }
  catch (error) { show(error); }
});
token.addEventListener('change', refresh);
refresh(); setInterval(() => { if (!cards.contains(document.activeElement)) refresh(); }, 3000);
