/**
 * SessionMix Bridge
 *
 * This script is injected into every HTML app loaded into a channel.
 * It runs BEFORE any of the app's own scripts and:
 *
 * 1. Patches AudioContext — redirects destination connections through a
 *    GainNode → AnalyserNode chain so the parent mixer can control volume
 *    and read RMS levels.
 *
 * 2. Listens for postMessage commands from parent (gain, transport, resume).
 *
 * 3. Auto-detects play/stop buttons and triggers them on transport commands.
 *
 * 4. Fires 'sessionmix:transport' CustomEvents for apps that implement
 *    the sync protocol.
 *
 * 5. (VFS mode) Patches fetch() and XMLHttpRequest to resolve relative
 *    paths from the Virtual File System blob URL mapping.
 *
 * The bridge is exported as a string so it can be injected via string
 * concatenation into the raw HTML before creating the blob URL.
 */

export const BRIDGE_SCRIPT = `<` + `script>
(function() {
  var _AC = window.AudioContext || window.webkitAudioContext;
  if (!_AC) return;

  var _bridge = {
    ctxs: [],
    gains: [],
    analysers: [],
    meterId: null
  };

  // ── Patched AudioContext Constructor ──
  function PatchedAudioContext() {
    var ctx = new _AC();
    var gainNode = ctx.createGain();
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    // Chain: app nodes → gainNode → analyser → real destination
    gainNode.connect(analyser);
    analyser.connect(ctx.destination);

    // Intercept any connection to ctx.destination and redirect to our gainNode
    var realDest = ctx.destination;
    var origConnect = AudioNode.prototype.connect;

    AudioNode.prototype.connect = function(target) {
      if (target === realDest) {
        return origConnect.call(this, gainNode);
      }
      return origConnect.apply(this, arguments);
    };

    _bridge.ctxs.push(ctx);
    _bridge.gains.push(gainNode);
    _bridge.analysers.push(analyser);

    // Start sending RMS meter levels to parent at ~22fps
    if (!_bridge.meterId) {
      _bridge.meterId = setInterval(function() {
        var maxRms = 0;
        for (var i = 0; i < _bridge.analysers.length; i++) {
          var data = new Uint8Array(_bridge.analysers[i].frequencyBinCount);
          _bridge.analysers[i].getByteTimeDomainData(data);
          var sum = 0;
          for (var j = 0; j < data.length; j++) {
            var v = (data[j] - 128) / 128;
            sum += v * v;
          }
          var rms = Math.sqrt(sum / data.length);
          if (rms > maxRms) maxRms = rms;
        }
        try {
          window.parent.postMessage({ type: 'SM_LVL', level: maxRms }, '*');
        } catch(e) {}
      }, 45);
    }

    return ctx;
  }

  PatchedAudioContext.prototype = _AC.prototype;
  window.AudioContext = PatchedAudioContext;
  if (window.webkitAudioContext) window.webkitAudioContext = PatchedAudioContext;

  // ── Receive Commands from Parent Mixer ──
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || !d.type) return;

    // Gain control
    if (d.type === 'SM_GAIN') {
      _bridge.gains.forEach(function(g) { g.gain.value = d.v; });
    }

    // Resume suspended AudioContexts (required after user gesture)
    if (d.type === 'SM_RESUME') {
      _bridge.ctxs.forEach(function(c) {
        if (c.state === 'suspended') c.resume();
      });
    }

    // Transport commands
    if (d.type === 'SM_TRANSPORT') {
      // 1) Fire custom event for apps that implement the sync protocol
      window.dispatchEvent(new CustomEvent('sessionmix:transport', {
        detail: {
          action: d.action,
          bpm: d.bpm,
          bar: d.bar,
          beat: d.beat
        }
      }));

      // 2) Auto-detect and click play/stop buttons
      if (d.action === 'play' || d.action === 'stop') {
        autoTrigger(d.action);
      }

      // 3) Resume AudioContexts on play
      if (d.action === 'play') {
        _bridge.ctxs.forEach(function(c) {
          if (c.state === 'suspended') c.resume();
        });
      }
    }
  });

  // ── Auto-Trigger Play/Stop ──
  // Scans the app's DOM for buttons with common play/stop labels
  // and simulates a click. Falls back to spacebar simulation.
  function autoTrigger(action) {
    var btns = document.querySelectorAll(
      'button, [role=button], .play-btn, .stop-btn, .start-btn, [data-action]'
    );

    var playWords = ['play', 'start', '\\u25b6', '\\u25ba', '\\u23f5'];
    var stopWords = ['stop', '\\u25a0', '\\u23f9', 'pause', '\\u275a\\u275a', '\\u23f8'];
    var targets = action === 'play' ? playWords : stopWords;

    for (var i = 0; i < btns.length; i++) {
      var txt = (btns[i].textContent || '').toLowerCase().trim();
      var cls = (btns[i].className || '').toLowerCase();
      var bid = (btns[i].id || '').toLowerCase();

      for (var j = 0; j < targets.length; j++) {
        if (txt.indexOf(targets[j]) !== -1 ||
            cls.indexOf(targets[j]) !== -1 ||
            bid.indexOf(targets[j]) !== -1) {
          btns[i].click();
          return;
        }
      }
    }

    // Fallback: simulate spacebar press (common play/pause toggle)
    if (action === 'play') {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', keyCode: 32, bubbles: true
      }));
      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: ' ', code: 'Space', keyCode: 32, bubbles: true
      }));
    }
  }

  // Expose bridge internals for debugging
  window.__SMB = _bridge;
})();
<` + `/script>`;

/**
 * VFS Fetch Interceptor — injected when loading multi-file projects.
 * Patches fetch() and XMLHttpRequest.open() so that relative paths
 * (./data.json, ../samples/kick.wav, etc.) resolve from the VFS
 * blob URL mapping at runtime. This catches dynamic fetches that
 * couldn't be statically rewritten during VFS processing.
 *
 * The __VFS_MAP__ placeholder is replaced with the actual JSON mapping
 * at injection time.
 */
const VFS_INTERCEPTOR = `<` + `script>
(function() {
  var _vfs = __VFS_MAP__;
  if (!_vfs || !Object.keys(_vfs).length) return;

  // ── Resolve a path against the VFS ──
  function vfsResolve(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.indexOf('blob:') === 0 || url.indexOf('data:') === 0 ||
        url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return null;
    var clean = url;
    if (clean.charAt(0) === '/') clean = clean.slice(1);
    if (clean.indexOf('./') === 0) clean = clean.slice(2);
    if (_vfs[url]) return _vfs[url];
    if (_vfs[clean]) return _vfs[clean];
    if (_vfs['/' + clean]) return _vfs['/' + clean];
    if (_vfs['./' + clean]) return _vfs['./' + clean];
    return null;
  }

  // ── Patch fetch() ──
  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url);
    var resolved = vfsResolve(url);
    if (resolved) {
      if (typeof input === 'string') return _origFetch.call(this, resolved, init);
      return _origFetch.call(this, new Request(resolved, input), init);
    }
    return _origFetch.apply(this, arguments);
  };

  // ── Patch XMLHttpRequest.open() ──
  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var resolved = vfsResolve(url);
    if (resolved) {
      arguments[1] = resolved;
    }
    return _origOpen.apply(this, arguments);
  };

  // ── Patch Audio constructor for new Audio('./sample.wav') ──
  var _origAudio = window.Audio;
  if (_origAudio) {
    window.Audio = function(src) {
      var resolved = src ? vfsResolve(src) : null;
      return new _origAudio(resolved || src);
    };
    window.Audio.prototype = _origAudio.prototype;
  }

  window.__SM_VFS = _vfs;
})();
<` + `/script>`;

// ─── Injection Helpers ───────────────────────────────────────

function insertAfterHead(html, script) {
  const headIdx = html.indexOf('<head');
  if (headIdx !== -1) {
    const closeIdx = html.indexOf('>', headIdx);
    return html.slice(0, closeIdx + 1) + '\n' + script + '\n' + html.slice(closeIdx + 1);
  }
  return script + '\n' + html;
}

/**
 * Inject the bridge script into raw HTML content (single-file mode).
 * Inserts right after <head> tag, or at the very start if no <head> found.
 */
export function injectBridge(html) {
  return insertAfterHead(html, BRIDGE_SCRIPT);
}

/**
 * Inject both the VFS fetch interceptor and the audio bridge (multi-file mode).
 * The VFS interceptor runs first so fetch patches are in place before any
 * app scripts execute.
 *
 * @param {string} html  - Processed HTML with paths already rewritten to blob URLs
 * @param {object} vfsMapping - { relativePath: blobURL } mapping for runtime resolution
 */
export function injectBridgeWithVFS(html, vfsMapping) {
  const vfsScript = VFS_INTERCEPTOR.replace('__VFS_MAP__', JSON.stringify(vfsMapping));
  return insertAfterHead(html, vfsScript + '\n' + BRIDGE_SCRIPT);
}
