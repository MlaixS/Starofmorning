/*
 * Morningstar (port Android) — camada de compatibilidade Node.
 *
 * O jogo original roda no Electron e usa fs/path/os/process pelas extensões
 * "Node Storage" e "Asset Manager". Aqui esses módulos são reimplementados sobre
 * a Web, SEM alterar a lógica do jogo:
 *   - camada somente-leitura: arquivos empacotados (manifest.json);
 *   - camada gravável: saves e configurações, persistidos no IndexedDB;
 *   - caminhos no estilo Windows (\) e sem diferenciar maiúsculas/minúsculas,
 *     porque o jogo foi feito no Windows ("Rooms//x" lê "rooms/x").
 */
(function (root) {
  'use strict';
  if (root.MSVFS) return; // já instalado

  const APP = '/app';
  const RES = '/app/resources';
  const ASAR = '/app/resources/app.asar';
  const HOME = '/home/user';
  const SKELETON_DIRS = [ // pastas que existem em um Windows normal e que o jogo usa com chdir
    '/tmp', HOME, HOME + '/AppData', HOME + '/AppData/Local', HOME + '/AppData/LocalLow',
    HOME + '/AppData/Roaming', HOME + '/Documents', HOME + '/Documents/My Games',
    HOME + '/Saved Games', HOME + '/Desktop'
  ];

  /* ---------------------------------------------------------------- path -- */
  const slashes = (s) => String(s).replace(/\\/g, '/');
  const stripDrive = (s) => s.replace(/^[A-Za-z]:(?=\/|$)/, '');
  function normParts(parts, abs) {
    const out = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else if (!abs) out.push('..');
      } else out.push(p);
    }
    return out;
  }
  let cwdValue = APP;
  const path = {
    sep: '/',
    delimiter: ':',
    resolve(...segs) {
      let acc = '', abs = false;
      for (let i = segs.length - 1; i >= -1 && !abs; i--) {
        let s = i >= 0 ? segs[i] : cwdValue;
        if (s === undefined || s === null) continue;
        s = stripDrive(slashes(s));
        if (!s) continue;
        acc = s + '/' + acc;
        abs = s[0] === '/';
      }
      return '/' + normParts(acc.split('/'), true).join('/');
    },
    normalize(p) {
      p = stripDrive(slashes(p));
      if (!p) return '.';
      const abs = p[0] === '/';
      const r = (abs ? '/' : '') + normParts(p.split('/'), abs).join('/');
      return r || (abs ? '/' : '.');
    },
    join(...segs) {
      const j = segs.map(slashes).filter((s) => s.length).join('/');
      if (!j) return '.';
      const abs = j[0] === '/';
      const r = (abs ? '/' : '') + normParts(j.split('/'), abs).join('/');
      return r || (abs ? '/' : '.');
    },
    isAbsolute(p) { return stripDrive(slashes(p))[0] === '/'; },
    dirname(p) {
      p = slashes(p).replace(/\/+$/, '');
      const i = p.lastIndexOf('/');
      if (i < 0) return '.';
      return i === 0 ? '/' : p.slice(0, i);
    },
    basename(p, ext) {
      p = slashes(p).replace(/\/+$/, '');
      let b = p.slice(p.lastIndexOf('/') + 1);
      if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length);
      return b;
    },
    extname(p) {
      const b = path.basename(p);
      const i = b.lastIndexOf('.');
      return i <= 0 ? '' : b.slice(i);
    }
  };
  path.posix = path;

  /* -------------------------------------------------------------- Buffer -- */
  const utf8enc = new TextEncoder();
  const utf8dec = new TextDecoder('utf-8', { ignoreBOM: true });
  function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(s) {
    const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  class Buffer extends Uint8Array {
    static from(v, enc, len) {
      if (typeof v === 'string') {
        let u;
        if (enc === 'base64' || enc === 'base64url') u = fromB64(v);
        else if (enc === 'hex') {
          u = new Uint8Array(v.length >> 1);
          for (let i = 0; i < u.length; i++) u[i] = parseInt(v.substr(i * 2, 2), 16);
        } else if (enc === 'latin1' || enc === 'binary') {
          u = new Uint8Array(v.length);
          for (let i = 0; i < v.length; i++) u[i] = v.charCodeAt(i) & 255;
        } else u = utf8enc.encode(v);
        return new Buffer(u.buffer, u.byteOffset, u.length);
      }
      if (v instanceof ArrayBuffer) return new Buffer(v, enc || 0, len === undefined ? undefined : len);
      if (ArrayBuffer.isView(v)) {
        const c = new Buffer(v.byteLength);
        c.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        return c;
      }
      if (Array.isArray(v)) { const c = new Buffer(v.length); c.set(v); return c; }
      throw new TypeError('Buffer.from: tipo não suportado');
    }
    static alloc(n, fill) { const b = new Buffer(n); if (fill) b.fill(fill); return b; }
    static isBuffer(x) { return x instanceof Buffer; }
    static byteLength(s, enc) { return typeof s === 'string' ? Buffer.from(s, enc).length : s.byteLength; }
    static concat(list, total) {
      if (total === undefined) total = list.reduce((a, b) => a + b.length, 0);
      const out = new Buffer(total);
      let o = 0;
      for (const b of list) { out.set(b.subarray(0, Math.max(0, Math.min(b.length, total - o))), o); o += b.length; if (o >= total) break; }
      return out;
    }
    toString(enc, start, end) {
      const u = (start !== undefined || end !== undefined) ? this.subarray(start || 0, end === undefined ? this.length : end) : this;
      if (enc === 'base64') return toB64(u);
      if (enc === 'base64url') return toB64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (enc === 'hex') { let h = ''; for (let i = 0; i < u.length; i++) h += (u[i] < 16 ? '0' : '') + u[i].toString(16); return h; }
      if (enc === 'latin1' || enc === 'binary') { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return s; }
      return utf8dec.decode(u);
    }
  }
  const asBuf = (u8) => (u8 instanceof Buffer ? u8 : new Buffer(u8.buffer, u8.byteOffset, u8.byteLength));
  function toBytes(data) {
    if (typeof data === 'string') return utf8enc.encode(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    return utf8enc.encode(String(data));
  }

  /* ---------------------------------------------------------- erros fs -- */
  const ERR = { ENOENT: ['no such file or directory', 2], EEXIST: ['file already exists', 17], EISDIR: ['illegal operation on a directory', 21], ENOTDIR: ['not a directory', 20], EACCES: ['permission denied', 13], ENOTEMPTY: ['directory not empty', 39] };
  function fsErr(code, syscall, p) {
    const e = new Error(code + ': ' + ERR[code][0] + ', ' + syscall + " '" + p + "'");
    e.code = code; e.syscall = syscall; e.path = p; e.errno = -ERR[code][1];
    return e;
  }

  /* ----------------------------------------------------- transporte web -- */
  // Substituível em testes (ver tests/). No navegador/WebView usa XHR/fetch.
  const transport = {
    base() { return (root.document && root.document.baseURI) || (root.location && root.location.href) || '/'; },
    syncRead(url) {
      const x = new XMLHttpRequest();
      x.open('GET', new URL(url, transport.base()).href, false);
      x.overrideMimeType('text/plain; charset=x-user-defined'); // única forma de ler binário em XHR síncrono
      x.send(null);
      if (x.status >= 400) return null;
      const s = x.responseText, u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
      return u;
    },
    async asyncRead(url) {
      const r = await fetch(new URL(url, transport.base()).href);
      if (!r.ok) return null;
      return new Uint8Array(await r.arrayBuffer());
    },
    async manifest() {
      const r = await fetch(new URL('ms-android/manifest.json', transport.base()).href);
      if (!r.ok) throw new Error('manifest.json não encontrado (' + r.status + ')');
      return r.json();
    }
  };

  /* ------------------------------------------------------------ estado -- */
  const lowerFiles = new Map(); // chave -> {p, u, s}   (somente leitura, do pacote)
  const lowerDirs = new Map();  // chave -> caminho com a caixa original
  const memFiles = new Map();   // chave -> {p, d:Uint8Array, t}   (gravável)
  const memDirs = new Map();    // chave -> caminho
  const deleted = new Set();    // chaves de arquivos do pacote "apagados"
  const cache = new Map();      // chave -> Uint8Array (leituras síncronas pequenas)
  let cacheBytes = 0;
  const CACHE_MAX_FILE = 2 * 1024 * 1024, CACHE_MAX_TOTAL = 24 * 1024 * 1024;

  const keyOf = (p) => path.resolve(p).toLowerCase();
  const parentKey = (k) => { const i = k.lastIndexOf('/'); return i <= 0 ? '/' : k.slice(0, i); };
  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  function addLowerDirs(p) {
    let cur = '';
    for (const part of p.split('/').filter(Boolean)) { cur += '/' + part; lowerDirs.set(cur.toLowerCase(), cur); }
  }
  function addMemDirs(p) {
    let cur = '';
    for (const part of p.split('/').filter(Boolean)) {
      cur += '/' + part;
      const k = cur.toLowerCase();
      if (!memDirs.has(k) && !lowerDirs.has(k)) { memDirs.set(k, cur); markDirty(); }
    }
  }
  const isDirKey = (k) => k === '/' || memDirs.has(k) || lowerDirs.has(k);
  function findFile(k) {
    const m = memFiles.get(k);
    if (m) return { mem: true, e: m };
    const l = lowerFiles.get(k);
    if (l && !deleted.has(k)) return { mem: false, e: l };
    return null;
  }

  /* -------------------------------------------------------- persistência -- */
  const DB_NAME = 'morningstar-vfs-v1';
  let db = null, dirty = false, flushTimer = null, persistOK = false;
  function markDirty() {
    dirty = true;
    if (flushTimer || !persistOK) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 400);
  }
  function idbOpen() {
    return new Promise((res, rej) => {
      if (!root.indexedDB) return res(null);
      const r = root.indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('files'); r.result.createObjectStore('meta'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function loadOverlay() {
    db = await idbOpen();
    if (!db) return;
    const tx = db.transaction(['files', 'meta'], 'readonly');
    const files = tx.objectStore('files'), meta = tx.objectStore('meta');
    const [keys, vals, dirs, del] = await Promise.all([reqP(files.getAllKeys()), reqP(files.getAll()), reqP(meta.get('dirs')), reqP(meta.get('deleted'))]);
    keys.forEach((k, i) => { const v = vals[i]; memFiles.set(k, { p: v.p, d: new Uint8Array(v.d), t: v.t }); });
    (dirs || []).forEach(([k, p]) => memDirs.set(k, p));
    (del || []).forEach((k) => deleted.add(k));
    persistOK = true;
  }
  function flush() {
    if (!db || !dirty) return Promise.resolve();
    dirty = false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(['files', 'meta'], 'readwrite');
        const files = tx.objectStore('files'), meta = tx.objectStore('meta');
        files.clear();
        for (const [k, v] of memFiles) files.put({ p: v.p, d: v.d.buffer.slice(v.d.byteOffset, v.d.byteOffset + v.d.byteLength), t: v.t }, k);
        meta.put([...memDirs], 'dirs');
        meta.put([...deleted], 'deleted');
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => { dirty = true; console.warn('[MSVFS] falha ao gravar saves', tx.error); resolve(); };
      } catch (e) { dirty = true; console.warn('[MSVFS] falha ao gravar saves', e); resolve(); }
    });
  }

  /* ------------------------------------------------------------- leitura -- */
  function readLowerSync(k, e) {
    const c = cache.get(k);
    if (c) return c;
    const u = transport.syncRead(e.u);
    if (!u) throw fsErr('ENOENT', 'open', e.p);
    if (u.length <= CACHE_MAX_FILE && cacheBytes + u.length <= CACHE_MAX_TOTAL) { cache.set(k, u); cacheBytes += u.length; }
    return u;
  }
  function readBytesSync(p, syscall) {
    const ap = path.resolve(p), k = ap.toLowerCase();
    const f = findFile(k);
    if (!f) throw fsErr(isDirKey(k) ? 'EISDIR' : 'ENOENT', syscall || 'open', ap);
    return f.mem ? f.e.d : readLowerSync(k, f.e);
  }
  async function readBytesAsync(p) {
    const ap = path.resolve(p), k = ap.toLowerCase();
    const f = findFile(k);
    if (!f) throw fsErr(isDirKey(k) ? 'EISDIR' : 'ENOENT', 'open', ap);
    if (f.mem) return f.e.d;
    const c = cache.get(k);
    if (c) return c;
    const u = await transport.asyncRead(f.e.u);
    if (!u) throw fsErr('ENOENT', 'open', ap);
    return u;
  }
  const encOf = (o) => (typeof o === 'string' ? o : o && o.encoding) || null;
  const decode = (u8, enc) => (enc ? asBuf(u8).toString(enc === 'utf-8' ? 'utf8' : enc) : Buffer.from(u8));

  /* ------------------------------------------------------------ escrita -- */
  function putFile(ap, bytes) {
    const k = ap.toLowerCase();
    if (isDirKey(k)) throw fsErr('EISDIR', 'open', ap);
    if (!isDirKey(parentKey(k))) throw fsErr('ENOENT', 'open', ap);
    const prev = memFiles.get(k);
    memFiles.set(k, { p: prev ? prev.p : ap, d: bytes, t: Date.now() });
    deleted.delete(k); cache.delete(k);
    markDirty();
  }
  function children(dirKey) {
    const out = new Map(); // chave -> {name, dir}
    const take = (map, isDir, skipDeleted) => {
      for (const [k, v] of map) {
        if (k === dirKey || parentKey(k) !== dirKey) continue;
        if (skipDeleted && deleted.has(k)) continue;
        const name = baseName(isDir ? v : v.p);
        const prev = out.get(k);
        if (!prev || isDir) out.set(k, { name, dir: isDir });
      }
    };
    take(lowerFiles, false, true); take(lowerDirs, true); take(memFiles, false); take(memDirs, true);
    return [...out.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  function mkdirSync(p, opts) {
    const ap = path.resolve(p), k = ap.toLowerCase();
    const rec = !!(opts && (opts === true || opts.recursive));
    if (isDirKey(k)) { if (rec) return undefined; throw fsErr('EEXIST', 'mkdir', ap); }
    if (findFile(k)) throw fsErr('EEXIST', 'mkdir', ap);
    if (!rec && !isDirKey(parentKey(k))) throw fsErr('ENOENT', 'mkdir', ap);
    addMemDirs(ap);
    return rec ? ap : undefined;
  }
  function statSync(p) {
    const ap = path.resolve(p), k = ap.toLowerCase();
    const f = findFile(k);
    const mk = (isF, size, t) => ({ isFile: () => isF, isDirectory: () => !isF, isSymbolicLink: () => false, size, mtimeMs: t, mtime: new Date(t) });
    if (f) return mk(true, f.mem ? f.e.d.length : f.e.s, f.mem ? f.e.t : 0);
    if (isDirKey(k)) return mk(false, 0, 0);
    throw fsErr('ENOENT', 'stat', ap);
  }
  function unlinkSync(p) {
    const ap = path.resolve(p), k = ap.toLowerCase();
    if (memFiles.delete(k)) { cache.delete(k); markDirty(); if (lowerFiles.has(k)) deleted.add(k); return; }
    if (lowerFiles.has(k) && !deleted.has(k)) { deleted.add(k); markDirty(); return; }
    throw fsErr(isDirKey(k) ? 'EISDIR' : 'ENOENT', 'unlink', ap);
  }
  function rmSync(p, opts) {
    const ap = path.resolve(p), k = ap.toLowerCase();
    const force = !!(opts && opts.force), rec = !!(opts && opts.recursive);
    if (findFile(k)) return unlinkSync(ap);
    if (!isDirKey(k)) { if (force) return; throw fsErr('ENOENT', 'rm', ap); }
    if (lowerDirs.has(k)) { if (force) return; throw fsErr('EACCES', 'rm', ap); } // pastas do pacote são somente leitura
    if (!rec && children(k).length) throw fsErr('ENOTEMPTY', 'rm', ap);
    for (const m of [memFiles, memDirs]) for (const kk of [...m.keys()]) if (kk === k || kk.startsWith(k + '/')) m.delete(kk);
    markDirty();
  }

  const direntOf = (c) => ({ name: c.name, isFile: () => !c.dir, isDirectory: () => c.dir, isSymbolicLink: () => false });
  const fs = {
    readFileSync(p, o) { return decode(readBytesSync(p), encOf(o)); },
    writeFileSync(p, data) { putFile(path.resolve(p), toBytes(data)); },
    appendFileSync(p, data) {
      const ap = path.resolve(p), f = findFile(ap.toLowerCase());
      const add = toBytes(data), old = f ? (f.mem ? f.e.d : readLowerSync(ap.toLowerCase(), f.e)) : new Uint8Array(0);
      const out = new Uint8Array(old.length + add.length); out.set(old, 0); out.set(add, old.length);
      putFile(ap, out);
    },
    existsSync(p) { try { const k = keyOf(p); return !!findFile(k) || isDirKey(k); } catch (_) { return false; } },
    accessSync(p) { const ap = path.resolve(p), k = ap.toLowerCase(); if (!findFile(k) && !isDirKey(k)) throw fsErr('ENOENT', 'access', ap); },
    mkdirSync, statSync, unlinkSync, rmSync,
    readdirSync(p, o) {
      const ap = path.resolve(p), k = ap.toLowerCase();
      if (!isDirKey(k)) throw fsErr(findFile(k) ? 'ENOTDIR' : 'ENOENT', 'scandir', ap);
      const list = children(k);
      return o && o.withFileTypes ? list.map(direntOf) : list.map((c) => c.name);
    },
    copyFileSync(a, b) { putFile(path.resolve(b), new Uint8Array(readBytesSync(a, 'copyfile'))); },
    renameSync(a, b) {
      const aa = path.resolve(a), k = aa.toLowerCase();
      if (!findFile(k)) throw fsErr(isDirKey(k) ? 'EACCES' : 'ENOENT', 'rename', aa);
      putFile(path.resolve(b), new Uint8Array(readBytesSync(aa, 'rename')));
      unlinkSync(aa);
    }
  };
  const wrapP = (fn) => (...a) => new Promise((res, rej) => { try { res(fn(...a)); } catch (e) { rej(e); } });
  fs.promises = {
    async readFile(p, o) { return decode(await readBytesAsync(p), encOf(o)); },
    writeFile: wrapP(fs.writeFileSync), appendFile: wrapP(fs.appendFileSync), mkdir: wrapP(mkdirSync),
    unlink: wrapP(unlinkSync), rm: wrapP(rmSync), readdir: wrapP(fs.readdirSync), stat: wrapP(statSync),
    access: wrapP(fs.accessSync), copyFile: wrapP(fs.copyFileSync), rename: wrapP(fs.renameSync)
  };

  /* ------------------------------------------------------ process / os -- */
  const proc = {
    cwd: () => cwdValue,
    chdir(d) {
      const ap = path.resolve(d);
      if (!isDirKey(ap.toLowerCase())) throw fsErr('ENOENT', 'chdir', ap);
      cwdValue = ap;
    },
    env: { PORTABLE_EXECUTABLE_DIR: APP, USERPROFILE: HOME, HOME: HOME, APPDATA: HOME + '/AppData/Roaming', LOCALAPPDATA: HOME + '/AppData/Local', TEMP: '/tmp', TMP: '/tmp', USERNAME: 'player' },
    resourcesPath: RES,
    platform: 'linux', arch: 'arm64', argv: ['morningstar'], pid: 1,
    nextTick(fn, ...a) { queueMicrotask(() => fn(...a)); },
    uptime: () => (root.performance ? root.performance.now() / 1000 : 0)
    // IMPORTANTE: sem "versions"/"version"/"browser", para as bibliotecas embutidas (js-md5 etc.)
    // continuarem achando que estão no navegador.
  };
  const totalMem = () => ((root.navigator && root.navigator.deviceMemory) || 4) * 1024 * 1024 * 1024;
  const os = {
    type: () => 'Linux', platform: () => 'linux', arch: () => 'arm64', homedir: () => HOME, tmpdir: () => '/tmp', EOL: '\n',
    totalmem: totalMem,
    freemem: () => Math.max(0, totalMem() - ((root.performance && root.performance.memory && root.performance.memory.usedJSHeapSize) || 0)),
    uptime: proc.uptime, cpus: () => []
  };

  const modules = { fs, 'fs/promises': fs.promises, path, os, process: proc, buffer: { Buffer } };
  function requireShim(name) {
    const n = String(name).replace(/^node:/, '');
    if (Object.prototype.hasOwnProperty.call(modules, n)) return modules[n];
    const e = new Error("Cannot find module '" + name + "'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
  }

  /* ----------------------------------------------------------- inicialização -- */
  function applyManifest(m) {
    lowerFiles.clear(); lowerDirs.clear();
    for (const d of ['/app', '/app/resources', '/app/resources/app.asar', '/app/data']) addLowerDirs(d);
    for (const [p, u, s] of m.files) {
      lowerFiles.set(p.toLowerCase(), { p, u, s });
      addLowerDirs(path.dirname(p));
    }
  }
  async function init() {
    applyManifest(await transport.manifest());
    try { await loadOverlay(); } catch (e) { console.warn('[MSVFS] sem persistência de saves:', e); db = null; }
    for (const d of SKELETON_DIRS) addMemDirs(d);
    if (root.navigator && root.navigator.storage && root.navigator.storage.persist) { try { root.navigator.storage.persist(); } catch (_) { /* opcional */ } }
    if (root.addEventListener) {
      const f = () => { flush(); };
      root.addEventListener('pagehide', f);
      if (root.document) root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'hidden') f(); });
    }
    return true;
  }

  const api = {
    ready: null, flush, transport, path, fs, os, process: proc, Buffer, require: requireShim,
    constants: { APP, RES, ASAR, HOME },
    // Apaga TODOS os saves/configurações gravados (não mexe nos arquivos do jogo).
    async resetSaves() { memFiles.clear(); memDirs.clear(); deleted.clear(); cache.clear(); dirty = true; for (const d of SKELETON_DIRS) addMemDirs(d); cwdValue = APP; await flush(); },
    init, _test: { applyManifest, memFiles, memDirs, lowerFiles, deleted }
  };
  if (root.__MSVFS_NO_AUTOINIT) api.ready = Promise.resolve(true); // usado só pelos testes
  else {
    api.ready = init();
    api.ready.catch((e) => console.error('[MSVFS] falha na inicialização', e));
  }
  root.MSVFS = api;

  // Define os globais que o Electron fornecia, sem sobrescrever nada que já exista.
  if (typeof root.require === 'undefined') root.require = requireShim;
  if (typeof root.process === 'undefined') root.process = proc;
  if (typeof root.Buffer === 'undefined') root.Buffer = Buffer;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
