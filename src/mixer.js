/**
 * SessionMix Mixer
 * 
 * Builds and manages the mixer strip UI at the bottom of the app.
 * Handles fader interactions, pan knobs, VU meter rendering,
 * solo/mute toggling, and dimming logic.
 */

import {
  state, NUM_CHANNELS, CHANNEL_COLORS, CHANNEL_NAMES,
} from './protocol.js';
import { sendGain, sendAllGains } from './engine.js';

const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════
//  BUILD MIXER DOM
// ═══════════════════════════════════════════════

export function buildMixer() {
  const mx = $('mixer');
  mx.innerHTML = '';

  // Channel strips
  for (let i = 0; i < NUM_CHANNELS; i++) {
    const s = document.createElement('div');
    s.className = 'strip';
    s.id = `s${i}`;
    s.innerHTML = `
      <div class="strip-label" style="color:${CHANNEL_COLORS[i]}">${CHANNEL_NAMES[i]}</div>
      <div class="load-row">
        <div class="load-btn" id="lb${i}" title="Load project folder">LOAD APP</div>
        <div class="load-file-btn" id="lf${i}" title="Load single .html file">FILE</div>
      </div>
      <div class="pan-row">
        <div class="pan-knob" id="pk${i}">
          <div class="pan-dot" id="pd${i}" style="background:${CHANNEL_COLORS[i]}"></div>
        </div>
        <div class="pan-lbl" id="pl${i}">C</div>
      </div>
      <div class="sm-row">
        <div class="sm" id="so${i}">S</div>
        <div class="sm" id="mu${i}">M</div>
      </div>
      <div class="fader-col">
        <canvas class="vu" id="v1${i}" width="5" height="106"></canvas>
        <div class="fader" id="fd${i}">
          <div class="f-groove"></div>
          <div class="f-fill" id="ff${i}" style="background:${CHANNEL_COLORS[i]}"></div>
          <div class="f-knob" id="fk${i}">
            <div class="f-line" style="background:${CHANNEL_COLORS[i]}"></div>
          </div>
        </div>
        <canvas class="vu" id="v2${i}" width="5" height="106"></canvas>
      </div>
      <div class="db-val" id="dv${i}">${Math.round(state.channels[i].gain * 100)}</div>`;
    mx.appendChild(s);

    // Events
    $(`lb${i}`).onclick = () => $(`fd-${i}`).click();  // folder picker
    $(`lf${i}`).onclick = () => $(`fi-${i}`).click();  // single file picker
    $(`so${i}`).onclick = () => toggleSolo(i);
    $(`mu${i}`).onclick = () => toggleMute(i);
    initFader(i);
    initPan(i);
  }

  // Master strip
  const m = document.createElement('div');
  m.className = 'strip master-strip';
  m.innerHTML = `
    <div class="strip-label" style="color:var(--accent)">MASTER</div>
    <div style="height:20px"></div>
    <div style="height:24px"></div>
    <div style="height:18px"></div>
    <div class="fader-col">
      <canvas class="vu" id="vm1" width="5" height="106"></canvas>
      <div class="fader" id="fdm">
        <div class="f-groove"></div>
        <div class="f-fill" id="ffm" style="background:var(--accent)"></div>
        <div class="f-knob" id="fkm">
          <div class="f-line" style="background:var(--accent)"></div>
        </div>
      </div>
      <canvas class="vu" id="vm2" width="5" height="106"></canvas>
    </div>
    <div class="db-val" id="dvm">${Math.round(state.masterGain * 100)}</div>`;
  mx.appendChild(m);
  initMasterFader();
}

// ═══════════════════════════════════════════════
//  FADER INTERACTIONS
// ═══════════════════════════════════════════════

function initFader(i) {
  setTimeout(() => {
    const track = $(`fd${i}`);
    if (!track) return;
    let active = false;

    const update = (e) => {
      const rect = track.getBoundingClientRect();
      const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
      state.channels[i].gain = Math.max(0, Math.min(1, 1 - y / rect.height));
      renderFader(i);
      sendGain(i);
    };

    track.onpointerdown = (e) => { active = true; track.setPointerCapture(e.pointerId); update(e); };
    track.onpointermove = (e) => { if (active) update(e); };
    track.onpointerup = () => { active = false; };
  }, 60);
}

function initMasterFader() {
  setTimeout(() => {
    const track = $('fdm');
    if (!track) return;
    let active = false;

    const update = (e) => {
      const rect = track.getBoundingClientRect();
      const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
      state.masterGain = Math.max(0, Math.min(1, 1 - y / rect.height));
      renderMasterFader();
      sendAllGains();
    };

    track.onpointerdown = (e) => { active = true; track.setPointerCapture(e.pointerId); update(e); };
    track.onpointermove = (e) => { if (active) update(e); };
    track.onpointerup = () => { active = false; };
  }, 60);
}

function initPan(i) {
  setTimeout(() => {
    const knob = $(`pk${i}`);
    if (!knob) return;
    let active = false, startY = 0, startVal = 0;

    knob.onpointerdown = (e) => {
      active = true; startY = e.clientY; startVal = state.channels[i].pan;
      knob.setPointerCapture(e.pointerId);
    };
    knob.onpointermove = (e) => {
      if (!active) return;
      state.channels[i].pan = Math.max(-1, Math.min(1, startVal + (startY - e.clientY) * 0.012));
      renderPan(i);
    };
    knob.onpointerup = () => { active = false; };
    knob.ondblclick = () => { state.channels[i].pan = 0; renderPan(i); };
  }, 60);
}

// ═══════════════════════════════════════════════
//  RENDER HELPERS
// ═══════════════════════════════════════════════

export function renderFader(i) {
  const v = state.channels[i].gain;
  const ff = $(`ff${i}`), fk = $(`fk${i}`), dv = $(`dv${i}`);
  if (ff) ff.style.height = (v * 92) + 'px';
  if (fk) fk.style.top = ((1 - v) * 100) + '%';
  if (dv) dv.textContent = Math.round(v * 100);
}

export function renderMasterFader() {
  const v = state.masterGain;
  const ff = $('ffm'), fk = $('fkm'), dv = $('dvm');
  if (ff) ff.style.height = (v * 92) + 'px';
  if (fk) fk.style.top = ((1 - v) * 100) + '%';
  if (dv) dv.textContent = Math.round(v * 100);
}

export function renderPan(i) {
  const v = state.channels[i].pan;
  const pd = $(`pd${i}`), pl = $(`pl${i}`);
  if (pd) pd.style.transform = `translate(-50%, 0) rotate(${v * 135}deg)`;
  if (pl) {
    pl.textContent = v === 0 ? 'C'
      : v < 0 ? 'L' + Math.abs(Math.round(v * 50))
      : 'R' + Math.round(v * 50);
  }
}

export function renderAllFaders() {
  for (let i = 0; i < NUM_CHANNELS; i++) {
    renderFader(i);
    renderPan(i);
  }
  renderMasterFader();
}

// ═══════════════════════════════════════════════
//  VU METERS
// ═══════════════════════════════════════════════

function drawVU(id, level, color) {
  const canvas = $(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = 5, h = 106;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const db = Math.min(1, level * 4.5);
  const segs = Math.floor(h / 3.5);
  const filled = Math.floor(db * segs);

  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < segs; i++) {
    const y = h - (i + 1) * 3.5;
    const ratio = i / segs;
    let col = color;
    if (ratio > 0.85) col = '#ff2040';
    else if (ratio > 0.7) col = '#ffaa00';
    ctx.globalAlpha = i < filled ? 1 : 0.06;
    ctx.fillStyle = col;
    ctx.fillRect(0, y, w, 2);
  }
  ctx.globalAlpha = 1;
}

/** Render loop — call from requestAnimationFrame */
export function renderMeters() {
  const anySoloed = state.channels.some((c) => c.soloed);

  for (let i = 0; i < NUM_CHANNELS; i++) {
    const c = state.channels[i];
    c.decay = Math.max(c.level, c.decay * 0.88);
    const dimmed = c.muted || (anySoloed && !c.soloed);
    const lv = dimmed ? 0 : c.decay * c.gain * state.masterGain;
    drawVU(`v1${i}`, lv, CHANNEL_COLORS[i]);
    drawVU(`v2${i}`, lv * 0.82, CHANNEL_COLORS[i]);
  }

  // Master meters (summed)
  let sum = 0;
  for (let i = 0; i < NUM_CHANNELS; i++) {
    const c = state.channels[i];
    const dimmed = c.muted || (anySoloed && !c.soloed);
    if (!dimmed) sum += c.decay * c.gain;
  }
  sum = Math.min(1, sum * state.masterGain);
  drawVU('vm1', sum, '#00ffd5');
  drawVU('vm2', sum * 0.88, '#00ffd5');
}

// ═══════════════════════════════════════════════
//  SOLO / MUTE
// ═══════════════════════════════════════════════

function toggleSolo(i) {
  state.channels[i].soloed = !state.channels[i].soloed;
  $(`so${i}`).className = 'sm' + (state.channels[i].soloed ? ' s-on' : '');
  updateDimming();
  sendAllGains();
}

function toggleMute(i) {
  state.channels[i].muted = !state.channels[i].muted;
  $(`mu${i}`).className = 'sm' + (state.channels[i].muted ? ' m-on' : '');
  updateDimming();
  sendGain(i);
}

function updateDimming() {
  const anySoloed = state.channels.some((c) => c.soloed);
  for (let i = 0; i < NUM_CHANNELS; i++) {
    const dimmed = state.channels[i].muted || (anySoloed && !state.channels[i].soloed);
    $(`s${i}`).className = 'strip' + (dimmed ? ' dimmed' : '');
  }
}
