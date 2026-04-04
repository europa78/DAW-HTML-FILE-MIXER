/**
 * SessionMix — Main Entry Point
 * 
 * Initializes all subsystems, wires up keyboard shortcuts,
 * and starts the render loop.
 */

import { state, NUM_CHANNELS } from './protocol.js';
import { play, pause, stop, togglePlayPause, incrementBPM, initMeterListener } from './engine.js';
import { buildMixer, renderAllFaders, renderMeters } from './mixer.js';
import { buildTabs, switchTo, initFileInputs } from './channels.js';

const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════
//  TRANSPORT CONTROLS
// ═══════════════════════════════════════════════

$('btn-play').onclick = togglePlayPause;
$('btn-stop').onclick = stop;
$('bpm-dn').onclick = () => incrementBPM(-1);
$('bpm-up').onclick = () => incrementBPM(1);

// ═══════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════

document.addEventListener('keydown', (e) => {
  // Don't capture when typing in an input
  if (e.target.tagName === 'INPUT') return;

  switch (e.code) {
    case 'Space':
      if (e.repeat) return;
      e.preventDefault();
      togglePlayPause();
      break;

    case 'Escape':
      e.preventDefault();
      stop();
      break;

    case 'ArrowUp':
      if (e.repeat) return;
      e.preventDefault();
      incrementBPM(1);
      break;

    case 'ArrowDown':
      if (e.repeat) return;
      e.preventDefault();
      incrementBPM(-1);
      break;
  }

  // 1–4: Switch channels or open file picker
  const num = parseInt(e.key);
  if (num >= 1 && num <= 4) {
    const idx = num - 1;
    if (state.channels[idx].loaded) {
      switchTo(idx);
    } else {
      $(`fd-${idx}`).click();  // open folder picker
    }
  }
});

// ═══════════════════════════════════════════════
//  RENDER LOOP
// ═══════════════════════════════════════════════

function frame() {
  renderMeters();
  requestAnimationFrame(frame);
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════

buildMixer();
buildTabs();
initFileInputs();
renderAllFaders();
initMeterListener();
requestAnimationFrame(frame);
