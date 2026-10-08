# AI Minecraft Players

Create a Minecraft bot from a web dashboard, give it a house-building task, and watch its live coordinates, progress and activity log. Each bot has its own profile and saved task/event history. AI providers can fail over in order without losing that history.

> **Current scope:** This is a working *prototype*, not the finished autonomous civilization. A bot can build a simple stone/cobblestone house; for **cobblestone** it can attempt to collect nearby supported tree logs, craft wooden pickaxes and mine exposed stone in Survival, or request materials from server-confirmed Creative inventory. Gathering is bounded and may fail if resources are inaccessible. It **cannot** farm, gather arbitrary materials, talk to other agents, or independently pursue its stored goal yet. Minecraft-server integration has not been verified in this environment. See [the full project blueprint](docs/blueprint.md) for implementation tasks and acceptance criteria.

Running Minecraft through a Windows launcher with a single-player world? Follow the [Windows single-player/LAN guide](docs/windows-singleplayer.md) first.

## 1. What you need

1. **Node.js 20.6+** (Node 22 recommended) and npm. Verify: `node --version`.
2. A **Minecraft Java Edition server**, accessible from the machine running this app. Try a backed-up private test world first. The bot needs permission to place blocks. Use Minecraft/accounts in accordance with their licensing and server rules. TLauncher is not required.
3. One account/identity **per bot**. For an offline-mode **private** server, bots can connect with their profile names. For an online-mode server, Minecraft authentication and a valid account per bot are required; start with one bot. Never expose an offline-mode server publicly.
4. Optionally, **Ollama** or an API provider. The exact house task below requires *no AI provider call*. For other phrasing, a provider is required.

## 2. Install and configure

```sh
git clone https://github.com/ankitkumar131/minecraft-ai-agents.git
cd minecraft-ai-agents
npm ci
cp .env.example .env
```

Edit `.env` with your server values:

```dotenv
MC_HOST=localhost
MC_PORT=25565
MC_AUTH=offline
HTTP_HOST=127.0.0.1
HTTP_PORT=3000
MC_ALLOWED_PLAYERS=YourMinecraftName
```

`MC_AUTH=offline` is **only** for an offline-mode private server. For an online-mode server use `MC_AUTH=microsoft`. If server version detection fails, set `MC_VERSION` to the server version, such as `1.20.4`. The optional `MC_ALLOWED_PLAYERS` enables in-game chat tasks only for exact names listed (comma-separated); leave empty to disable in-game chat tasks and use the dashboard. Do not commit `.env` or API keys.

### Optional AI provider fallback

For local AI, install Ollama independently and run `ollama pull qwen2.5:7b`. To prefer an OpenAI-compatible API and fall back to Ollama, put the following in your `.env` **as one line** (replace the URL and model with your provider's actual values):

```dotenv
PRIMARY_AI_KEY=your-private-key
AI_PROVIDERS=[{"name":"primary","type":"openai-compatible","url":"https://your-provider.example/v1/","model":"your-model","keyEnv":"PRIMARY_AI_KEY"},{"name":"local","type":"ollama","url":"http://127.0.0.1:11434","model":"qwen2.5:7b"}]
```

The app reads the key from `PRIMARY_AI_KEY` on the **server**, not from the browser or player profile. Providers are tried in listed order on HTTP/network/timeout/malformed-response failures. If all fail, the task fails with an error; no speculative build happens. An explicitly unsupported request does not fail over. Not every “OpenAI-compatible” endpoint supports the JSON response format used here; verify yours first. For local-only operation, omit `AI_PROVIDERS` and use the `OLLAMA_URL`/`OLLAMA_MODEL` defaults in `.env.example`.

## 3. Start the application

```sh
node --env-file=.env src/index.js
```

Open **http://127.0.0.1:3000/** on that machine. For a basic connectivity check before opening Minecraft, the dashboard should load and `curl http://127.0.0.1:3000/api/agents` should return `[]` on a fresh install.

## 4. Create and start a player

1. In **Create player**, enter a Minecraft-compatible name, e.g. `Aria` (3–16 letters/numbers/underscores), role `Builder`, personality, goal, and leave **Allow movement** and **Allow placing blocks** checked; also check **Allow breaking blocks** and **Allow crafting tools** to enable gathering. Existing profiles created before these options were added have them disabled: click **Enable gathering (break + craft)** on their dashboard card to opt in without deleting their memory.
2. Click **Create player**. Click **Start** on Aria's card. Wait for **online**; if it stays offline or shows an error, check the app terminal, server address, server version, connection mode and account.
3. A new profile persists in `data/profiles.json`. Starting a profile creates a separate Mineflayer connection; stopping it disconnects the bot. To remove a profile, click **Stop**, then **Delete player** and **Confirm permanent deletion** (or **Keep player** to cancel). Deletion also permanently removes its saved memory.

## 5. Give it a build task

1. For a no-supplies attempt, use **cobblestone** and enable movement, placement, breaking and crafting when creating the profile. In **Survival**, the bot needs at least seven accessible logs of one supported wood species (oak, spruce, birch, jungle, acacia, dark oak, mangrove, cherry or pale oak) within 48 blocks, exposed **stone** within 32 blocks, and a clear space for a crafting table beside the build site. In **Creative**, it skips mining and obtains construction blocks via Creative inventory (if the server accepts it). It crafts wooden pickaxes and gathers cobblestone; this can take time or fail if terrain is inaccessible. In Survival, stone blocks (as opposed to cobblestone) still require supplied inventory because ordinary stone drops cobblestone. In Creative, either material can be supplied automatically.
2. In Minecraft, stand near a **flat, open 10×10 patch**. The bot searches within 24 blocks of your position and builds toward positive **X** and positive **Z** from its selected southwest corner. It prefers sites that do not need filling; it can clear grass and level limited one-block dirt bumps/dips (at most 32 edits, with enough dug dirt to fill dips), but will **not** cut down buildings, trees or cross water. Let the bot see your character.
3. In Aria's dashboard card, enter **your Minecraft name** and `Build a 10x10 cobblestone house at my location`. Click **Send task**, then move out of the build footprint.
4. Watch **task state, placed-block progress, log messages and observed X/Y/Z coordinates** on the card (updates about every 3 seconds). Click **View saved memory** to see past tasks and events. The bot verifies server-confirmed placements and inspects the final blueprint.
5. If it fails, read the error in the card. Fix the obstruction or supply blocks and retry. Existing matching blocks count toward a resumed build. **Cancel** stops future steps but does not undo placed blocks. Test in a backed-up world.

With `MC_ALLOWED_PLAYERS` configured, you can instead type `!Aria Build a 10x10 stone house at my location` in Minecraft chat. The bot will still need your position visible. A simple shell is built: **no floor, doors, windows or lighting**.

### Per-player Minecraft game mode

An online bot card shows the **actual server-reported** game mode and offers survival, creative, adventure or spectator. Select a mode and click **Change game mode**. This sends `/gamemode <mode> <bot name>` **as that bot** and waits up to five seconds for Minecraft to confirm the change. The bot must have operator/command permission on the Minecraft server. A dashboard token does **not** grant Minecraft OP permission. In a LAN world, if the bot cannot run commands, change the mode from the world owner's Minecraft chat (for example `/gamemode creative bot`) instead; the dashboard will then display the new mode. Changing game mode is blocked while a build task is running. Creative mode now fills empty inventory slots with the requested build material and skips survival mining/crafting; it does not overwrite existing items. This path has unit tests but has not been verified in a live Minecraft world.

Creative grants resources and flight, **not an implementation of every requested task**. The Miner profile's goal text does not implement diamond mining: only stone/cobblestone house tasks are supported. Unsupported tasks fail without modifying the world.

## 6. Storage, security and troubleshooting

- Profiles: `data/profiles.json`; separate per-player memories: `data/memory/<player>.json`. Back up both. Files are ignored by Git. Changing AI providers **does not remove memory**. Stored goals/personality are metadata today; they do not drive autonomous behavior. The profile model field is informational; `AI_PROVIDERS` selects runtime models.
- The server binds to loopback by default. To access it from another machine, binding `HTTP_HOST=0.0.0.0` requires a strong `API_TOKEN`; enter that token in the dashboard. Use a trusted network and TLS/auth reverse proxy if exposing beyond your machine. Authorized users can modify the Minecraft world.
- **Bot won't join:** check server is running/reachable, port, auth mode and version. Each online-mode player needs its own valid account.
- **No position:** your Minecraft player must be visible to the bot; reconnect or come closer. The dashboard shows `unavailable` while the bot is offline.
- **Not enough blocks / obstruction / cannot place:** give bot sufficient inventory, move near a flat 10×10 open area; the bot searches within 16 blocks and requires solid ground and a clear 5-block-high volume; navigation, anti-cheat and protection plugins may block placement.
- **AI request fails:** the exact example works without Ollama. For other wording start Ollama and pull the configured model, or configure compatible API credentials. Provider errors are recorded in the task result.
- Run `npm test` for unit tests. These do **not** replace testing on a real Minecraft server.

## 7. Next work

This codebase does **not** yet satisfy the full autonomous-player design. The ordered implementation plan, database migration design, provider contract and testable milestones are in [docs/blueprint.md](docs/blueprint.md). Start with live-server reliability, then safe resource gathering/approval, durable task state, and only then autonomous multi-agent coordination.
