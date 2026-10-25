/*
 * Morningstar (port Android) — desempenho, memória e diagnóstico. Não altera o código do jogo.
 *   • Memória: o runtime não libera o áudio decodificado de um som apagado. Cada música externa (data/mus)
 *     pesa 30–60 MB decodificada e ficava presa no SoundBank até o fim da sessão; aqui ela é solta assim que
 *     o som para. Era a causa provável de o app fechar depois de várias trocas de música.
 *   • Resolução de renderização: Auto / Alta / Média / Baixa. O palco tem 640×480, mas no celular o canvas
 *     chegava a ~1500×1100 (5× mais pixels por quadro).
 *   • Movimento suave: interpolação do TurboWarp, seguindo a taxa da tela (a lógica do jogo segue em 30/s).
 *   • Contador de FPS e relatório de falhas que sobrevive a um fechamento inesperado do app.
 */
(function (root) {
  'use strict';
  if (root.MSPerf) return;

  /* ------------------------------------------------------------ dados -- */
  const STORE_KEY = 'morningstar-perf-v1', DB_NAME = 'morningstar-diag', EXIT_KEY = 'morningstar-exit';
  const DEFAULTS = { v: 1, res: 'auto', auto: 'high', smooth: 'off', fps: false };
  const LEVELS = ['high', 'mid', 'low'];                    // do mais nítido ao mais leve
  const LEVEL_W = { high: Infinity, mid: 960, low: 640 };   // largura do canvas em px (o palco tem 640×480)
  const LEVEL_NAME = { auto: 'Auto', high: 'Alta', mid: 'Média', low: 'Baixa' };
  const HZ = [60, 72, 75, 90, 120, 144, 165, 240];
  const LOG_MAX = 80, DROP_SECONDS = 8, DROP_BELOW = 24;    // Auto: 8 s seguidos abaixo de 24 passos/s (o jogo roda a 30)
  const CFG = { warmup: 40 };                               // Auto só avalia depois de 40 s de jogo (a carga inicial é pesada)

  function mergeSettings(raw) {
    const s = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') return s;
    if (['auto', 'high', 'mid', 'low'].includes(raw.res)) s.res = raw.res;
    if (LEVELS.includes(raw.auto)) s.auto = raw.auto;
    if (['off', 'full', 'half'].includes(raw.smooth)) s.smooth = raw.smooth;
    if (typeof raw.fps === 'boolean') s.fps = raw.fps;
    return s;
  }
  const levelOf = (s) => (s.res === 'auto' ? s.auto : s.res);
  // devicePixelRatio efetivo: limita o canvas à largura-alvo do nível, nunca acima do real do aparelho
  function dprFor(real, cssW, level) {
    const w = LEVEL_W[level];
    return w && isFinite(w) && cssW > 0 ? Math.min(real, w / cssW) : real;
  }
  const nextLevel = (l) => LEVELS[Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(l)) + 1)];
  const shouldDrop = (tps) => tps.length >= DROP_SECONDS && tps.slice(-DROP_SECONDS).every((v) => v < DROP_BELOW);
  function snapHz(ms) {
    if (!(ms > 0)) return 0;
    const hz = 1000 / ms; let best = 0, d = Infinity;
    for (const r of HZ) if (Math.abs(r - hz) < d) { d = Math.abs(r - hz); best = r; }
    return best;
  }
  // Taxa da tela a partir dos intervalos entre quadros (ms): ignora rajadas (<3 ms) e usa o 25º percentil
  function hzFromIntervals(iv) {
    const a = iv.filter((v) => v > 3 && v < 60).sort((x, y) => x - y);
    if (a.length < 5) return 0;
    const ms = a[Math.floor(a.length * 0.25)];
    return 1000 / ms < 50 ? 0 : snapHz(ms);
  }
  function smoothOptions(hz, keepHalf) {
    const o = [['off', 'Original · 30'], ['full', 'Suave · ' + hz]];
    if (hz >= 90 || keepHalf) o.push(['half', 'Suave · ' + Math.round(hz / 2)]);
    return o;
  }
  function fmtReport(rec, title) {
    if (!rec) return '';
    const L = ['== ' + title + ' ==', 'início ' + new Date(rec.t0).toLocaleString() + ' · último sinal ' + new Date(rec.t).toLocaleString() + ' · estado ' + rec.state, 'aparelho: ' + rec.dev];
    if (rec.mem) L.push('memória: ' + rec.mem);
    for (const e of rec.log) L.push(((e[0] - rec.t0) / 1000).toFixed(1).padStart(7) + 's  ' + e[1] + '  ' + e[2] + (e[3] > 1 ? '  (×' + e[3] + ')' : ''));
    return L.join('\n');
  }

  const pure = { mergeSettings, levelOf, dprFor, nextLevel, shouldDrop, snapHz, hzFromIntervals, smoothOptions, fmtReport, DEFAULTS, LEVEL_W };
  if (typeof document === 'undefined') { if (typeof module !== 'undefined' && module.exports) module.exports = { _pure: pure }; return; }

  /* ------------------------------------------------------------ estado -- */
  let S = mergeSettings(null);
  try { S = mergeSettings(JSON.parse(root.localStorage.getItem(STORE_KEY))); } catch (_) { /* sem armazenamento: vale só nesta sessão */ }
  const save = () => { try { root.localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (_) { /* opcional */ } };
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

  // devicePixelRatio real do aparelho (guardado antes de ser substituído abaixo)
  const dprDesc = Object.getOwnPropertyDescriptor(root, 'devicePixelRatio');
  const dpr0 = root.devicePixelRatio || 1;
  const realDpr = () => { try { return (dprDesc && dprDesc.get ? dprDesc.get.call(root) : dpr0) || 1; } catch (_) { return dpr0; } };

  const t0 = Date.now();
  let cssW = 0, cssH = 0;                 // tamanho do palco em px CSS (do último resize do renderer)
  let steps = 0, draws = 0, lastSteps = 0, lastDraws = 0, tpsNow = 0, fpsNow = 0, tickN = 0, autoCool = 0;
  let firstStepAt = 0, hz = 0, memText = '', lastAudioMB = 0, vis = 'visible', dirty = true, lastSave = 0, devStr = '';
  let wrappedR = null, hooked = false, crashed = null, lastCrash = null, fpsEl = null, toastEl = null, toastT = 0, refreshPanel = () => {};
  const tpsHist = [], log = [], bcSeen = new Map();

  const stageCssW = () => (cssW > 0 ? cssW : Math.min(root.innerWidth, root.innerHeight * 4 / 3));
  const effDpr = () => dprFor(realDpr(), stageCssW(), levelOf(S));
  try { Object.defineProperty(root, 'devicePixelRatio', { configurable: true, enumerable: true, get: effDpr }); } catch (_) { /* sem override: a resolução fica sempre Alta */ }

  /* -------------------------------------------------------- diagnóstico -- */
  // O relatório fica no IndexedDB, não no localStorage: o localStorage só vai para o disco alguns segundos depois e,
  // se o app inteiro cair, esses últimos segundos (os que importam) se perdem. O IndexedDB entrega a gravação na hora.
  const kv = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = root.indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    return {
      get: (k) => open().then((db) => new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); })),
      set: (k, v) => open().then((db) => new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }))
    };
  })();
  function note(type, text) {
    text = String(text).slice(0, 240);
    const last = log[log.length - 1];
    if (last && last[1] === type && last[2] === text) { last[3] = (last[3] || 1) + 1; dirty = true; return; }
    log.push([Date.now(), type, text, 1]); if (log.length > LOG_MAX) log.shift(); dirty = true;
  }
  function persist(force) {
    const now = Date.now();
    if (!force && (!dirty || now - lastSave < 2000)) return;
    dirty = false; lastSave = now;
    kv.set('cur', { v: 1, t0, t: now, state: vis, dev: devStr, mem: memText, log }).catch(() => { /* sem IndexedDB: o relatório vale só nesta sessão */ });
  }
  root.addEventListener('error', (e) => note('erro', (e.message || 'erro') + ' @' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0)));
  root.addEventListener('unhandledrejection', (e) => note('rejeição', (e.reason && (e.reason.stack || e.reason.message)) || e.reason));
  const consoleError = console.error;
  console.error = function () {
    try { note('console', Array.prototype.map.call(arguments, (a) => (a && a.message) || String(a)).join(' ')); } catch (_) { /* nunca quebrar o console */ }
    return consoleError.apply(this, arguments);
  };
  // "Saída limpa": marcada também de forma síncrona (localStorage), pois uma gravação assíncrona no IndexedDB pode não
  // terminar se a página for descarregada no mesmo instante (isso viraria um falso alarme de falha).
  const markExit = () => { try { root.localStorage.setItem(EXIT_KEY, String(Date.now())); } catch (_) { /* opcional */ } };
  const setVis = () => { vis = document.visibilityState === 'hidden' ? 'hidden' : 'visible'; if (vis === 'hidden') markExit(); note('tela', vis); persist(true); };
  document.addEventListener('visibilitychange', setVis);
  root.addEventListener('pagehide', () => { vis = 'hidden'; markExit(); persist(true); });
  root.addEventListener('pageshow', setVis);

  function bc(name) {
    const now = Date.now(), last = bcSeen.get(name);
    if (last && now - last < 1500) return;
    if (bcSeen.size > 200) bcSeen.clear();
    bcSeen.set(name, now); note('envio', name);
  }

  /* -------------------------------------------------------------- áudio -- */
  // Solta o áudio decodificado de um som apagado do sprite (o runtime só tira o som da lista do sprite).
  function releaseSound(bank, id) {
    const player = bank && bank.soundPlayers && bank.soundPlayers[id];
    if (!player) return;
    const forget = () => {
      if (bank.soundPlayers[id] !== player) return null;
      delete bank.soundPlayers[id];
      if (bank.playerTargets) bank.playerTargets.delete(id);
      const fx = bank.soundEffects && bank.soundEffects.get(id);
      if (bank.soundEffects) bank.soundEffects.delete(id);
      return fx || null;
    };
    // Ainda tocando: o jogo pode pará-la depois ("parar todos os sons"), então só soltamos quando ela parar.
    if (player.isPlaying && typeof player.once === 'function') { player.once('stop', () => setTimeout(forget, 1500)); return; }
    const fx = forget();
    try { player.dispose(); if (fx && fx.dispose) fx.dispose(); } catch (_) { /* já solto */ }
  }
  function audioMB(rt) {
    let bytes = 0; const seen = new Set();
    for (const t of rt.targets) {
      const sp = t.sprite, bank = sp && sp.soundBank;
      if (!bank || seen.has(bank)) continue; seen.add(bank);
      for (const id in bank.soundPlayers) { const b = bank.soundPlayers[id] && bank.soundPlayers[id].buffer; if (b) bytes += b.length * b.numberOfChannels * 4; }
    }
    return bytes / 1048576;
  }

  /* ------------------------------------------------- resolução e fluidez -- */
  function applyRes() {
    const r = wrappedR;
    if (!r || !(cssW > 0)) return;
    try { r.resize(cssW, cssH); } catch (e) { note('erro', 'resize: ' + e.message); return; }
    note('resolução', (S.res === 'auto' ? 'Auto→' : '') + LEVEL_NAME[levelOf(S)] + ' ' + (r.canvas ? r.canvas.width + '×' + r.canvas.height : ''));
  }
  function applySmooth() {
    const vm = root.vm, rt = vm && vm.runtime, fl = rt && rt.frameLoop;
    if (!fl || !vm.setInterpolation) return;
    if (!fl._msInterp) fl._msInterp = fl.interpolationCallback;       // original (já vinculada)
    if (S.smooth === 'half') { let n = 0; fl.interpolationCallback = () => { if ((n++ & 1) === 0) fl._msInterp(); }; } // 1 a cada 2 quadros da tela
    else fl.interpolationCallback = fl._msInterp;
    vm.setInterpolation(S.smooth !== 'off');                           // reinicia o frameLoop com a função escolhida
    note('movimento', S.smooth);
  }
  function dropLevel() {
    S.auto = nextLevel(S.auto); save(); applyRes();
    note('auto', 'resolução → ' + LEVEL_NAME[S.auto] + ' (passos/s: ' + tpsHist.join(',') + ')');
    toast('Desempenho baixo: resolução reduzida (' + LEVEL_NAME[S.auto] + ')');
    tpsHist.length = 0; autoCool = 20; refreshPanel();
  }

  function hookRenderer(vm) {
    const r = vm.renderer;
    if (!r || r._msPerf) return;
    r._msPerf = true; wrappedR = r;
    const resize = r.resize, draw = r.draw;
    r.resize = function (w, hh) { if (w > 0 && hh > 0) { cssW = w; cssH = hh; } return resize.apply(this, arguments); };
    r.draw = function () { draws++; return draw.apply(this, arguments); };
    const c = r.canvas;
    if (c) {
      c.addEventListener('webglcontextlost', () => { note('GPU', 'contexto WebGL perdido'); toast('Falha gráfica (GPU). Se a tela travar, reinicie o jogo.'); persist(true); });
      c.addEventListener('webglcontextrestored', () => note('GPU', 'contexto WebGL restaurado'));
      const b = c.getBoundingClientRect(); if (b.width > 0 && !(cssW > 0)) { cssW = b.width; cssH = b.height; }
    }
    applyRes();
  }
  function hookRuntime(vm) {
    const rt = vm.runtime;
    if (hooked || !rt.targets.length) return;
    hooked = true;
    rt.on('AFTER_EXECUTE', () => { steps++; });
    const proto = Object.getPrototypeOf(rt.targets[0]);
    if (proto && typeof proto.deleteSound === 'function' && !proto._msSoundFix) {
      proto._msSoundFix = true;
      const del = proto.deleteSound;
      proto._msDeleteSound = del;                                      // original, para comparação nos testes
      proto.deleteSound = function (index) {
        const sp = this.sprite, entry = sp && sp.sounds && sp.sounds[index];
        const id = entry && entry.soundId, name = entry && entry.name;
        const out = del.apply(this, arguments);
        try { if (id && !sp.sounds.some((s) => s.soundId === id)) { releaseSound(sp.soundBank, id); note('som', '− ' + name); } } catch (e) { note('erro', 'deleteSound: ' + e.message); }
        return out;
      };
    }
    const sh = rt.startHats;                                           // registra as transmissões do jogo (pistas para uma falha)
    rt.startHats = function (op, fields) {
      try { if (op === 'event_whenbroadcastreceived' && fields && fields.BROADCAST_OPTION) bc(fields.BROADCAST_OPTION); } catch (_) { /* só diagnóstico */ }
      return sh.apply(this, arguments);
    };
    const as = vm.addSound;
    if (typeof as === 'function') vm.addSound = function (s) {
      try { note('som', '+ ' + (s && s.name) + ' ' + Math.round(((s && s.asset && s.asset.data && s.asset.data.length) || 0) / 1024) + ' KB'); } catch (_) { /* só diagnóstico */ }
      return as.apply(this, arguments);
    };
    rt.on('PROJECT_START', () => setTimeout(applySmooth, 0));          // o index.html reaplica interpolação=desligada ao iniciar
    applySmooth(); setTimeout(applySmooth, 2500);
  }

  function measureHz(ms, cb) {
    const iv = []; let last = 0, first = 0;
    const f = (t) => {
      if (last) iv.push(t - last);
      last = t; if (!first) first = t;
      if (t - first < ms) root.requestAnimationFrame(f);
      else { const v = hzFromIntervals(iv); if (v) hz = v; if (cb) cb(hz || 60); }
    };
    root.requestAnimationFrame(f);
  }

  /* ------------------------------------------------------- tick (1 s) -- */
  function sample(vm) {
    const rt = vm && vm.runtime; if (!rt || !rt.targets) return;
    const a = audioMB(rt), heap = root.performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;
    memText = 'áudio decodificado ' + Math.round(a) + ' MB' + (heap ? ' · heap JS ' + heap + ' MB' : '') + ' · canvas ' + (wrappedR && wrappedR.canvas ? wrappedR.canvas.width + '×' + wrappedR.canvas.height : '?') + ' · ' + tpsNow + ' passos/s';
    if (Math.abs(a - lastAudioMB) >= 20) { note('mem', memText); lastAudioMB = a; }
    dirty = true;
  }
  function paintFps() {
    if (!fpsEl) { fpsEl = h('div', 'ms-fps'); document.body.append(fpsEl); }
    const c = wrappedR && wrappedR.canvas;
    const heap = root.performance && performance.memory ? ' · ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : '';
    fpsEl.textContent = tpsNow + ' passos · ' + fpsNow + ' fps · ' + (c ? c.width + '×' + c.height : '?') + heap;
    fpsEl.style.display = '';
  }
  function showFps() { if (S.fps) paintFps(); else if (fpsEl) fpsEl.style.display = 'none'; }
  function tick() {
    tickN++;
    tpsNow = steps - lastSteps; fpsNow = draws - lastDraws; lastSteps = steps; lastDraws = draws;
    if (vis === 'visible' && steps > 0) {
      if (!firstStepAt) firstStepAt = Date.now();
      if (autoCool > 0) autoCool--;
      else if (Date.now() - firstStepAt >= CFG.warmup * 1000 && S.res === 'auto' && S.auto !== 'low') { tpsHist.push(tpsNow); if (tpsHist.length > DROP_SECONDS + 2) tpsHist.shift(); if (shouldDrop(tpsHist)) dropLevel(); }
    }
    if (tickN % 5 === 0) sample(root.vm);
    showFps();
    persist(false);
  }

  /* ------------------------------------------------------------- avisos -- */
  function toast(msg, ms) {
    if (!document.body) return;
    if (!toastEl) { toastEl = h('div', 'ms-toast'); toastEl.addEventListener('pointerdown', () => { toastEl.style.display = 'none'; }); document.body.append(toastEl); }
    toastEl.textContent = msg; toastEl.style.display = '';
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.display = 'none'; }, ms || 6000);
  }
  function copyText(text) {
    const fallback = () => {
      try {
        const ta = h('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (_) { return false; }
    };
    const done = (ok) => { if (ok) toast('Relatório copiado. Cole na conversa e me envie.'); else root.prompt('Copie o relatório abaixo:', text); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(fallback()));
    else done(fallback());
  }
  function reportText() {
    const parts = [];
    if (lastCrash) parts.push(fmtReport(lastCrash, 'FALHA ANTERIOR (o app fechou sem aviso)'));
    parts.push(fmtReport({ t0, t: Date.now(), state: vis, dev: devStr, mem: memText, log }, 'SESSÃO ATUAL'));
    return parts.join('\n\n');
  }

  /* ----------------------------------------------- seção do painel (⚙) -- */
  function panelSection() {
    const el = h('div', 'perf');
    const row = (label, ...kids) => { const r = h('div', 'row'); r.append(h('label', '', label), ...kids); return r; };
    const seg = h('span', 'seg tight'), btn = {};
    ['auto', 'high', 'mid', 'low'].forEach((id) => {
      const b = h('button', '', LEVEL_NAME[id]); btn[id] = b;
      b.addEventListener('click', () => { S.res = id; save(); applyRes(); sync(); });
      seg.append(b);
    });
    const resNote = h('p', 'note');
    const sel = h('select'); sel.addEventListener('change', () => { S.smooth = sel.value; save(); applySmooth(); sync(); });
    const chk = h('label', 'chk'), ci = h('input'); ci.type = 'checkbox';
    ci.addEventListener('change', () => { S.fps = ci.checked; save(); showFps(); });
    chk.append(ci, document.createTextNode(' Mostrar FPS na tela'));
    const hzNote = h('p', 'note');
    const bCopy = h('button', '', 'Copiar relatório'), bClear = h('button', '', 'Apagar');
    bCopy.addEventListener('click', () => copyText(reportText()));
    bClear.addEventListener('click', () => { lastCrash = crashed = null; kv.set('last', null).catch(() => {}); log.length = 0; dirty = true; sync(); });
    const repBox = h('span', 'rep'); repBox.append(bCopy, bClear);
    const repNote = h('p', 'note');
    el.append(row('Resolução', seg), resNote, row('Movimento', sel), chk, hzNote, row('Relatório', repBox), repNote);
    function sync() {
      for (const id in btn) btn[id].classList.toggle('act', S.res === id);
      const c = wrappedR && wrappedR.canvas, lvl = levelOf(S);
      resNote.textContent = (S.res === 'auto' ? 'Auto: começa em Alta e reduz sozinho se o jogo cair abaixo de ' + DROP_BELOW + ' passos/s por ' + DROP_SECONDS + ' s. Agora: ' : 'Agora: ')
        + LEVEL_NAME[lvl] + (c ? ' · canvas ' + c.width + '×' + c.height : '') + '.';
      sel.textContent = '';
      for (const [v, t] of smoothOptions(hz || 60, S.smooth === 'half')) { const o = h('option', '', t); o.value = v; sel.append(o); }
      sel.value = S.smooth; ci.checked = S.fps;
      hzNote.textContent = 'Tela detectada: ' + (hz || 60) + ' Hz. “Suave” renderiza mais quadros por segundo e pode causar falhas visuais em alguns efeitos.';
      repNote.textContent = lastCrash ? 'O app fechou sem aviso em ' + new Date(lastCrash.t).toLocaleString() + '. Copie o relatório e me envie.' : 'Nenhuma falha registrada. O relatório também mostra o que o jogo fazia agora há pouco.';
    }
    refreshPanel = sync; el._sync = () => { sync(); measureHz(700, sync); };
    return el;
  }

  /* ----------------------------------------------------------- iniciar -- */
  const CSS = `
  @font-face{font-family:MSDetermination;src:url(assets/689cda6ac1fe62d63cc6e37e9dc0f9d0.woff) format("woff");font-display:swap}
  .ms-fps{position:fixed;z-index:2147483100;left:calc(env(safe-area-inset-left,0px) + 6px);top:calc(env(safe-area-inset-top,0px) + 4px);pointer-events:none;font:12px/1.3 monospace;color:#7dff7d;background:rgba(0,0,0,.6);padding:2px 6px;border-radius:3px}
  .ms-toast{position:fixed;z-index:2147483200;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 10px);max-width:min(92vw,560px);box-sizing:border-box;background:#000;color:#fff;border:3px solid #fff;padding:8px 12px;font:18px/1.25 MSDetermination,"Courier New",monospace;text-align:center}
  .ms-panel .seg.tight button{padding:9px 8px}.ms-panel .rep{display:flex;gap:8px}.ms-panel h2.sec{margin:16px 0 4px}
  .ms-panel .perf .note{margin:2px 0 8px}`;
  function init() {
    const st = h('style'); st.textContent = CSS; document.head.append(st);
    devStr = [navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120), 'dpr ' + realDpr().toFixed(2), root.innerWidth + '×' + root.innerHeight, navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'RAM ?'].join(' | ');
    vis = document.visibilityState === 'hidden' ? 'hidden' : 'visible';
    // Se a sessão anterior parou com a tela visível e sem "saída limpa", o app fechou sozinho (travou ou o sistema o encerrou).
    // A leitura vem ANTES da primeira gravação desta sessão.
    kv.get('cur').then((prev) => {
      let exit = 0; try { exit = Number(root.localStorage.getItem(EXIT_KEY)) || 0; } catch (_) { /* sem marca */ }
      if (prev && prev.v === 1 && prev.state === 'visible' && exit < prev.t && Array.isArray(prev.log)) {
        crashed = lastCrash = prev; kv.set('last', prev).catch(() => {});
        toast('O jogo fechou sozinho da última vez. Abra ⚙ › Desempenho › Copiar relatório e me envie.', 15000);
        refreshPanel();
      } else return kv.get('last').then((l) => { lastCrash = l || null; refreshPanel(); });
    }).catch(() => { /* sem IndexedDB */ });
    note('início', devStr); persist(true);
    let tries = 0;
    const poll = setInterval(() => {
      const vm = root.vm;
      if (vm && vm.renderer) hookRenderer(vm);
      if (vm && vm.runtime && vm.runtime.targets && vm.runtime.targets.length) hookRuntime(vm);
      if ((wrappedR && hooked) || ++tries > 3000) clearInterval(poll);
    }, 100);
    setInterval(tick, 1000);
    setTimeout(() => measureHz(2500), 1500);
  }
  root.MSPerf = {
    panelSection, settings: () => S, report: reportText, _pure: pure, _cfg: CFG,
    set(patch) { S = mergeSettings(Object.assign({}, S, patch)); save(); applyRes(); applySmooth(); showFps(); refreshPanel(); },
    state: () => ({ level: levelOf(S), hz, tps: tpsNow, fps: fpsNow, steps, crashed: !!crashed, cssW, cssH, canvas: wrappedR && wrappedR.canvas ? [wrappedR.canvas.width, wrappedR.canvas.height] : null, hooked })
  };
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
