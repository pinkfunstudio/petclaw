# PetClaw

**A browser pet that learns your style and generates OpenClaw config files.**

You think you're raising a pet. You're actually training your AI agent.

PetClaw is a Chrome Extension that puts a pixel-art lobster on every webpage. Feed it, chat with it, drag it around — while it silently learns your habits, preferences, and communication style. Over time it exports ready-to-use [OpenClaw](https://github.com/openclaw) configuration files (SOUL.md, MEMORY.md, USER.md, IDENTITY.md) so your AI agent already knows you.

## Features

**Pet Lifecycle** — 5 growth stages from egg to adult, each with unique sprites and evolving personality vectors (introvert↔extrovert, serious↔playful, cautious↔bold, formal↔casual).

**Pixel-Art Physics** — Canvas-rendered 64×64 sprites at 8 fps. Gravity, bouncing, drag-and-throw with velocity tracking. The lobster walks, runs, sleeps, eats, climbs, flies (teen/adult), and reacts to your mouse.

**Mouse Reactions** — Hover to make the pet look at you. Move fast to startle or attract it (depends on personality). Leave the mouse idle and it comes over to nuzzle your cursor. Right-click for a context menu (settings, export, hide).

**LLM Chat** — Real-time streaming conversations via Claude, MiniMax, DeepSeek, or any OpenAI-compatible endpoint. The pet's personality adapts as it grows. Shadow DOM isolation keeps the UI clean.

**Passive Learning** — Tracks your active hours, topic interests (10 categories), browsing domains (opt-in), feedback style, and response length patterns — all stored locally, never sent anywhere.

**OpenClaw Export** — Automatically generates 4 config files after each interaction, exported as a single ZIP:
- `SOUL.md` — Core personality, boundaries, vibe, and closing
- `MEMORY.md` — Shared experiences and learned preferences
- `USER.md` — Activity patterns and topic distribution
- `IDENTITY.md` — Pet identity card (OpenClaw 5-field format)

**Cross-Tab Sync** — Only one pet runs at a time across all tabs. State, chat history, and position stay in sync.

## Install

```bash
git clone https://github.com/pinkfunstudio/petclaw.git
cd petclaw
npm install
npm run build
```

Then load as an unpacked extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder

## Configure

Click the PetClaw extension icon to open the popup. In the **Settings** tab:

- Choose an LLM provider (MiniMax, Claude, OpenAI, DeepSeek, Gemini, Groq, OpenRouter, Ollama, or any OpenAI-compatible endpoint)
- Enter your API key and model
- Name your pet (default: Clawfish)
- Toggle browsing tracker and pet visibility

## Tech Stack

| Layer | Tech |
|-------|------|
| Language | TypeScript 5.7 (strict) |
| Bundler | esbuild |
| Extension | Chrome Manifest V3 |
| Rendering | Canvas pixel-art sprites |
| DOM Isolation | Shadow DOM |
| Storage | chrome.storage.local |
| LLM | Claude / OpenAI-compatible / MiniMax / DeepSeek (streaming) |

## Project Structure

```
petclaw/
├── src/
│   ├── background/       # Service Worker: state, LLM, decay, profiler, tracker
│   ├── content/          # Content Script: pet, chat, sprites, physics
│   ├── popup/            # Extension popup: status, settings, export
│   └── shared/           # Types, constants, storage, zip
├── design/               # Game design doc & review reports
├── scripts/              # Build script (esbuild + icon gen)
├── dist/                 # Build output (load this in Chrome)
└── manifest.json
```

## Development

```bash
npm run watch    # rebuild on file changes
npm run clean    # remove dist/
```

## Links

- [@PinkFunStudio on X](https://x.com/PinkFunStudio)

## License

MIT — PinkFun Studio 2026
