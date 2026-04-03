/**
 * SessionMix Engine
 * 
 * Manages transport clock (play/pause/stop/BPM), gain routing to iframes,
 * and meter level ingestion from iframes via postMessage.
 */

import { state, NUM_CHANNELS, MSG, TRANSPORT_ACTION } from './protocol.js';

const $ = (id) => document.getElementById(id);

// ─── Gain Routing ───

/**
 * Calculate and send the effective gain value to a channel's iframe.
 * Takes into account mute, solo, channel gain, and master gain.
 */
export function sendGain(ch) {
  const c = state.channels[ch];
  if (!c.iframe) return;

  const anySoloed = state.channels.some((c) => c.soloed);
  const isDimmed = c.muted || (anySoloed && !c.soloed);
  const effectiveGain = isDimmed ? 0 : c.gain * state.masterGain;

  try {
    c.iframe.contentWindow.postMessage({ type: MSG.SET_GAIN, v: effectiveGain }, '*');
  } catch (e) {
    // iframe may not be ready yet
  }
}

/** Recalculate and send gain for all channels */
export function sendAllGains() {
  for (let i = 0; i < NUM_CHANNELS; i++) sendGain(i);
}

// ─── Transport ───

function broadcastTransport(action) {
  for (let i = 0; i < NUM_CHANNELS; i++) {
    const c = state.channels[i];
    if (!c.iframe) continue;
    try {
      c.iframe.contentWindow.postMessage({
        type: MSG.TRANSPORT,
        action,
        bpm: state.bpm,
        bar: state.bar,
        beat: state.beat,
      }, '*');
    } catch (e) {}
  }
}

export function play() {
  state.playing = true;
  $('btn-play').textContent = '❚❚';
  $('btn-play').classList.add('playing');
  broadcastTransport(TRANSPORT_ACTION.PLAY);
  updateStatus();
  startClock();
}

export function pause() {
  state.playing = false;
  clearTimeout(state.transportTimer);
  $('btn-play').textContent = '▶';
  $('btn-play').classList.remove('playing');
  broadcastTransport(TRANSPORT_ACTION.PAUSE);
  updateStatus();
}

export function stop() {
  state.playing = false;
  clearTimeout(state.transportTimer);
  state.bar = 1;
  state.beat = 1;
  state.tick = 0;
  $('p-bar').textContent = '01';
  $('p-beat').textContent = '1';
  $('btn-play').textContent = '▶';
  $('btn-play').classList.remove('playing');
  broadcastTransport(TRANSPORT_ACTION.STOP);
  updateStatus();
}

export function togglePlayPause() {
  state.playing ? pause() : play();
}

function startClock() {
  if (state.transportTimer) clearTimeout(state.transportTimer);
  const stepMs = () => 60000 / state.bpm / 4; // 16th note resolution

  function advance() {
    if (!state.playing) return;
    state.tick++;
    if (state.tick > 4) {
      state.tick = 1;
      state.beat++;
      if (state.beat > 4) {
        state.beat = 1;
        state.bar++;
      }
    }
    $('p-bar').textContent = String(state.bar).padStart(2, '0');
    $('p-beat').textContent = state.beat;
    state.transportTimer = setTimeout(advance, stepMs());
  }

  state.transportTimer = setTimeout(advance, stepMs());
}

// ─── BPM ───

export function incrementBPM(delta) {
  state.bpm = Math.max(30, Math.min(300, state.bpm + delta));
  $('bpm-val').textContent = state.bpm;
  broadcastTransport(TRANSPORT_ACTION.BPM_CHANGE);
}

// ─── Meter Ingestion ───

export function initMeterListener() {
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'SM_LVL') return;
    for (let i = 0; i < NUM_CHANNELS; i++) {
      if (state.channels[i].iframe && e.source === state.channels[i].iframe.contentWindow) {
        state.channels[i].level = e.data.level;
        break;
      }
    }
  });
}

// ─── Status Display ───

export function updateStatus() {
  const loaded = state.channels.filter((c) => c.loaded).length;
  const label = state.playing ? '▶ PLAYING' : '■ STOPPED';
  $('status').textContent = `${label} — ${loaded}/${NUM_CHANNELS} APPS — ${state.bpm} BPM`;
}
