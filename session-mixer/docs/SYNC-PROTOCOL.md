# SessionMix Sync Protocol

## Overview

When SessionMix loads an HTML app, it automatically injects a **bridge script** that patches the `AudioContext` for gain control and metering. Transport commands (play/stop/BPM) are broadcast to all channels simultaneously.

Apps work **out of the box** without modification — the bridge auto-detects play/stop buttons and clicks them. For tighter integration, apps can implement the sync protocol below.

## How It Works

```
┌──────────────────────────────────────┐
│           SESSIONMIX (parent)        │
│  ┌─────────┐  ┌─────────┐           │
│  │Transport │  │  Mixer  │           │
│  │  Clock   │  │ Faders  │           │
│  └────┬─────┘  └────┬────┘           │
│       │              │               │
│  postMessage    postMessage          │
│       │              │               │
│  ┌────▼──────────────▼────┐          │
│  │    iframe (app.html)   │ ×4       │
│  │  ┌──────────────────┐  │          │
│  │  │  Bridge Script   │  │          │
│  │  │  (auto-injected) │  │          │
│  │  │                  │  │          │
│  │  │  AudioContext    │  │          │
│  │  │  └→ GainNode ────│──│─→ level data (postMessage up)
│  │  │     └→ Analyser  │  │          │
│  │  │        └→ dest   │  │          │
│  │  └──────────────────┘  │          │
│  └────────────────────────┘          │
└──────────────────────────────────────┘
```

## Automatic Behavior (No Code Required)

The bridge script automatically:

1. **Patches `AudioContext`** — Inserts a `GainNode → AnalyserNode` before `destination`. Any node your app connects to `ctx.destination` gets redirected through this chain.

2. **Controls volume** — The parent mixer adjusts the injected `GainNode.gain.value` via `postMessage`.

3. **Reports levels** — Sends RMS meter data back to the parent at ~22fps.

4. **Auto-triggers play/stop** — Scans the DOM for buttons with text/class/id containing "play", "start", "▶", "stop", "■", "pause", etc. Falls back to simulating a spacebar keypress.

## Optional: Transport Event Listener

For precise sync control, add this to your app:

```javascript
window.addEventListener('sessionmix:transport', (e) => {
  const { action, bpm, bar, beat } = e.detail;

  switch (action) {
    case 'play':
      // Start your sequencer/playback
      // Use bpm for tempo sync
      startPlayback(bpm);
      break;

    case 'pause':
      // Pause without resetting position
      pausePlayback();
      break;

    case 'stop':
      // Stop and reset to beginning
      stopPlayback();
      break;

    case 'bpm_change':
      // BPM was adjusted while playing
      updateTempo(bpm);
      break;
  }
});
```

## Message Types Reference

### Parent → Iframe

| Type | Payload | Description |
|------|---------|-------------|
| `SM_GAIN` | `{ v: number }` | Set channel gain (0.0 – 1.0) |
| `SM_RESUME` | `{}` | Resume suspended AudioContexts |
| `SM_TRANSPORT` | `{ action, bpm, bar, beat }` | Transport command |

### Iframe → Parent

| Type | Payload | Description |
|------|---------|-------------|
| `SM_LVL` | `{ level: number }` | RMS meter level (0.0 – 1.0) |

### Transport Actions

| Action | When |
|--------|------|
| `play` | User presses Play |
| `pause` | User presses Pause |
| `stop` | User presses Stop (resets position) |
| `bpm_change` | BPM adjusted via ±/arrow keys |

## Future: Sample-Accurate Sync

For truly sample-accurate synchronization, apps can share an `AudioContext.currentTime` reference:

```javascript
window.addEventListener('sessionmix:transport', (e) => {
  if (e.detail.action === 'play' && e.detail.startTime) {
    // Schedule playback to start at the exact same audio time
    const ctx = myAudioContext;
    const offset = e.detail.startTime - ctx.currentTime;
    scheduleStart(ctx.currentTime + Math.max(0, offset));
  }
});
```

This requires the parent and iframe to share the same `AudioContext` clock, which is planned for a future version using `SharedArrayBuffer` or `MessageChannel` audio routing.
