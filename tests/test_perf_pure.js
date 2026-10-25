const { _pure: P } = require(require('path').join(__dirname, '../www/ms-android/perf.js'));
let ok = 0, bad = 0; const t = (n, c, x) => { if (c) { ok++; console.log('  ok   ' + n); } else { bad++; console.log('  FALHA ' + n, x === undefined ? '' : JSON.stringify(x)); } };
// ajustes
t('padrão: auto/off/fps desligado', JSON.stringify(P.mergeSettings(null)) === JSON.stringify({ v: 1, res: 'auto', auto: 'high', smooth: 'off', fps: false }));
t('lixo é ignorado', JSON.stringify(P.mergeSettings({ res: 'ultra', smooth: 9, fps: 'sim', auto: 'x' })) === JSON.stringify(P.DEFAULTS));
t('valores válidos são aceitos', (() => { const s = P.mergeSettings({ res: 'low', auto: 'mid', smooth: 'half', fps: true }); return s.res === 'low' && s.auto === 'mid' && s.smooth === 'half' && s.fps; })());
// resolução: canvas = css × dpr efetivo
const px = (real, css, lvl) => Math.round(css * P.dprFor(real, css, lvl));
t('Alta mantém o dpr real (549 css × 3 = 1647)', px(3, 549, 'high') === 1647);
t('Média limita a 960 px', px(3, 549, 'mid') === 960);
t('Baixa limita a 640 px (nativo do palco)', px(3, 549, 'low') === 640);
t('nunca passa do dpr real (tela pequena)', px(1, 500, 'mid') === 500 && px(1, 500, 'low') === 500);
t('css 0 não quebra', P.dprFor(2.5, 0, 'low') === 2.5);
// auto
t('nextLevel: high→mid→low→low', P.nextLevel('high') === 'mid' && P.nextLevel('mid') === 'low' && P.nextLevel('low') === 'low');
t('baixa com 8 s seguidos abaixo de 24', P.shouldDrop([20, 20, 20, 20, 20, 20, 20, 20]));
t('não baixa com só 7 s ruins', !P.shouldDrop([20, 20, 20, 20, 20, 20, 20]));
t('um segundo bom nos últimos 8 cancela', !P.shouldDrop([20, 20, 20, 30, 20, 20, 20, 20, 20]));
t('não baixa com 30 passos/s', !P.shouldDrop(Array(10).fill(30)));
t('hitch curto (3 s) não baixa', !P.shouldDrop([30, 30, 2, 2, 2, 30, 30, 30, 30, 30]));
// taxa da tela
const iv = (ms, n = 40, j = 0.4) => Array.from({ length: n }, (_, i) => ms + (i % 3 ? j : -j));
t('120 Hz', P.hzFromIntervals(iv(8.33)) === 120); t('90 Hz', P.hzFromIntervals(iv(11.1)) === 90);
t('60 Hz', P.hzFromIntervals(iv(16.7)) === 60); t('144 Hz', P.hzFromIntervals(iv(6.94)) === 144);
t('rajadas (1 ms) após travada não viram 240 Hz', P.hzFromIntervals([1, 1, 1, 1, 1, 16.7, 16.6, 16.8, 16.7, 16.7, 16.6, 16.7, 16.8]) === 60);
t('poucos dados → 0', P.hzFromIntervals([16.7, 16.7]) === 0);
t('tela lenta (10 fps) → ignora', P.hzFromIntervals(Array(20).fill(100)) === 0);
// opções de movimento
t('60 Hz: original + suave 60', JSON.stringify(P.smoothOptions(60)) === JSON.stringify([['off', 'Original · 30'], ['full', 'Suave · 60']]));
t('120 Hz: + metade (60)', P.smoothOptions(120).map((o) => o[1]).join('|') === 'Original · 30|Suave · 120|Suave · 60');
t('90 Hz: metade = 45', P.smoothOptions(90)[2][1] === 'Suave · 45');
// relatório
const rep = P.fmtReport({ t0: 1000, t: 5000, state: 'visible', dev: 'X', mem: 'M', log: [[1500, 'envio', 'Nightmare start', 1], [3000, 'erro', 'boom', 3]] }, 'T');
t('relatório traz tempos relativos e repetições', /0\.5s\s+envio\s+Nightmare start/.test(rep) && /2\.0s\s+erro\s+boom\s+\(×3\)/.test(rep) && /memória: M/.test(rep), rep);
console.log(`\n${ok} ok, ${bad} falha(s)`); process.exit(bad ? 1 : 0);
