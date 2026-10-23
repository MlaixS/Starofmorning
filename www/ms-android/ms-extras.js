/* Morningstar (port Android) — ciclo de vida e desempenho. Não altera a lógica do jogo. */
(function (root) {
  'use strict';
  // 1) Pede ao navegador a GPU de alto desempenho para o WebGL (atributos do jogo têm prioridade).
  try {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (typeof type === 'string' && /^(experimental-)?webgl2?$/.test(type)) attrs = Object.assign({ powerPreference: 'high-performance' }, attrs || {});
      return orig.call(this, type, attrs);
    };
  } catch (_) { /* opcional */ }

  // 2) Mantém a tela acesa enquanto o jogo está em primeiro plano.
  let lock = null;
  async function keepAwake() {
    try {
      if (navigator.wakeLock && document.visibilityState === 'visible') {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      }
    } catch (_) { /* sem permissão: ignora */ }
  }
  keepAwake();

  // 3) Em segundo plano: pausa o jogo e o som; ao voltar, retoma.
  let wasRunning = false;
  const runtime = () => root.vm && root.vm.runtime;
  const audioCtx = () => { const r = runtime(); return r && r.audioEngine && r.audioEngine.audioContext; };
  document.addEventListener('visibilitychange', () => {
    const rt = runtime(), ac = audioCtx();
    if (document.visibilityState === 'hidden') {
      if (rt && rt.frameLoop && rt.frameLoop.running) { wasRunning = true; rt.frameLoop.stop(); }
      if (ac && ac.state === 'running') ac.suspend().catch(() => {});
    } else {
      if (rt && wasRunning) { wasRunning = false; if (!rt.frameLoop.running) rt.frameLoop.start(); }
      if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
      keepAwake();
    }
  });

  // 4) Política de autoplay: destrava o áudio no primeiro toque/tecla.
  const unlock = () => { const ac = audioCtx(); if (ac && ac.state === 'suspended') ac.resume().catch(() => {}); };
  ['pointerdown', 'touchend', 'keydown'].forEach((t) => document.addEventListener(t, unlock, { capture: true, passive: true }));
})(window);
