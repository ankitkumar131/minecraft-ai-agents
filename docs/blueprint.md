# Minecraft AI Player Platform — implementation blueprint

Status: design + partially implemented vertical slice. See [README](../README.md) for what runs today. The platform must not present simulated intentions as completed world actions.

## 1. Product contract

An operator creates an identity (Minecraft username/account, role, personality, goals, skills and permissions), starts/stops a bot, gives it a task, and watches **observed** location, execution stages and failures. Multiple agents must have isolated state. The AI proposes bounded plans; trusted code validates and executes them. A failed AI provider must not erase player history or duplicate actions.

Initial milestone: builder receives a house request and consumes supplied blocks. Longer-term: resource acquisition, inspection/repair, projects and delegation. Survival gameplay is not a generic command-generation API. No world-modifying action is authorized by text alone: permissions, area policy, resource budgets and approvals precede execution.

## 2. Architecture and boundaries

```
Browser dashboard (currently vanilla JS, eventually Angular)
   | authenticated REST; later WebSocket/SSE
Application service (currently Node; optional later FastAPI)
   | profile registry, memory, task scheduler, audit, policy, approvals
AI gateway -> ordered providers (OpenAI-compatible API / Ollama)
   | validated structured decision, never direct code or Minecraft commands
Minecraft gateway (Node + Mineflayer)
   | one bot session per identity; observation -> safe action -> result
Minecraft Java server
```

**Source of truth:** Minecraft for live position, inventory, blocks and entities; local persistence for profile, task history and authored memories; never an LLM conversation window. AI provider switches change only inference, not identity or storage. No keys in profiles, memory, logs, browser or prompt. If FastAPI is added, it owns the app database and dispatches restricted intents to a private Node adapter; do not expose Mineflayer's arbitrary command surface over HTTP.

## 3. Current implementation map

| Capability | Status | Location |
|---|---|---|
| Persistent profiles; isolated running bots | Implemented (JSON) | `src/profiles.js`, `src/index.js` |
| Per-agent persisted events and completed task records | Implemented (per-name JSON files) | `src/memory.js`, `data/memory/` |
| Provider fallback for request interpretation | Implemented | `src/ollama.js` |
| Dashboard live coordinates, task progress and latest events | Implemented, 3-second polling | `public/` |
| Deterministic stone/cobblestone house action, Creative hover placement, nearby natural-site selection and bounded vegetation/soil preparation | Implemented, unverified on live server | `src/plan.js`, `src/site.js`, `src/builder.js` |
| Bounded nearby logs→wooden pickaxe→exposed stone→cobblestone gathering; Creative inventory provisioning | Experimental; unverified in live world | `src/gather.js` |
| Versioned Creative item catalog, bounded placement/equip/household follow-ups and roof repair | Implemented; live placement unverified | `src/items.js`, `src/creative.js` |
| Bounded provider-backed compound task planner and safe executor | Implemented for house/furnishing actions; no general world agent | `src/agent-planner.js`, `src/index.js` |
| General resource gathering, advanced permissions and approvals | Planned | Phase 2 |
| Autonomous observation/decision loop, replayable event log | Planned | Phase 3 |
| FastAPI, Angular, SQLite/PostgreSQL, WebSocket | Planned, not shipped | Phase 4 |

Stored personality, goal and model fields are **metadata today**; the global ordered provider list selects the inference model. Do not describe agents as independent or claim memory is automatically fed back into prompts yet.

## 4. Provider contract and failover

`AI_PROVIDERS` is an ordered JSON array in server environment. Each entry: `{name, type, url, model, keyEnv?}`. Types: `ollama` (`/api/generate`) or `openai-compatible` (`chat/completions` appended to the base URL, e.g. `https://host/v1/`). `keyEnv` points to a **server environment variable name**; startup fails if an API provider lacks its key. Use provider-specific base URLs/model IDs. Some compatible providers do not support `response_format: {type:'json_object'}`; test their compatibility before deployment or adapt their transport. Standard supported house syntax skips the provider entirely.

```sh
export PRIMARY_AI_KEY='...'
export AI_PROVIDERS='[{"name":"primary","type":"openai-compatible","url":"https://provider.example/v1/","model":"model-id","keyEnv":"PRIMARY_AI_KEY"},{"name":"local","type":"ollama","url":"http://127.0.0.1:11434","model":"qwen2.5:7b"}]'
```

For each request: call primary with 15s timeout; on network error, HTTP error, malformed response, or timeout, try next; cancel propagates immediately. Valid `unsupported`/policy-invalid output **stops** rather than shopping providers for a more permissive answer. If all fail, fail the job visibly; never silently execute a guessed plan. No automatic retries on the same provider in this version. API keys are not printed; do not put secrets in URLs, model names or error strings. Future: circuit breakers, rate-limit-aware backoff, per-provider metrics, capability validation and secret manager. Provider failover applies only to planning, **not replaying Minecraft actions**. Changing providers does not touch `data/memory/<name>.json`.

## 5. Per-player memory model

Current file: `{agent, events:[{at,message}], tasks:[{at,request,status,spec,origin,result,error}]}`. Each validated player name maps to its own file, so Aria's history never becomes Bruno's. Writes are serialized per agent and use rename of a temporary file. `GET /api/agents/:name/memory` returns stored history; recent live events are also held in memory for the card. Profile registry is separate (`data/profiles.json`). Both directories are Git-ignored and must be backed up together. Memory is **history**, not verified world truth: before an action re-observe inventory/blocks/location. Current files grow unbounded; high-volume telemetry belongs in a database, not this format. Abrupt shutdown can lose in-flight writes; use transactional SQLite WAL or PostgreSQL for production.

Future SQLite schema: `agents(id PK, name UNIQUE, profile_json, created_at)`, `tasks(id PK, agent_id FK, state, intent_json, plan_json, started_at, ended_at)`, `events(id PK, agent_id FK, task_id FK NULL, seq, timestamp, type, payload_json)`, `facts(id PK, agent_id FK, kind, key, value_json, source, observed_at, expires_at)`, `approvals(id PK, task_id FK, action_json, state, requested_at, decided_at)`, `messages(id PK, from_agent FK, to_agent FK, task_id FK, body, timestamp)`. Unique `(agent_id, seq)`; transactional append + checkpoint; versioned migrations. Keep a machine-readable fact's provenance and expiry. Never serialize hidden LLM reasoning as a memory or console log. On provider changes, reload only validated relevant facts and recent tasks; keep prompt context bounded.

## 6. Live dashboard semantics

`GET /api/agents` returns each stored profile with runtime `status`, `connected`, `location` (integer X/Y/Z or null), current job/progress, and up to 100 recent runtime events. Browser polls every 3 seconds; this is **near-live**, not a guaranteed event stream. Offline location is null rather than stale. `GET /api/agents/:name/memory` shows persisted records. Event timestamps are UTC ISO-8601. Current dashboard shows status, coordinates, task progress/error and recent events; it does not expose private chain-of-thought. Future: authenticated WebSocket/SSE with sequence IDs, resync on gaps, filtering by agent/task/severity, retention policies, and server-observed telemetry (inventory, health, dimension). Never claim a player is building merely because the LLM says so: report measured placed-block count.

## 7. Tasks and acceptance criteria

### Phase 0 — stabilize current slice (P0)
- [ ] Test against a dedicated Java server with version matrix; verify connection, spawning, placement, pathing and chat. **Accept:** one 10x10 shell completes in a backed-up test world; server-side block count matches blueprint.
- [ ] Fix unsupported terrain/navigation and inspect-after-place. **Accept:** each placement is verified; interrupted jobs resume without duplicate changes.
- [ ] Add server integration tests, disconnect/cancel and obstruction tests. **Accept:** no actions after cancellation and errors identify failing coordinates.
- [ ] Harden authorization and shutdown. **Accept:** authenticated API; bounded request body; queue drains on SIGTERM; memory writes survive process restart.

### Phase 1 — durable multi-player operations (P0)
- [ ] Migrate profiles/memory/tasks to SQLite WAL with migrations, backups, retention and agent IDs. **Accept:** restart retains agent history; no cross-agent leakage; concurrent append has monotonic sequence.
- [ ] Add update/delete/disable agent APIs with safe lifecycle, name/account uniqueness and account-aware online-mode login. **Accept:** two permitted bot accounts connect independently, stopping one does not stop the other.
- [ ] Introduce task IDs, idempotency keys and state machine (`queued→planning→awaiting_approval→running→verifying→done|failed|cancelled`). **Accept:** duplicate client submissions do not build twice.
- [ ] Formal permissions: move/place/break/craft/container/combat/TNT/fire/lava plus region and block budgets. **Accept:** all execution paths enforce permissions, not just UI.
- [ ] Stream logs/position via authenticated SSE/WebSocket, with resync. **Accept:** coordinates update during movement; reconnect recovers missing events.

### Phase 2 — safe builder loop (P1)
- [ ] Observe loaded chunks, inventory, nearby players, protected area, equipment/health; expire stale observations. **Accept:** planner input includes timestamps and provenance.
- [ ] Build resource acquisition primitives with bounded gather/craft/deposit actions; avoid other players' storage by default. **Accept:** missing stone produces a safe gather plan or explicit request, not an impossible build.
- [ ] Approval queue for large modification, breakage, hazardous blocks and area changes. **Accept:** denying approval causes zero corresponding world changes.
- [ ] Inspect completed structures and repair missing blocks. **Accept:** server-world audit confirms blueprint and reports deviations.

### Phase 3 — autonomous agents (P2)
- [ ] Bounded observe→plan→policy→act→verify loop with step/time/token budgets, cooldowns and kill switch. **Accept:** no uncontrolled activity when goal is achieved or provider is down.
- [ ] Facts/relationships/locations stored per agent with source and confidence; inject only relevant memories. **Accept:** changing AI provider preserves prior verified facts, while stale facts trigger re-observation.
- [ ] Mayor task graph, delegation and message bus with dependencies/reservations. **Accept:** builder waits for miner's verified delivery; conflicting projects cannot claim same area/resources.

### Phase 4 — platform scale (P3)
- [ ] Separate app API (FastAPI if useful) from Node Minecraft gateway via authenticated internal protocol; introduce Angular admin UI. **Accept:** independent deploy/restart; Node owns bot IO; DB owns task state.
- [ ] Provider registry, rate-limit controls, budgets, health checks, cost display, credential rotation. **Accept:** one provider outage fails over within bounded time with audit trail and without action replay.
- [ ] Minecraft server compatibility/security testing, metrics, backups, deployment docs. **Accept:** restore drill reproduces profiles/history and agents remain stopped until operator starts them.

## 8. Security and operational rules

Use licensed Minecraft accounts and server rules. Start on a private backed-up test world. Protect the API with a strong token; do not publish HTTP without TLS/reverse proxy and proper auth. Treat player chat, provider output and memory as untrusted input. Validate every plan server-side; no shell commands, arbitrary Minecraft commands or credential-bearing requests from model output. Minimize world modification, require human approval for destructive actions, and make cancel/stop prominent. Each online-mode bot needs its own valid account. Neither provider fallback nor memory implies actual game success: observe and verify it.
