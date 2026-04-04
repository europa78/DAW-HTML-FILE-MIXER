/**
 * SessionMix Protocol
 * 
 * Constants and message type definitions for parent↔iframe communication.
 * See docs/SYNC-PROTOCOL.md for full specification.
 */

// ─── Channel Configuration ───
export const NUM_CHANNELS = 4;
export const CHANNEL_COLORS = ['#ff3858', '#ff8c20', '#30e868', '#3898ff'];
export const CHANNEL_NAMES = ['CH 1', 'CH 2', 'CH 3', 'CH 4'];

// ─── PostMessage Types (Parent → Iframe) ───
export const MSG = {
  SET_GAIN:   'SM_GAIN',      // { type, v: number }
  RESUME_CTX: 'SM_RESUME',    // { type }
  TRANSPORT:  'SM_TRANSPORT',  // { type, action, bpm, bar, beat }
};

// ─── PostMessage Types (Iframe → Parent) ───
export const MSG_UP = {
  LEVEL: 'SM_LVL',  // { type, level: number }
};

// ─── Transport Actions ───
export const TRANSPORT_ACTION = {
  PLAY:       'play',
  PAUSE:      'pause',
  STOP:       'stop',
  BPM_CHANGE: 'bpm_change',
};

// ─── Default Channel State Factory ───
export function createChannelState() {
  return {
    loaded: false,
    name: '',
    blob: null,
    iframe: null,
    gain: 0.75,
    pan: 0,
    muted: false,
    soloed: false,
    level: 0,
    decay: 0,
    vfsBlobUrls: null,  // Map of blob URLs for multi-file projects (cleaned up on unload)
  };
}

// ─── App State ───
export const state = {
  channels: Array.from({ length: NUM_CHANNELS }, createChannelState),
  masterGain: 0.8,
  activeTab: -1,
  playing: false,
  bpm: 120,
  bar: 1,
  beat: 1,
  tick: 0,
  transportTimer: null,
};
