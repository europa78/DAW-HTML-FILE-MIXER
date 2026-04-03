# SESSIONMIX

Multi-app synchronized audio mixer. Load your HTML audio apps (samplers, synthesizers, sequencers, drum machines) into 4 channels, mix them together, and play simultaneously.

![Status](https://img.shields.io/badge/status-active_development-00ffd5)

## What It Does

SessionMix acts as the glue between standalone HTML audio applications. It:

- **Loads HTML files** into sandboxed iframes with full Web Audio API support
- **Injects an audio bridge** that gives the mixer gain control and VU metering over each app's audio output
- **Synchronizes transport** — play/stop/BPM commands are broadcast to all channels simultaneously
- **Mixes** with per-channel faders, pan, solo/mute, and a master bus
- **Keeps all apps alive** — CSS stacking (not `display:none`) ensures AudioContexts are never throttled when switching views

## Architecture

```
session-mixer/
├── index.html              Entry point
├── src/
│   ├── main.js             Init, keyboard shortcuts, render loop
│   ├── protocol.js         Constants, message types, shared state
│   ├── bridge.js           Injected script (AudioContext patching)
│   ├── engine.js            Transport clock, gain routing, meters
│   ├── mixer.js             Mixer strip UI, faders, VU canvases
│   ├── channels.js          Iframe loading, tab switching
│   └── styles.css           All styles
├── docs/
│   └── SYNC-PROTOCOL.md    Transport sync API for app developers
├── vite.config.js           Vite + singlefile plugin
└── package.json
```

## Quick Start

```bash
# Install dependencies
npm install

# Development server (hot reload)
npm run dev

# Build single HTML file for distribution
npm run build
# Output: dist/index.html (self-contained, no dependencies)
```

## Usage

1. Open in Chrome (`npm run dev` or open `dist/index.html`)
2. Click **LOAD .HTML** on any channel strip, or press **1–4** to load apps
3. Press **▶ PLAY** or **Space** to start all apps simultaneously
4. Switch between apps with tabs or **1–4** keys — audio keeps playing on all channels
5. Mix with faders, pan knobs, solo/mute

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Esc` | Stop & Reset |
| `1–4` | Switch channel / Load app |
| `↑ ↓` | BPM ± 1 |

## Making Your Apps Sync-Ready

Apps work automatically — the bridge auto-detects play/stop buttons. For tighter control, add this to your HTML apps:

```javascript
window.addEventListener('sessionmix:transport', (e) => {
  const { action, bpm } = e.detail;
  if (action === 'play') startMySequencer(bpm);
  if (action === 'stop') stopMySequencer();
  if (action === 'bpm_change') updateTempo(bpm);
});
```

See [docs/SYNC-PROTOCOL.md](docs/SYNC-PROTOCOL.md) for the full specification.

## Tech Stack

- Vanilla JavaScript (ES modules)
- Web Audio API (bridge injection, gain routing, analyser metering)
- Vite (dev server + build)
- vite-plugin-singlefile (single HTML distribution)

## Roadmap

- [ ] Per-channel 3-band EQ
- [ ] Equal-power pan law
- [ ] Send/return effects bus (reverb, delay)
- [ ] Arrangement timeline (bar-based clip triggering)
- [ ] Sample-accurate sync via SharedArrayBuffer
- [ ] WAV export / offline render
- [ ] MIDI clock sync
- [ ] Saveable session files (JSON state + base64 HTML)

## License

MIT
