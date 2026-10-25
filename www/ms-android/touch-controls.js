/*
 * Morningstar (port Android) — controles de toque.
 * Converte toques em eventos de teclado (o jogo é controlado por teclado), sem tocar no código do jogo.
 *   • Direcional: D-pad ou analógico (4 teclas de seta, com diagonais)
 *   • Botões: Z, X, C, Shift, Enter, Esc, Ctrl (Ctrl vem desligado)
 *   • Ajustes: opacidade, tamanho, vibração, modo canhoto, botões visíveis
 *   • Editor: arraste cada controle e ajuste o tamanho de cada um (paisagem e retrato separados)
 */
(function (root) {
  'use strict';
  if (root.MSTouch) return;

  /* ------------------------------------------------------------ dados -- */
  const KEYS = {
    up: { key: 'ArrowUp', code: 'ArrowUp', kc: 38 }, down: { key: 'ArrowDown', code: 'ArrowDown', kc: 40 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', kc: 37 }, right: { key: 'ArrowRight', code: 'ArrowRight', kc: 39 },
    z: { key: 'z', code: 'KeyZ', kc: 90 }, x: { key: 'x', code: 'KeyX', kc: 88 }, c: { key: 'c', code: 'KeyC', kc: 67 },
    shift: { key: 'Shift', code: 'ShiftLeft', kc: 16 }, enter: { key: 'Enter', code: 'Enter', kc: 13 },
    esc: { key: 'Escape', code: 'Escape', kc: 27 }, ctrl: { key: 'Control', code: 'ControlLeft', kc: 17 }
  };
  const BUTTONS = [
    { id: 'z', label: 'Z' }, { id: 'x', label: 'X' }, { id: 'c', label: 'C' }, { id: 'shift', label: 'Shift' },
    { id: 'enter', label: 'Enter', small: true }, { id: 'esc', label: 'Esc', small: true }, { id: 'ctrl', label: 'Ctrl', small: true }
  ];
  const IDS = ['dir'].concat(BUTTONS.map((b) => b.id));
  // posições = centro do controle, em fração da tela (x, y)
  const LAYOUT = {
    l: { dir: [0.12, 0.66], z: [0.91, 0.70], x: [0.80, 0.80], c: [0.80, 0.58], shift: [0.91, 0.47], enter: [0.91, 0.25], esc: [0.09, 0.22], ctrl: [0.80, 0.36] },
    p: { dir: [0.22, 0.80], z: [0.88, 0.76], x: [0.72, 0.88], c: [0.72, 0.68], shift: [0.88, 0.60], enter: [0.88, 0.50], esc: [0.12, 0.50], ctrl: [0.72, 0.50] }
  };
  const DEFAULTS = {
    v: 1, enabled: 'auto', mode: 'dpad', skin: 'ut', opacity: 0.6, size: 1, haptics: true, hideWithGamepad: true, leftHanded: false,
    show: { z: true, x: true, c: true, shift: true, enter: true, esc: true, ctrl: false }, pos: { l: {}, p: {} }, scale: {}
  };
  const STORE_KEY = 'morningstar-touch-v1';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v) => typeof v === 'number' && isFinite(v);

  function mergeSettings(raw) {
    const s = JSON.parse(JSON.stringify(DEFAULTS));
    if (!raw || typeof raw !== 'object') return s;
    if (['auto', 'on', 'off'].includes(raw.enabled)) s.enabled = raw.enabled;
    if (['dpad', 'stick'].includes(raw.mode)) s.mode = raw.mode;
    if (['ut', 'classic'].includes(raw.skin)) s.skin = raw.skin;
    if (num(raw.opacity)) s.opacity = clamp(raw.opacity, 0.15, 1);
    if (num(raw.size)) s.size = clamp(raw.size, 0.6, 1.6);
    for (const k of ['haptics', 'hideWithGamepad', 'leftHanded']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
    if (raw.show && typeof raw.show === 'object') for (const b of BUTTONS) if (typeof raw.show[b.id] === 'boolean') s.show[b.id] = raw.show[b.id];
    if (raw.pos && typeof raw.pos === 'object') {
      for (const o of ['l', 'p']) for (const id of IDS) {
        const p = raw.pos[o] && raw.pos[o][id];
        if (Array.isArray(p) && num(p[0]) && num(p[1])) s.pos[o][id] = [clamp(p[0], 0, 1), clamp(p[1], 0, 1)];
      }
    }
    if (raw.scale && typeof raw.scale === 'object') for (const id of IDS) if (num(raw.scale[id])) s.scale[id] = clamp(raw.scale[id], 0.5, 2);
    return s;
  }

  // Vetor do dedo (dx, dy em px, y para baixo) -> quais setas estão pressionadas.
  function dirFromVector(dx, dy, radius, mode) {
    const out = { up: false, down: false, left: false, right: false };
    const dead = radius * (mode === 'stick' ? 0.28 : 0.2);
    if (Math.hypot(dx, dy) < dead) return out;
    const ax = Math.abs(dx), ay = Math.abs(dy), k = mode === 'dpad' ? 0.6 : 0.414; // tan 22,5° no analógico
    const h = dx > 0 ? 'right' : 'left', v = dy > 0 ? 'down' : 'up';
    if (ay < ax * k) out[h] = true;
    else if (ax < ay * k) out[v] = true;
    else { out[h] = true; out[v] = true; }
    return out;
  }

  const pure = { dirFromVector, mergeSettings, DEFAULTS, KEYS, LAYOUT, BUTTONS, IDS, clamp };
  if (typeof document === 'undefined') { if (typeof module !== 'undefined' && module.exports) module.exports = { _pure: pure }; return; }

  /* ------------------------------------------------------------- estado -- */
  let S = DEFAULTS;
  try { S = mergeSettings(JSON.parse(root.localStorage.getItem(STORE_KEY))); } catch (_) { S = mergeSettings(null); }
  const save = () => { try { root.localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (_) { /* sem armazenamento: ajustes valem só nesta sessão */ } };

  const held = {};           // tecla -> quantos controles a seguram
  const ctl = {};            // id -> {el, def}
  let vw = 0, vh = 0, ins = { t: 0, r: 0, b: 0, l: 0 }, editing = false, selected = null, gamepads = 0;
  let layer, ui, gear, panel, bar, probe, curDirs = { up: false, down: false, left: false, right: false };

  /* --------------------------------------------------------- teclado -- */
  function fire(def, down) {
    const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', { key: def.key, code: def.code, bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(ev, 'keyCode', { get: () => def.kc });
    Object.defineProperty(ev, 'which', { get: () => def.kc });
    document.dispatchEvent(ev); // alvo = document, como o jogo exige; sobe até window
  }
  // O jogo lê as teclas a cada passo (30/s). Se ele engasga (cena pesada), um toque curto cai entre dois
  // passos e se perde: era preciso segurar o botão por 1–2 s. Por isso a tecla só é solta depois que o jogo
  // executou MIN_STEPS passos com ela pressionada (e MIN_HOLD ms), com teto de MAX_HOLD ms para nunca travar.
  const MIN_HOLD = 70, MIN_STEPS = 2, MAX_HOLD = 2500, downAt = {}, downStep = {}, pendingUp = {};
  let steps = 0, stepHooked = false, hookTries = 0;
  const upReady = (n) => { const age = Date.now() - downAt[n]; return age >= MAX_HOLD || (age >= MIN_HOLD && (!stepHooked || steps - downStep[n] >= MIN_STEPS)); };
  function finishUp(n) { clearTimeout(pendingUp[n]); pendingUp[n] = null; if (!held[n]) fire(KEYS[n], false); }
  function hookSteps() {
    const rt = root.vm && root.vm.runtime;
    if (!rt || !rt.on) return false;
    rt.on('AFTER_EXECUTE', () => { steps++; for (const n in pendingUp) if (pendingUp[n] && upReady(n)) finishUp(n); });
    return (stepHooked = true);
  }
  function press(name) {
    held[name] = (held[name] || 0) + 1;
    if (pendingUp[name]) { clearTimeout(pendingUp[name]); pendingUp[name] = null; return; } // ainda estava "solta em breve": segue pressionada
    if (held[name] === 1) { downAt[name] = Date.now(); downStep[name] = steps; fire(KEYS[name], true); }
  }
  function release(name, now) {
    if (!held[name]) return;
    held[name]--;
    if (held[name] !== 0) return;
    if (now || upReady(name)) { fire(KEYS[name], false); return; }
    const age = Date.now() - downAt[name];
    pendingUp[name] = setTimeout(() => finishUp(name), Math.max(0, (stepHooked ? MAX_HOLD : MIN_HOLD) - age));
  }
  function setDirs(next) {
    for (const n of ['up', 'down', 'left', 'right']) {
      if (next[n] && !curDirs[n]) press(n);
      else if (!next[n] && curDirs[n]) release(n);
    }
    curDirs = next;
    if (ctl.dir) for (const n of ['up', 'down', 'left', 'right']) ctl.dir.el.classList.toggle('on-' + n, !!next[n]);
  }
  function releaseAll() {
    setDirs({ up: false, down: false, left: false, right: false });
    for (const n of Object.keys(held)) { if (pendingUp[n]) { clearTimeout(pendingUp[n]); pendingUp[n] = null; held[n] = 1; } if (held[n] > 0) { held[n] = 1; release(n, true); } }
    for (const id of Object.keys(ctl)) { ctl[id].el.classList.remove('on'); ctl[id].pid = null; }
    if (ctl.dir) { const k = ctl.dir.el.querySelector('.knob'); if (k) k.style.transform = 'translate(-50%,-50%)'; }
  }
  const buzz = () => { if (S.haptics && root.navigator && navigator.vibrate) { try { navigator.vibrate(8); } catch (_) { /* opcional */ } } };

  /* ----------------------------------------------------------- layout -- */
  const orient = () => (vw >= vh ? 'l' : 'p');
  function posOf(id) {
    const p = (S.pos[orient()][id]) || LAYOUT[orient()][id];
    return [S.leftHanded ? 1 - p[0] : p[0], p[1]];
  }
  function sizeOf(id) {
    const u = Math.min(vw, vh), sc = S.scale[id] || 1, small = id !== 'dir' && BUTTONS.find((b) => b.id === id).small;
    if (id === 'dir') return clamp(u * 0.46 * S.size * sc, 110, 320);
    return clamp(u * (small ? 0.125 : 0.18) * S.size * sc, 38, 150);
  }
  function measure() {
    vw = root.innerWidth; vh = root.innerHeight;
    const cs = getComputedStyle(probe);
    ins = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }
  function layout() {
    measure();
    for (const id of IDS) {
      const c = ctl[id], visible = id === 'dir' || S.show[id];
      c.el.style.display = visible ? '' : 'none';
      const d = sizeOf(id), p = posOf(id);
      c.el.style.width = c.el.style.height = d + 'px';
      c.el.style.left = clamp(p[0] * vw - d / 2, ins.l, Math.max(ins.l, vw - ins.r - d)) + 'px';
      c.el.style.top = clamp(p[1] * vh - d / 2, ins.t, Math.max(ins.t, vh - ins.b - d)) + 'px';
      c.el.style.fontSize = Math.round(d * (id === 'dir' ? 0.2 : 0.34)) + 'px';
    }
    layer.style.setProperty('--ms-o', editing ? Math.max(S.opacity, 0.85) : S.opacity);
    layer.classList.toggle('stick', S.mode === 'stick');
    for (const e of [layer, ui]) e.classList.toggle('skin-ut', S.skin === 'ut');
  }
  function shouldShow() {
    if (S.enabled === 'off') return false;
    if (S.enabled === 'on') return true;
    const touch = (root.matchMedia && root.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in root || (navigator.maxTouchPoints || 0) > 0;
    return touch && !(S.hideWithGamepad && gamepads > 0);
  }
  function refresh() {
    const show = shouldShow() || editing;
    layer.style.display = show ? '' : 'none';
    if (!show) releaseAll();
    layout();
  }

  /* ------------------------------------------------------ construção DOM -- */
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

  function buildDir() {
    const el = h('div', 'ms-c ms-dir');
    el.dataset.id = 'dir';
    el.append(h('div', 'base'), h('div', 'arr up', '▲'), h('div', 'arr down', '▼'), h('div', 'arr left', '◀'), h('div', 'arr right', '▶'), h('div', 'knob'));
    ctl.dir = { el, pid: null };
    el.addEventListener('pointerdown', (e) => {
      if (editing) return startDrag(e, 'dir');
      e.preventDefault(); ctl.dir.pid = e.pointerId; el.setPointerCapture(e.pointerId); buzz(); moveDir(e);
    });
    el.addEventListener('pointermove', (e) => { if (!editing && ctl.dir.pid === e.pointerId) moveDir(e); });
    const end = (e) => { if (!editing && ctl.dir.pid === e.pointerId) { ctl.dir.pid = null; setDirs({ up: false, down: false, left: false, right: false }); el.querySelector('.knob').style.transform = 'translate(-50%,-50%)'; } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    return el;
  }
  function moveDir(e) {
    const r = ctl.dir.el.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    setDirs(dirFromVector(dx, dy, R, S.mode));
    const m = Math.hypot(dx, dy), lim = R * 0.55;
    if (m > lim) { dx *= lim / m; dy *= lim / m; }
    ctl.dir.el.querySelector('.knob').style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
  }
  function buildButton(b) {
    const el = h('div', 'ms-c ms-btn' + (b.small ? ' small' : ''), b.label);
    el.dataset.id = b.id;
    ctl[b.id] = { el, pid: null };
    el.addEventListener('pointerdown', (e) => {
      if (editing) return startDrag(e, b.id);
      e.preventDefault(); if (ctl[b.id].pid !== null) return;
      ctl[b.id].pid = e.pointerId; el.setPointerCapture(e.pointerId); el.classList.add('on'); buzz(); press(b.id);
    });
    const end = (e) => { if (!editing && ctl[b.id].pid === e.pointerId) { ctl[b.id].pid = null; el.classList.remove('on'); release(b.id); } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    return el;
  }

  /* ----------------------------------------------------------- editor -- */
  let drag = null;
  function select(id) {
    selected = id;
    for (const k of IDS) ctl[k].el.classList.toggle('sel', k === id);
    if (bar) { bar.querySelector('.name').textContent = id ? (id === 'dir' ? 'Direcional' : BUTTONS.find((b) => b.id === id).label) : 'toque em um controle'; const r = bar.querySelector('input'); r.disabled = !id; r.value = Math.round(((id && S.scale[id]) || 1) * 100); }
  }
  function startDrag(e, id) {
    e.preventDefault(); select(id);
    const el = ctl[id].el; el.setPointerCapture(e.pointerId);
    drag = { id, pid: e.pointerId };
  }
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    let x = clamp(e.clientX / vw, 0.02, 0.98), y = clamp(e.clientY / vh, 0.04, 0.96);
    S.pos[orient()][drag.id] = [S.leftHanded ? 1 - x : x, y];
    layout();
  }
  function endDrag(e) { if (drag && e.pointerId === drag.pid) { drag = null; save(); } }
  function setEditing(on) {
    releaseAll(); editing = on; select(null);
    layer.classList.toggle('editing', on);
    bar.style.display = on ? '' : 'none';
    panel.style.display = 'none';
    gear.style.display = on ? 'none' : '';
    refresh();
  }

  /* ------------------------------------------------- painel de ajustes -- */
  function row(label, ...kids) { const r = h('div', 'row'); r.append(h('label', '', label), ...kids); return r; }
  function checkbox(text, get, set) {
    const l = h('label', 'chk'), i = h('input'); i.type = 'checkbox';
    i.addEventListener('change', () => { set(i.checked); save(); refresh(); });
    l.append(i, document.createTextNode(' ' + text)); l._sync = () => { i.checked = get(); }; return l;
  }
  function slider(min, max, get, set, fmt) {
    const w = h('span', 'sl'), i = h('input'), v = h('b');
    i.type = 'range'; i.min = min; i.max = max; i.step = 1;
    i.addEventListener('input', () => { set(i.value / 100); v.textContent = fmt(i.value); layout(); });
    i.addEventListener('change', save);
    w.append(i, v); w._sync = () => { i.value = Math.round(get() * 100); v.textContent = fmt(i.value); }; return w;
  }
  function buildPanel() {
    panel = h('div', 'ms-panel'); panel.style.display = 'none';
    const card = h('div', 'card');
    const sync = [];
    const en = h('select');
    [['auto', 'Automático'], ['on', 'Sempre'], ['off', 'Nunca']].forEach(([v, t]) => { const o = h('option', '', t); o.value = v; en.append(o); });
    en.addEventListener('change', () => { S.enabled = en.value; save(); refresh(); }); en._sync = () => { en.value = S.enabled; };
    const seg = h('span', 'seg'), bd = h('button', '', 'D-pad'), bs = h('button', '', 'Analógico');
    bd.addEventListener('click', () => { S.mode = 'dpad'; save(); refresh(); seg._sync(); }); bs.addEventListener('click', () => { S.mode = 'stick'; save(); refresh(); seg._sync(); });
    seg.append(bd, bs); seg._sync = () => { bd.classList.toggle('act', S.mode === 'dpad'); bs.classList.toggle('act', S.mode === 'stick'); };
    const skinSeg = h('span', 'seg'), bu = h('button', '', 'Undertale'), bcl = h('button', '', 'Clássico');
    bu.addEventListener('click', () => { S.skin = 'ut'; save(); refresh(); skinSeg._sync(); }); bcl.addEventListener('click', () => { S.skin = 'classic'; save(); refresh(); skinSeg._sync(); });
    skinSeg.append(bu, bcl); skinSeg._sync = () => { bu.classList.toggle('act', S.skin === 'ut'); bcl.classList.toggle('act', S.skin === 'classic'); };
    const perf = root.MSPerf && root.MSPerf.panelSection ? root.MSPerf.panelSection() : null;
    const op = slider(15, 100, () => S.opacity, (v) => { S.opacity = clamp(v, 0.15, 1); }, (v) => v + '%');
    const sz = slider(60, 160, () => S.size, (v) => { S.size = clamp(v, 0.6, 1.6); }, (v) => v + '%');
    const cks = [checkbox('Vibrar ao tocar', () => S.haptics, (v) => { S.haptics = v; }),
      checkbox('Esconder se houver controle físico', () => S.hideWithGamepad, (v) => { S.hideWithGamepad = v; }),
      checkbox('Modo canhoto (espelhar)', () => S.leftHanded, (v) => { S.leftHanded = v; })];
    const fs = h('div', 'grp'); fs.append(h('div', 'cap', 'Botões visíveis'));
    const bks = BUTTONS.map((b) => checkbox(b.label, () => S.show[b.id], (v) => { S.show[b.id] = v; }));
    bks.forEach((c) => fs.append(c));
    const act = h('div', 'act-row');
    const bEdit = h('button', 'big', 'Editar posições e tamanhos'), bReset = h('button', '', 'Restaurar padrão'), bClose = h('button', 'big pri', 'Fechar');
    bEdit.addEventListener('click', () => setEditing(true));
    bReset.addEventListener('click', () => { if (root.confirm('Restaurar todos os ajustes dos controles de toque?')) { S = mergeSettings(null); save(); syncAll(); refresh(); } });
    bClose.addEventListener('click', closePanel);
    act.append(bEdit, bReset, bClose);
    const all = [en, seg, skinSeg, op, sz].concat(cks, bks, perf ? [perf] : []); sync.push(...all);
    function syncAll() { sync.forEach((x) => x._sync()); }
    card.append(h('h2', '', 'Controles de toque'), row('Mostrar', en), row('Direcional', seg), row('Estilo', skinSeg), row('Opacidade', op), row('Tamanho', sz), ...cks, fs, ...(perf ? [h('h2', 'sec', 'Desempenho'), perf] : []), act, h('p', 'note', 'Tudo é salvo neste aparelho. Paisagem e retrato têm posições separadas.'));
    panel.append(card); panel._sync = syncAll;
    panel.addEventListener('pointerdown', (e) => { if (e.target === panel) closePanel(); });
  }
  function openPanel() { releaseAll(); panel._sync(); panel.style.display = ''; }
  function closePanel() { panel.style.display = 'none'; }
  function buildBar() {
    bar = h('div', 'ms-bar'); bar.style.display = 'none';
    const name = h('span', 'name', ''), r = h('input'); r.type = 'range'; r.min = 50; r.max = 200; r.disabled = true;
    r.addEventListener('input', () => { if (selected) { S.scale[selected] = r.value / 100; layout(); } }); r.addEventListener('change', save);
    const done = h('button', 'pri', 'Concluir'), rst = h('button', '', 'Restaurar posições');
    done.addEventListener('click', () => setEditing(false));
    rst.addEventListener('click', () => { S.pos = { l: {}, p: {} }; S.scale = {}; save(); select(null); layout(); });
    bar.append(h('span', 'hint', 'Arraste para mover · '), name, h('span', '', ' tamanho '), r, rst, done);
  }

  /* ------------------------------------------- visual Undertale (pixel-art) -- */
  // Pixel-art em SVG de retângulos, sem suavização; desenhada para este port (não usa arquivos do jogo original).
  const pix = (rows, color) => {
    let d = '';
    rows.forEach((r, y) => { for (const k of r.matchAll(/X+/g)) d += 'M' + k.index + ' ' + y + 'h' + k[0].length + 'v1h-' + k[0].length + 'z'; });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + rows[0].length + ' ' + rows.length + '" shape-rendering="crispEdges"><path fill="' + color + '" d="' + d + '"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  };
  const HEART = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
  const ARROW = { up: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX'], down: ['XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], left: ['...X', '..XX', '.XXX', 'XXXX', '.XXX', '..XX', '...X'], right: ['X...', 'XX..', 'XXX.', 'XXXX', 'XXX.', 'XX..', 'X...'] };
  const PLUS = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" shape-rendering="crispEdges"><path d="M20 2h20v18h18v20H40v18H20V40H2V20h18z" fill="#000" stroke="#fff" stroke-width="3"/></svg>') + '")';
  const HR = pix(HEART, '#ff0000'), FONT = 'MSDetermination,"Courier New",monospace';
  const arrows = ['up', 'down', 'left', 'right'].map((d) => {
    const sz = d === 'up' || d === 'down' ? '62% auto' : 'auto 62%';
    return '.skin-ut .ms-dir .' + d + '{background-image:' + pix(ARROW[d], '#ffffff') + ';background-size:' + sz + '}' +
      '.skin-ut .ms-dir.on-' + d + ' .' + d + '{background-image:' + pix(ARROW[d], '#ffff00') + ';transform:none;text-shadow:none}';
  }).join('');
  const UT_CSS = `
  .skin-ut .ms-btn{border:3px solid var(--c,#fff);border-radius:0;background:#000;color:var(--c,#fff);box-shadow:0 0 0 3px #000;font-family:${FONT};font-weight:400;text-shadow:none;letter-spacing:.02em;line-height:1;image-rendering:pixelated}
  .skin-ut .ms-btn[data-id=z]{--c:#ff9a22}.skin-ut .ms-btn[data-id=c]{--c:#42fcff}
  .skin-ut .ms-btn.on{background:#000;border-color:#ff0;color:#ff0;transform:scale(.94)}
  .skin-ut .ms-btn.on:not(.small)::before{content:"";display:inline-block;width:.62em;height:.55em;margin-right:.3em;background:${HR} center/contain no-repeat}
  .skin-ut .ms-dir .base{border:0;border-radius:0;background:${PLUS} center/100% 100% no-repeat}
  .skin-ut .ms-dir .arr{font-size:0;color:transparent;text-shadow:none;background-position:center;background-repeat:no-repeat}
  ${arrows}
  .skin-ut.stick .ms-dir .base{background:#000;border:4px solid #fff;border-radius:50%}.skin-ut.stick .ms-dir .arr{opacity:.25}
  .skin-ut .ms-dir .knob{background:${HR} center/contain no-repeat;border:0;border-radius:0;width:30%;height:27%}
  .skin-ut .ms-gear{border:3px solid #fff;border-radius:0;background:#000;font-family:${FONT}}
  .skin-ut .ms-panel .card{background:#000;border:4px solid #fff;border-radius:0;box-shadow:none;font-family:${FONT};font-size:18px}
  .skin-ut .ms-panel h2{font-weight:400;font-size:24px}.skin-ut .ms-panel h2::before{content:"* "}
  .skin-ut .ms-panel select,.skin-ut .ms-panel button{background:#000;border:2px solid #fff;border-radius:0;color:#fff;font:inherit;font-size:17px}
  .skin-ut .ms-panel .seg button,.skin-ut .ms-panel .seg button:first-child,.skin-ut .ms-panel .seg button:last-child{border-radius:0}
  .skin-ut .ms-panel .act{background:#000;border-color:#ff0;color:#ff0}
  .skin-ut .ms-panel .seg .act::before{content:"";display:inline-block;width:.7em;height:.62em;margin-right:.35em;background:${HR} center/contain no-repeat}
  .skin-ut .ms-panel .pri{background:#000;border-color:#ff9a22;color:#ff9a22}
  .skin-ut .ms-panel input[type=checkbox]{accent-color:#f00}.skin-ut .ms-panel input[type=range]{accent-color:#ff0}.skin-ut .ms-panel .note{opacity:.75}
  .skin-ut .ms-bar{background:#000;border:3px solid #fff;border-radius:0;font-family:${FONT}}
  .skin-ut .ms-bar button{background:#000;border:2px solid #fff;border-radius:0;color:#fff;font:inherit;font-size:16px}.skin-ut .ms-bar .pri{border-color:#ff9a22;color:#ff9a22}`;

  const CSS = `
  @font-face{font-family:MSDetermination;src:url(assets/689cda6ac1fe62d63cc6e37e9dc0f9d0.woff) format("woff");font-display:swap}
  .ms-layer,.ms-ui{position:fixed;inset:0;pointer-events:none;z-index:2147483000;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font-family:system-ui,sans-serif}
  .ms-c{position:absolute;pointer-events:auto;touch-action:none;opacity:var(--ms-o,.6);-webkit-tap-highlight-color:transparent;color:#fff;box-sizing:border-box}
  .ms-btn{border-radius:50%;background:rgba(40,40,60,.78);border:2px solid rgba(255,255,255,.85);display:flex;align-items:center;justify-content:center;font-weight:700;text-shadow:0 1px 2px #000}
  .ms-btn.small{border-radius:28%}.ms-btn.on{background:rgba(255,230,90,.85);color:#000;transform:scale(.94)}
  .ms-dir .base{position:absolute;inset:0;border-radius:50%;background:rgba(30,30,50,.55);border:2px solid rgba(255,255,255,.7)}
  .ms-dir .arr{position:absolute;width:30%;height:30%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.85);font-size:.9em}
  .ms-dir .up{left:35%;top:4%}.ms-dir .down{left:35%;bottom:4%}.ms-dir .left{left:4%;top:35%}.ms-dir .right{right:4%;top:35%}
  .ms-dir.on-up .up,.ms-dir.on-down .down,.ms-dir.on-left .left,.ms-dir.on-right .right{color:#ffe65a;text-shadow:0 0 8px #ffe65a;transform:scale(1.25)}
  .ms-dir .knob{display:none;position:absolute;left:50%;top:50%;width:38%;height:38%;border-radius:50%;background:rgba(255,255,255,.85);border:2px solid rgba(0,0,0,.4);transform:translate(-50%,-50%)}
  .stick .ms-dir .knob{display:block}.stick .ms-dir .arr{opacity:.35}
  .editing .ms-c{outline:2px dashed #7cf;outline-offset:3px}.editing .ms-c.sel{outline:3px solid #ffe65a}
  .ms-gear{position:absolute;pointer-events:auto;top:calc(env(safe-area-inset-top,0px) + 8px);right:calc(env(safe-area-inset-right,0px) + 8px);width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(20,20,30,.55);color:#fff;font-size:22px;opacity:.4;touch-action:manipulation}
  .ms-panel{position:absolute;inset:0;pointer-events:auto;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
  .ms-panel .card{background:#1d1d2b;color:#fff;border-radius:14px;padding:16px 18px;width:min(92vw,520px);max-height:92vh;overflow:auto;touch-action:pan-y;box-shadow:0 8px 40px #000}
  .ms-panel h2{margin:0 0 10px;font-size:18px}.ms-panel .row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0}
  .ms-panel .row>label{flex:0 0 96px}.ms-panel select,.ms-panel button{font-size:15px;padding:9px 12px;border-radius:9px;border:1px solid #556;background:#2c2c40;color:#fff}
  .ms-panel .sl{display:flex;align-items:center;gap:8px;flex:1}.ms-panel .sl input{flex:1;min-width:0}.ms-panel .sl b{width:44px;text-align:right;font-weight:600}
  .ms-panel .seg button{border-radius:0}.ms-panel .seg button:first-child{border-radius:9px 0 0 9px}.ms-panel .seg button:last-child{border-radius:0 9px 9px 0}
  .ms-panel .act{background:#4a6cf7;border-color:#4a6cf7}.ms-panel .chk{display:inline-flex;align-items:center;margin:6px 14px 6px 0;font-size:15px}.ms-panel .chk input{width:20px;height:20px}
  .ms-panel .grp{margin:8px 0}.ms-panel .cap{font-size:13px;opacity:.7;margin-bottom:2px}.ms-panel .act-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .ms-panel .big{flex:1 1 150px;padding:12px}.ms-panel .pri{background:#4a6cf7;border-color:#4a6cf7}.ms-panel .note{font-size:12px;opacity:.6;margin:10px 0 0}
  .ms-bar{position:absolute;pointer-events:auto;top:calc(env(safe-area-inset-top,0px) + 6px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;background:rgba(20,20,35,.92);color:#fff;border-radius:12px;padding:8px 12px;font-size:14px;max-width:96vw}
  .ms-bar button{font-size:14px;padding:8px 12px;border-radius:9px;border:1px solid #556;background:#2c2c40;color:#fff}.ms-bar .pri{background:#4a6cf7;border-color:#4a6cf7}.ms-bar .name{font-weight:700;min-width:70px}`;

  /* ---------------------------------------------------------- iniciar -- */
  function start() {
    const st = h('style'); st.textContent = CSS + UT_CSS; document.head.append(st);
    probe = h('div'); probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;inset:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    layer = h('div', 'ms-layer'); ui = h('div', 'ms-ui');
    layer.append(buildDir()); BUTTONS.forEach((b) => layer.append(buildButton(b)));
    gear = h('button', 'ms-gear', '⚙'); gear.setAttribute('aria-label', 'Ajustes dos controles de toque');
    gear.addEventListener('click', openPanel);
    buildPanel(); buildBar();
    ui.append(gear, panel, bar); document.body.append(probe, layer, ui);
    for (const t of ['pointermove']) layer.addEventListener(t, onDragMove);
    layer.addEventListener('pointerup', endDrag); layer.addEventListener('pointercancel', endDrag);
    layer.addEventListener('contextmenu', (e) => e.preventDefault()); ui.addEventListener('contextmenu', (e) => e.preventDefault());
    const countPads = () => { try { gamepads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean).length; } catch (_) { gamepads = 0; } refresh(); };
    root.addEventListener('gamepadconnected', countPads); root.addEventListener('gamepaddisconnected', countPads);
    root.addEventListener('resize', () => { releaseAll(); layout(); }); root.addEventListener('orientationchange', () => setTimeout(() => { releaseAll(); layout(); }, 200));
    root.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') releaseAll(); });
    countPads();
    const hk = setInterval(() => { if (hookSteps() || ++hookTries > 3000) clearInterval(hk); }, 100); // espera o vm existir (até 5 min)
  }

  root.MSTouch = { open: () => panel && openPanel(), close: () => panel && closePanel(), release: () => releaseAll(), settings: () => S, steps: () => steps, stepHooked: () => stepHooked, _pure: pure };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
