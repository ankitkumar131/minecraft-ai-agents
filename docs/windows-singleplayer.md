# Windows + an existing single-player world (for example, `AI`)

## Fix `Missing credential for provider ...`

The application has not connected to Minecraft yet: it fails during AI-provider configuration. `keyEnv` is **not the key**. It must be the *name of a variable* that contains the key elsewhere in `.env`. If the value you pasted into `keyEnv` was a real key, **revoke/rotate it in the provider's dashboard immediately**, because it was shared in a message. Do not paste the replacement into chat, Git or a screenshot.

For a cloud provider, use this pattern (substitute your real provider URL and model only after checking its API documentation):

```dotenv
CLOUD_AI_KEY=put_your_new_secret_here
AI_PROVIDERS=[{"name":"cloud","type":"openai-compatible","url":"https://provider.example/v1/","model":"model-id","keyEnv":"CLOUD_AI_KEY"},{"name":"local","type":"ollama","url":"http://127.0.0.1:11434","model":"qwen2.5:7b"}]
```

`AI_PROVIDERS` must be **one line**. Do not use a space or key value in `keyEnv`. Startup validates that the named variable exists. The fallback is used for *inference failures*, not for a missing key at startup. The application does not confirm that a given provider URL/model supports its OpenAI-compatible JSON endpoint; if it doesn't, it tries the next configured provider.

To start without a cloud key, **remove or comment out the entire `AI_PROVIDERS` line**. The default is local Ollama. For the exact task `Build a 10x10 stone house at my location`, the parser skips AI entirely, so Ollama does not need to run for that task.

## Let a bot join a world already open in your launcher

A launcher runs a Minecraft **client**; `MC_HOST=localhost` and `MC_PORT=25565` target a **server**, not the launcher window. The world name `AI` is not a connection address. In Java Edition, load the `AI` world, press **Esc → Open to LAN → Start LAN World**, and note the *port shown in Minecraft chat*. Set `MC_PORT` to that port (it may change each time you reopen to LAN). Use `MC_HOST=127.0.0.1` if the app and Minecraft run on the same Windows PC. If the app runs on another computer, use the Minecraft PC's LAN IP instead of localhost and allow the LAN port through the firewall.

For a private offline-mode LAN world, `MC_AUTH=offline` uses the profile name as the joining bot's username. **Do not expose offline-mode worlds publicly.** Create the player (e.g. `BuilderBot`) in the dashboard at `http://127.0.0.1:3000/`, then click **Start**; `MC_USERNAME` from older examples is *not used* by the current multi-player application. Each bot needs a unique profile name. Online-mode servers require authorized accounts; a third-party launcher does not provide the bot with Minecraft authentication.

Minecraft version and server protocol must also be compatible with Mineflayer. A newest snapshot or modded release (including a Fabric-loader entry) may not yet be supported. If the bot is kicked with an unsupported protocol/version error, try an officially supported Java server version and set `MC_VERSION` accordingly. Fabric is not required by this project. A dedicated Java server with a fixed port is more predictable for long-running agents than Open to LAN.

**Remember:** the bot must already carry enough blocks for the builder task, be able to see your character, and have movement/place permissions. Watch the application terminal and agent card for connection/build errors. See the [main README](../README.md) for the build walkthrough and safety precautions.

### `No data available for version 26.3`

The game/server is **26.3**, but the installed Mineflayer/Minecraft protocol data does not contain that version. The bot cannot join it, even if the dashboard and AI provider are working. As checked with this repository's current installed dependencies, versions include `1.20.4`, `1.21.4`, `1.21.11` and `26.1`, but **not `26.3`**. Support can change after dependency updates; inspect your install with:

```sh
node -e "console.log(require('minecraft-data').supportedVersions.pc.slice(-25))"
```

Create a **new test world** in a version shown in that list (for example vanilla Java `1.21.4`) and open *that* world to LAN. Set `MC_PORT` to the new displayed LAN port and optionally `MC_VERSION=1.21.4`. **Do not open the existing 26.3 world with an older Minecraft version**: downgrading a world can corrupt or lose blocks/data. Back it up first; keep it for when Mineflayer adds 26.3 support. Setting `MC_VERSION=1.21.4` while the actual world/server is still 26.3 does **not** make the protocols compatible.

### `connect ECONNREFUSED 127.0.0.1:2556`

This means the bot reached the Windows TCP stack, but nothing is listening on **that port**. It is not an AI-provider or profile-form error. Keep the game running inside the world; open it to LAN and read the exact port shown in the Minecraft chat after **Start LAN World**. The port may change every time the LAN session starts. Put that value in `MC_PORT`, save `.env`, restart Node, then click **Stop** (if shown) and **Start** on the bot card. `127.0.0.1` works only when Minecraft and Node run on the same PC. If they run on different computers, use the game PC's LAN IPv4 address in `MC_HOST` and allow the LAN port through Windows Firewall.

On the **same Windows PC** with the world open to LAN, check the port in a PowerShell window:

```powershell
Test-NetConnection 127.0.0.1 -Port 2556
```

Replace `2556` with the currently displayed port. `TcpTestSucceeded : False` means the game isn't listening there: first check whether the LAN world is still open and whether the port changed. If it says `True` but the bot still cannot connect, verify that Node is running on the same machine and examine the app terminal and firewall rules. `netstat -ano | findstr :2556` in Command Prompt can also show whether a process is listening on that port. Do not test from a cloud/sandbox preview with `localhost`; it is a different computer.

Note that a profile goal such as “house with bed, chest and crafting table” is **not implemented** by the current builder; those fields describe a future agent goal and cannot add furniture to the existing simple stone-shell build.
