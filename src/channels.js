/**
 * SessionMix Channels
 * 
 * Manages loading HTML apps into iframe channels, tab switching,
 * and the critical CSS-stacking architecture that keeps all iframes
 * alive simultaneously (never display:none, only pointer-events/visibility).
 */

import {
  state, NUM_CHANNELS, CHANNEL_NAMES, MSG, createChannelState,
} from './protocol.js';
import { injectBridge } from './bridge.js';
import { sendGain, updateStatus } from './engine.js';
import { renderFader, renderPan } from './mixer.js';

const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════
//  LOAD HTML APP INTO CHANNEL
// ═══════════════════════════════════════════════

export async function loadApp(channelIdx, event) {
  const file = event.target.files[0];
  if (!file) return;

  const rawHtml = await file.text();
  const modifiedHtml = injectBridge(rawHtml);

  const ch = state.channels[channelIdx];

  // Cleanup previous
  if (ch.blob) URL.revokeObjectURL(ch.blob);
  if (ch.iframe) ch.iframe.remove();

  // Create blob URL and iframe
  const blob = URL.createObjectURL(new Blob([modifiedHtml], { type: 'text/html' }));
  const iframe = document.createElement('iframe');
  iframe.src = blob;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  iframe.setAttribute('allow', 'autoplay; midi; microphone');
  iframe.className = 'behind'; // starts behind, switchTo will bring it front
  iframe.id = `ifr-${channelIdx}`;
  $('frame-stack').appendChild(iframe);

  // Update state
  ch.loaded = true;
  ch.name = file.name.replace(/\.html?$/i, '');
  ch.blob = blob;
  ch.iframe = iframe;

  // Update load button in mixer strip
  const lb = $(`lb${channelIdx}`);
  lb.textContent = ch.name.substring(0, 10);
  lb.classList.add('has-file');
  lb.title = file.name;

  // When iframe loads, send current gain and resume AudioContext
  iframe.onload = () => {
    sendGain(channelIdx);
    try {
      iframe.contentWindow.postMessage({ type: MSG.RESUME_CTX }, '*');
    } catch (e) {}

    // If transport is already playing, tell the new app to play
    if (state.playing) {
      try {
        iframe.contentWindow.postMessage({
          type: MSG.TRANSPORT,
          action: 'play',
          bpm: state.bpm,
          bar: state.bar,
          beat: state.beat,
        }, '*');
      } catch (e) {}
    }
  };

  buildTabs();
  switchTo(channelIdx);
  $('empty-prompt').style.display = 'none';
  updateStatus();
}

// ═══════════════════════════════════════════════
//  UNLOAD APP
// ═══════════════════════════════════════════════

export function unloadApp(channelIdx) {
  const ch = state.channels[channelIdx];

  if (ch.iframe) ch.iframe.remove();
  if (ch.blob) URL.revokeObjectURL(ch.blob);

  // Reset channel state
  state.channels[channelIdx] = createChannelState();

  // Reset mixer strip UI
  const lb = $(`lb${channelIdx}`);
  lb.textContent = 'LOAD .HTML';
  lb.classList.remove('has-file');
  $(`so${channelIdx}`).className = 'sm';
  $(`mu${channelIdx}`).className = 'sm';
  renderFader(channelIdx);
  renderPan(channelIdx);

  // Switch to next loaded channel or show empty state
  const nextLoaded = state.channels.findIndex((c) => c.loaded);
  if (nextLoaded >= 0) {
    switchTo(nextLoaded);
  } else {
    state.activeTab = -1;
    $('empty-prompt').style.display = 'flex';
  }

  buildTabs();
  updateStatus();
}

// ═══════════════════════════════════════════════
//  TAB BAR
// ═══════════════════════════════════════════════

export function buildTabs() {
  const el = $('ch-tabs');
  el.innerHTML = '';

  for (let i = 0; i < NUM_CHANNELS; i++) {
    const ch = state.channels[i];
    const tab = document.createElement('div');

    tab.className = 'ch-tab'
      + (ch.loaded ? ' loaded' : '')
      + (state.activeTab === i ? ' active' : '');
    tab.setAttribute('data-c', i);

    const label = ch.loaded ? `${CHANNEL_NAMES[i]}: ${ch.name}` : CHANNEL_NAMES[i];
    tab.innerHTML = `
      <div class="ind"></div>
      <span class="ch-name">${label}</span>
      <span class="hotkey">${i + 1}</span>
      ${ch.loaded ? `<span class="unload" data-x="${i}">×</span>` : ''}`;

    tab.onclick = (e) => {
      if (e.target.dataset.x !== undefined) {
        unloadApp(parseInt(e.target.dataset.x));
        return;
      }
      if (ch.loaded) {
        switchTo(i);
      } else {
        $(`fi-${i}`).click();
      }
    };

    el.appendChild(tab);
  }
}

// ═══════════════════════════════════════════════
//  CHANNEL SWITCHING
// ═══════════════════════════════════════════════

/**
 * Switch the visible channel.
 * 
 * CRITICAL ARCHITECTURE: All iframes stay alive at all times.
 * We only toggle CSS classes:
 *   .front  → pointer-events: auto;  visibility: visible; z-index: 10
 *   .behind → pointer-events: none;  visibility: hidden;
 * 
 * Audio continues playing in all background iframes.
 * This is the key difference from display:none which would
 * throttle or suspend AudioContexts.
 */
export function switchTo(channelIdx) {
  state.activeTab = channelIdx;

  for (let j = 0; j < NUM_CHANNELS; j++) {
    const iframe = state.channels[j].iframe;
    if (!iframe) continue;
    iframe.className = (j === channelIdx) ? 'front' : 'behind';
  }

  buildTabs();
}

/** Initialize file input listeners */
export function initFileInputs() {
  for (let i = 0; i < NUM_CHANNELS; i++) {
    $(`fi-${i}`).onchange = (e) => loadApp(i, e);
  }
}
