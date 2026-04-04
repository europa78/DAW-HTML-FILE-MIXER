/**
 * SessionMix Virtual File System (VFS)
 *
 * Enables loading multi-file audio applications (HTML + JS + CSS + JSON +
 * YAML + samples + fonts + images) into a single iframe by:
 *
 *   1. Reading every file from a folder upload (webkitdirectory)
 *   2. Creating blob URLs for binary assets
 *   3. Rewriting relative paths in CSS, JS, and HTML to point at blob URLs
 *   4. Producing a fully-resolved HTML string ready for iframe injection
 *   5. Providing a runtime VFS mapping for the bridge fetch interceptor
 */

// ─── MIME Detection ──────────────────────────────────────────

const MIME = {
  '.html': 'text/html', '.htm': 'text/html',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.yml': 'text/yaml', '.yaml': 'text/yaml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.mid': 'audio/midi', '.midi': 'audio/midi',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.txt': 'text/plain', '.md': 'text/plain',
  '.map': 'application/json',
};

const TEXT_EXTS = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json',
  '.yml', '.yaml', '.svg', '.xml', '.txt', '.md', '.map',
]);

function ext(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}
function mime(name) { return MIME[ext(name)] || 'application/octet-stream'; }
function isText(name) { return TEXT_EXTS.has(ext(name)); }

// ─── Path Resolution ─────────────────────────────────────────

/**
 * Resolve `to` relative to the directory containing `from`.
 *   resolvePath('src/index.html', './app.js')   → 'src/app.js'
 *   resolvePath('src/index.html', '../data.json') → 'data.json'
 *   resolvePath('src/index.html', '/assets/k.wav') → 'assets/k.wav'
 */
function resolvePath(from, to) {
  if (to.startsWith('data:') || to.startsWith('blob:') ||
      to.startsWith('http://') || to.startsWith('https://')) return null;

  // Absolute from project root
  if (to.startsWith('/')) return to.slice(1);

  // Relative
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const combined = dir ? dir + '/' + to : to;
  const parts = combined.split('/');
  const out = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') { out.pop(); continue; }
    out.push(p);
  }
  return out.join('/');
}

/**
 * Try to find `target` in the VFS entries, with common fallbacks:
 *   exact match → with .js → with /index.js
 */
function lookup(entries, target) {
  if (!target) return null;
  if (entries.has(target)) return target;
  if (entries.has(target + '.js')) return target + '.js';
  if (entries.has(target + '/index.js')) return target + '/index.js';
  // Case-insensitive fallback
  const lower = target.toLowerCase();
  for (const key of entries.keys()) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

// ─── Build VFS from FileList ─────────────────────────────────

/**
 * Read every file from a folder upload and build the VFS.
 * @param {FileList} fileList
 * @returns {{ entries: Map, rootDir: string, entryHtml: string|null }}
 */
export async function buildVFS(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return null;

  // Determine root directory from webkitRelativePath
  let rootDir = '';
  if (files[0].webkitRelativePath) {
    rootDir = files[0].webkitRelativePath.split('/')[0];
  }

  const entries = new Map();

  for (const file of files) {
    let rel = file.webkitRelativePath || file.name;
    if (rootDir && rel.startsWith(rootDir + '/')) {
      rel = rel.slice(rootDir.length + 1);
    }
    // Skip hidden files and common non-essential dirs
    if (rel.startsWith('.') || rel.includes('/node_modules/') ||
        rel.includes('/.') || rel === 'package-lock.json') continue;

    const m = mime(file.name);

    if (isText(file.name)) {
      entries.set(rel, { content: await file.text(), mime: m, binary: false });
    } else {
      const buf = await file.arrayBuffer();
      const blob = new Blob([buf], { type: m });
      entries.set(rel, { url: URL.createObjectURL(blob), mime: m, binary: true });
    }
  }

  return { entries, rootDir, entryHtml: findEntryHtml(entries) };
}

// ─── Find Entry HTML ─────────────────────────────────────────

function findEntryHtml(entries) {
  // 1. index.html at root
  if (entries.has('index.html')) return 'index.html';
  // 2. Any .html at root
  for (const p of entries.keys()) {
    if (!p.includes('/') && /\.html?$/.test(p)) return p;
  }
  // 3. index.html in src/
  if (entries.has('src/index.html')) return 'src/index.html';
  // 4. Any .html in src/
  for (const p of entries.keys()) {
    if (p.startsWith('src/') && !p.slice(4).includes('/') && /\.html?$/.test(p)) return p;
  }
  // 5. Shallowest .html anywhere
  const htmls = [...entries.keys()].filter(p => /\.html?$/.test(p));
  htmls.sort((a, b) => a.split('/').length - b.split('/').length);
  return htmls[0] || null;
}

// ─── Process VFS → Resolved HTML ─────────────────────────────

/**
 * Process all VFS entries: rewrite paths to blob URLs, return the final
 * HTML string and a runtime VFS mapping for the fetch interceptor.
 */
export function processVFS(vfs) {
  const { entries, entryHtml } = vfs;
  if (!entryHtml) return null;

  const urls = new Map(); // relPath → blobURL

  // Phase 1: Binary files already have blob URLs
  for (const [path, entry] of entries) {
    if (entry.binary) urls.set(path, entry.url);
  }

  // Phase 2: Data files (JSON, YAML, TXT, XML, etc.) — no internal refs
  for (const [path, entry] of entries) {
    if (entry.binary || /\.(html?|css|m?js)$/.test(path)) continue;
    urls.set(path, URL.createObjectURL(new Blob([entry.content], { type: entry.mime })));
  }

  // Phase 3: CSS — rewrite url() to blob URLs
  for (const [path, entry] of entries) {
    if (entry.binary || !/\.css$/.test(path)) continue;
    const processed = rewriteCSS(entry.content, path, urls, entries);
    urls.set(path, URL.createObjectURL(new Blob([processed], { type: 'text/css' })));
  }

  // Phase 4: JS — rewrite imports/fetch. Multiple passes to resolve chains.
  for (let pass = 0; pass < 4; pass++) {
    for (const [path, entry] of entries) {
      if (entry.binary || !/\.m?js$/.test(path)) continue;
      if (urls.has(path)) URL.revokeObjectURL(urls.get(path));
      const processed = rewriteJS(entry.content, path, urls, entries);
      urls.set(path, URL.createObjectURL(new Blob([processed], { type: 'text/javascript' })));
    }
  }

  // Phase 5: HTML entry — rewrite src/href
  const html = rewriteHTML(entries.get(entryHtml).content, entryHtml, urls, entries);

  // Build runtime mapping for fetch interceptor (both clean and /-prefixed keys)
  const vfsMapping = {};
  for (const [path, url] of urls) {
    vfsMapping[path] = url;
    vfsMapping['/' + path] = url;
  }
  // Also add paths relative to the entry HTML's directory
  const entryDir = entryHtml.includes('/') ? entryHtml.slice(0, entryHtml.lastIndexOf('/')) : '';
  if (entryDir) {
    for (const [path, url] of urls) {
      if (path.startsWith(entryDir + '/')) {
        const rel = path.slice(entryDir.length + 1);
        vfsMapping[rel] = url;
        vfsMapping['./' + rel] = url;
      }
    }
  }

  return { html, blobUrls: urls, vfsMapping };
}

// ─── CSS Path Rewriting ──────────────────────────────────────

function rewriteCSS(css, filePath, urls, entries) {
  return css.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (match, q, ref) => {
    const resolved = resolvePath(filePath, ref);
    const found = lookup(entries, resolved);
    if (found && urls.has(found)) return `url(${q}${urls.get(found)}${q})`;
    return match;
  });
}

// ─── JS Path Rewriting ───────────────────────────────────────

function rewriteJS(js, filePath, urls, entries) {
  let out = js;

  // import ... from './path'  |  import './path'  |  export ... from './path'
  out = out.replace(
    /((?:import|export)\s+[\s\S]*?\s+from\s+['"])([^'"]+)(['"])/g,
    (m, pre, ref, post) => {
      const resolved = resolvePath(filePath, ref);
      const found = lookup(entries, resolved);
      if (found && urls.has(found)) return pre + urls.get(found) + post;
      return m;
    },
  );
  // import './path' (side-effect import without from)
  out = out.replace(
    /(import\s+['"])([^'"]+)(['"])/g,
    (m, pre, ref, post) => {
      if (ref.startsWith('blob:')) return m;
      const resolved = resolvePath(filePath, ref);
      const found = lookup(entries, resolved);
      if (found && urls.has(found)) return pre + urls.get(found) + post;
      return m;
    },
  );
  // Dynamic import('./path')
  out = out.replace(
    /import\(\s*(['"])([^'"]+)\1\s*\)/g,
    (m, q, ref) => {
      const resolved = resolvePath(filePath, ref);
      const found = lookup(entries, resolved);
      if (found && urls.has(found)) return `import(${q}${urls.get(found)}${q})`;
      return m;
    },
  );
  // fetch('./path')
  out = out.replace(
    /fetch\(\s*(['"])([^'"]+)\1/g,
    (m, q, ref) => {
      const resolved = resolvePath(filePath, ref);
      const found = lookup(entries, resolved);
      if (found && urls.has(found)) return `fetch(${q}${urls.get(found)}${q}`;
      return m;
    },
  );
  // new URL('./path', import.meta.url)
  out = out.replace(
    /new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
    (m, q, ref) => {
      const resolved = resolvePath(filePath, ref);
      const found = lookup(entries, resolved);
      if (found && urls.has(found)) return `new URL(${q}${urls.get(found)}${q}, import.meta.url)`;
      return m;
    },
  );
  // new Audio('./path') or new Audio("./path")
  out = out.replace(
    /new\s+Audio\(\s*(['"])([^'"]+)\1\s*\)/g,
    (m, q, ref) => {
      const resolved = resolvePath(filePath, ref);
      const found = lookup(entries, resolved);
      if (found && urls.has(found)) return `new Audio(${q}${urls.get(found)}${q})`;
      return m;
    },
  );

  return out;
}

// ─── HTML Path Rewriting ─────────────────────────────────────

function rewriteHTML(html, filePath, urls, entries) {
  let out = html;

  // src="..." and href="..." (skip anchors, javascript:, external URLs)
  out = out.replace(
    /((?:src|href)\s*=\s*['"])([^'"#]+)(['"])/gi,
    (m, pre, ref, post) => {
      if (/^(data:|blob:|http:|https:|javascript:|#|mailto:)/i.test(ref)) return m;
      // Absolute from root (/src/main.js) or relative
      let cleanRef = ref.startsWith('/') ? ref.slice(1) : ref;
      const resolved = resolvePath(filePath, cleanRef);
      const found = lookup(entries, resolved) || lookup(entries, cleanRef);
      if (found && urls.has(found)) return pre + urls.get(found) + post;
      return m;
    },
  );

  // Inline style url()
  out = rewriteCSS(out, filePath, urls, entries);

  return out;
}

// ─── Cleanup ─────────────────────────────────────────────────

/** Revoke every blob URL in the VFS. Call on channel unload. */
export function revokeVFS(blobUrls) {
  if (!blobUrls) return;
  for (const url of blobUrls.values()) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
}
