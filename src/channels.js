/**
 * SessionMix Channels
 *
 * Manages loading apps into iframe channels — both single HTML files
 * and multi-file projects (via folder upload + VFS).
 *
 * Tab switching uses CSS stacking (never display:none) so all iframes
 * stay alive and AudioContexts are never throttled.
 */

import {
  state, NUM_CHANNELS, CHANNEL_NAMES, MSG, createChannelState,
} from './protocol.js';
import { injectBridge, injectBridgeWithVFS } from './bridge.js';
import { buildVFS, processVFS, revokeVFS } from './vfs.js';
import { sendGain, updateStatus } from './engine.js';
import { renderFader, renderPan } from './mixer.js';

const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════
//  LOAD APP — SINGLE HTML FILE
// ═══════════════════════════════════════════════

export async function loadSingleFile(channelIdx, event) {
  const file = event.target.files[0];
  if (!file) return;

  const rawHtml = await file.text();
  const html = injectBridge(rawHtml);
  const name = file.name.replace(/\.html?$/i, '');

  mountChannel(channelIdx, html, name, file.name, null);
}

// ═══════════════════════════════════════════════
//  LOAD APP — MULTI-FILE PROJECT (FOLDER)
// ═══════════════════════════════════════════════

export async function loadFolder(channelIdx, event) {
  const files = event.target.files;
  if (!files || !files.length) return;

  const vfs = await buildVFS(files);
  if (!vfs) return;

  if (!vfs.entryHtml) {
    console.warn('[SessionMix] No HTML entry point found in folder.');
    alert('No .html entry point found in the selected folder.\nMake sure the folder contains an index.html or another .html file.');
    return;
  }

  const result = processVFS(vfs);
  if (!result) {
    console.warn('[SessionMix] VFS processing failed.');
    return;
  }

  const html = injectBridgeWithVFS(result.html, result.vfsMapping);
  const folderName = vfs.rootDir || 'project';
  const fileCount = vfs.entries.size;

  console.log(
    `[SessionMix] Loaded folder "${folderName}" → ${fileCount} files, entry: ${vfs.entryHtml}`
  );

  mountChannel(channelIdx, html, folderName, `${folderName}/ (${fileCount} files)`, result.blobUrls);
}

// ═══════════════════════════════════════════════
//  MOUNT CHANNEL (shared by single-file & folder)
// ═══════════════════════════════════════════════

function mountChannel(channelIdx, html, name, title, blobUrls) {
  const ch = state.channels[channelIdx];

  // Cleanup previous channel
  if (ch.iframe) ch.iframe.remove();
  if (ch.blob) URL.revokeObjectURL(ch.blob);
  revokeVFS(ch.vfsBlobUrls);

  // Create blob URL and iframe
  const blob = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const iframe = document.createElement('iframe');
  iframe.src = blob;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  iframe.setAttribute('allow', 'autoplay; midi; microphone');
  iframe.className = 'behind';
  iframe.id = `ifr-${channelIdx}`;
  $('frame-stack').appendChild(iframe);

  // Update state
  ch.loaded = true;
  ch.name = name;
  ch.blob = blob;
  ch.iframe = iframe;
  ch.vfsBlobUrls = blobUrls || null;

  // Update load button in mixer strip
  const lb = $(`lb${channelIdx}`);
  if (lb) {
    lb.textContent = name.substring(0, 10);
    lb.classList.add('has-file');
    lb.title = title;
  }

  // When iframe loads, send current gain and resume AudioContext
  iframe.onload = () => {
    sendGain(channelIdx);
    try {
      iframe.contentWindow.postMessage({ type: MSG.RESUME_CTX }, '*');
    } catch (e) {}

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
  revokeVFS(ch.vfsBlobUrls);

  // Reset channel state
  state.channels[channelIdx] = createChannelState();

  // Reset mixer strip UI
  const lb = $(`lb${channelIdx}`);
  if (lb) {
    lb.textContent = 'LOAD APP';
    lb.classList.remove('has-file');
  }
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
      ${ch.loaded ? `<span class="unload" data-x="${i}">\u00d7</span>` : ''}`;

    tab.onclick = (e) => {
      if (e.target.dataset.x !== undefined) {
        unloadApp(parseInt(e.target.dataset.x));
        return;
      }
      if (ch.loaded) {
        switchTo(i);
      } else {
        // Default click opens the folder picker
        $(`fd-${i}`).click();
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

// ═══════════════════════════════════════════════
//  INIT FILE INPUTS
// ═══════════════════════════════════════════════

/** Wire up both file and folder inputs for each channel */
export function initFileInputs() {
  for (let i = 0; i < NUM_CHANNELS; i++) {
    // Single HTML file input
    const fi = $(`fi-${i}`);
    if (fi) fi.onchange = (e) => loadSingleFile(i, e);

    // Folder input
    const fd = $(`fd-${i}`);
    if (fd) fd.onchange = (e) => loadFolder(i, e);
  }
}
