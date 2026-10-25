# Testa desempenho, memória, diagnóstico e a trava de toque no Chromium (celular emulado, DPR 3).
# Uso: python3 tests/test_perf.py   (leva alguns minutos: o jogo precisa carregar)
import http.server, threading, socketserver, os, time, functools
from playwright.sync_api import sync_playwright
WWW = os.path.join(os.path.dirname(__file__), '..', 'www')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=WWW)); srv.daemon_threads = True
port = srv.server_address[1]; URL = f'http://127.0.0.1:{port}/index.html'
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    if cond: ok += 1; print('  ok   ' + name, flush=True)
    else: bad += 1; print('  FALHA ' + name, extra, flush=True)

WAV = """(sec) => { const rate = 22050, n = rate * sec, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i % 50 < 25 ? 1000 : -1000, true); return new Uint8Array(buf); }"""
LEAK = """async ([fixOn, pre]) => {
  const vm = window.vm, rt = vm.runtime, st = rt.storage, mk = %s;
  const proto = Object.getPrototypeOf(rt.targets[0]), patched = proto.deleteSound;
  if (!fixOn) proto.deleteSound = proto._msDeleteSound;   // usa o deleteSound ORIGINAL do runtime (controle)
  try {
    const target = rt.targets.find((t) => t.isOriginal && !t.isStage) || rt.targets[0];
    const bank = target.sprite.soundBank, n = () => Object.keys(bank.soundPlayers).length;
    const add = async (name, sec) => { const asset = st.createAsset(st.AssetType.Sound, st.DataFormat.WAV, mk(sec), null, true);
      await vm.addSound({ name, asset, md5: asset.assetId + '.wav', dataFormat: 'wav', rate: 22050, sampleCount: 22050 * sec, assetId: asset.assetId }, target.id);
      return target.sprite.sounds.find((s) => s.name === name); };
    const del = (name) => target.deleteSound(target.sprite.sounds.findIndex((s) => s.name === name));
    const out = { base: n() };
    for (const [nm, sec] of [['t1', 4], ['t2', 5], ['t3', 6]]) await add(pre + nm, sec);
    out.afterAdd = n(); del(pre + 't1'); del(pre + 't2'); del(pre + 't3'); out.afterDelete = n();
    if (!fixOn) return out;
    const s4 = await add(pre + 't4', 30), id4 = s4.soundId, p = bank.soundPlayers[id4];
    bank.playSound(target, id4); await new Promise((r) => setTimeout(r, 400));
    out.playing = !!p.isPlaying; del(pre + 't4'); out.keptWhilePlaying = !!bank.soundPlayers[id4];
    bank.stop(target, id4); await new Promise((r) => setTimeout(r, 2300)); out.afterStop = n();
    return out;
  } finally { if (!fixOn) proto.deleteSound = patched; } }""" % WAV

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 915, 'height': 412}, device_scale_factor=3, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); cdp = ctx.new_cdp_session(pg); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.goto(URL); st = None; t0 = time.time()
    while time.time() - t0 < 240:
        st = pg.evaluate("window.MSPerf ? MSPerf.state() : null")
        if st and st['hooked'] and pg.evaluate("window.MSTouch && MSTouch.stepHooked()"): break
        time.sleep(1)
    print(f'jogo carregado em {int(time.time() - t0)} s', flush=True)
    check('MSPerf conectado ao jogo (renderer + runtime)', st and st['hooked'] and st['canvas'], st)
    time.sleep(3)
    cv = lambda: pg.evaluate("MSPerf.state().canvas")

    print('resolução')
    check('padrão: Auto começa em Alta (canvas usa o dpr real, > 1200 px)', cv()[0] > 1200, cv())
    pg.evaluate("MSTouch.open()"); time.sleep(.3)
    check('painel tem a seção Desempenho', pg.evaluate("!!document.querySelector('.ms-panel .perf')"))
    pg.click('.ms-panel .perf .seg button:text-is("Baixa")'); time.sleep(.6)
    check('Baixa pelo painel: canvas 640×480', abs(cv()[0] - 640) <= 2 and abs(cv()[1] - 480) <= 2, cv())
    pg.screenshot(path='/tmp/perf_panel.png')
    pg.evaluate("MSPerf.set({res: 'mid'})"); time.sleep(.5)
    check('Média: canvas 960×720', abs(cv()[0] - 960) <= 2 and abs(cv()[1] - 720) <= 2, cv())
    pg.evaluate("MSPerf.set({res: 'high'})"); time.sleep(.5)
    check('Alta: volta ao dpr real', cv()[0] > 1200, cv())
    pg.evaluate("MSPerf.set({res: 'low'})"); time.sleep(.4)
    pg.evaluate("MSPerf.set({res: 'auto'})"); time.sleep(.4)
    check('Auto com nível guardado (alta): canvas grande', cv()[0] > 1200, cv())
    check('tela detectada em Hz e opções de movimento', pg.evaluate("document.querySelectorAll('.ms-panel .perf select option').length") >= 2)
    pg.click('.ms-panel .seg button:text-is("Clássico")'); time.sleep(.2)
    check('estilo Clássico remove o visual Undertale', not pg.evaluate("document.querySelector('.ms-layer').classList.contains('skin-ut')"))
    pg.click('.ms-panel .seg button:text-is("Undertale")'); time.sleep(.2)
    check('estilo Undertale volta', pg.evaluate("document.querySelector('.ms-layer').classList.contains('skin-ut')"))
    pg.evaluate("MSTouch.close()")

    print('movimento suave')
    fl = "vm.runtime.frameLoop"
    pg.evaluate("MSPerf.set({smooth: 'full'})"); time.sleep(.5)
    check('Suave: interpolação ligada', pg.evaluate(f"{fl}.interpolation") is True, pg.evaluate(f"{fl}.interpolation"))
    pg.evaluate("MSPerf.set({smooth: 'half'})"); time.sleep(.5)
    check('Metade: interpolação ligada com callback limitado', pg.evaluate(f"{fl}.interpolation === true && {fl}.interpolationCallback !== {fl}._msInterp"))
    pg.evaluate("MSPerf.set({smooth: 'off'})"); time.sleep(.5)
    check('Original: interpolação desligada e callback restaurado', pg.evaluate(f"{fl}.interpolation === false && {fl}.interpolationCallback === {fl}._msInterp"))
    check('jogo continua rodando (passos avançam)', (lambda a: (time.sleep(1.5), pg.evaluate("MSPerf.state().steps") > a)[1])(pg.evaluate("MSPerf.state().steps")))

    print('memória de áudio')
    r0 = pg.evaluate(LEAK, [False, 'ctl_']); print('   controle (runtime original):', r0, flush=True)
    check('CONTROLE: sem a correção, o runtime original vaza (3 sons apagados seguem no banco)', r0['afterDelete'] == r0['afterAdd'] == r0['base'] + 3, r0)
    r = pg.evaluate(LEAK, [True, 'fix_']); print('   com a correção:', r, flush=True)
    check('sons carregados entram no banco', r['afterAdd'] == r['base'] + 3, r)
    check('COM A CORREÇÃO: sons apagados saem do banco', r['afterDelete'] == r['base'], r)
    check('som ainda tocando é mantido até parar', r['playing'] and r['keptWhilePlaying'], r)
    check('depois que para, é solto', r['afterStop'] == r['base'], r)

    print('diagnóstico')
    pg.evaluate("vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'TESTE_BROADCAST'})")
    rep = pg.evaluate("MSPerf.report()")
    check('relatório registra as transmissões do jogo', 'TESTE_BROADCAST' in rep and 'SESSÃO ATUAL' in rep, rep[:300])
    check('relatório registra sons carregados/apagados', '+ fix_t1' in rep and '− fix_t1' in rep)
    pg.evaluate("MSPerf.set({fps: true})"); time.sleep(2.6)
    txt = pg.evaluate("(document.querySelector('.ms-fps')||{}).textContent")
    check('contador de FPS aparece com passos, fps e resolução', txt and 'passos' in txt and 'fps' in txt and '×' in txt, txt)
    pg.evaluate("MSPerf.set({fps: false})")

    print('toque imediato (trava até o jogo enxergar)')
    pg.evaluate("window.__ev = []; window.__st = 0; vm.runtime.on('BEFORE_EXECUTE', () => window.__st++); ['keydown', 'keyup'].forEach((t) => document.addEventListener(t, (e) => { if (e.key === 'z') window.__ev.push([t, window.__st]); }))")
    zr = pg.evaluate("(()=>{const r=document.querySelector('.ms-btn[data-id=z]').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
    tch = lambda t, pts: cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
    pg.evaluate("setTimeout(() => { const t = performance.now(); while (performance.now() - t < 700); }, 30)")  # engasgo de 700 ms
    time.sleep(.12); tch('touchStart', [tuple(zr)]); time.sleep(.02); tch('touchEnd', [])
    ev = []; t0 = time.time()
    while time.time() - t0 < 10:
        time.sleep(.2); ev = pg.evaluate("window.__ev")
        if any(e[0] == 'keyup' for e in ev): break
    print('   eventos (tipo, passos do jogo):', ev, flush=True)
    check('toque curto durante engasgo: o jogo executa >= 2 passos com a tecla pressionada', len(ev) == 2 and ev[0][0] == 'keydown' and ev[1][0] == 'keyup' and ev[1][1] - ev[0][1] >= 2, ev)

    print('modo Auto (só confere se o ambiente for lento)')
    pg.evaluate("MSPerf._cfg.warmup = 0; MSPerf.set({res: 'auto', auto: 'high'})")
    slow = False; t0 = time.time()
    while time.time() - t0 < 30:
        time.sleep(1)
        if pg.evaluate("MSPerf.settings().auto") != 'high': break
    st = pg.evaluate("MSPerf.state()"); slow = st['tps'] < 24
    if slow: check('jogo lento → Auto baixou a resolução sozinho', pg.evaluate("MSPerf.settings().auto") != 'high', st)
    else: print(f'  (ambiente rápido: {st["tps"]} passos/s; Auto não precisa agir)')

    print('queda do app (renderer morto)')
    time.sleep(5)  # deixa o relatório ser salvo
    try: pg.goto('chrome://crash', timeout=10000)
    except Exception as e: print('   renderer derrubado:', str(e).split(chr(10))[0][:70], flush=True)
    time.sleep(1)
    pg2 = ctx.new_page(); pg2.goto(URL)
    try: pg2.wait_for_function("window.MSPerf && MSPerf.state().crashed", timeout=30000); detected = True
    except Exception: detected = False
    time.sleep(1)
    check('após o crash, a próxima abertura detecta o fechamento inesperado', detected)
    check('aviso na tela explica o que fazer', pg2.evaluate("(document.querySelector('.ms-toast')||{}).textContent||''").find('fechou sozinho') >= 0)
    rep2 = pg2.evaluate("MSPerf.report()")
    check('relatório guarda a sessão que caiu (com o que o jogo fazia)', 'FALHA ANTERIOR' in rep2 and 'início' in rep2 and 'TESTE_BROADCAST' in rep2, rep2[:400])
    time.sleep(5); pg2.reload(); pg2.wait_for_function("window.MSPerf", timeout=60000); time.sleep(1.5)
    check('saída normal (recarregar) não é tratada como falha', not pg2.evaluate("MSPerf.state().crashed"))
    check('"Apagar" limpa a falha guardada', (pg2.evaluate("MSTouch.open()"), pg2.click('.ms-panel .perf button:text-is("Apagar")'), time.sleep(.3), 'FALHA ANTERIOR' not in pg2.evaluate("MSPerf.report()"))[3])
    print('desempenho persiste ao reiniciar o app')
    pg2.evaluate("MSPerf.set({res: 'low', smooth: 'full'})"); time.sleep(.5); pg2.reload(); t0 = time.time()
    while time.time() - t0 < 120:
        if pg2.evaluate("!!(window.MSPerf && MSPerf.state().hooked && MSPerf.state().canvas)"): break
        time.sleep(1)
    time.sleep(5); c = pg2.evaluate("MSPerf.state().canvas")
    check('após reiniciar: resolução Baixa continua (640×480)', c and abs(c[0] - 640) <= 2 and abs(c[1] - 480) <= 2, c)
    check('após reiniciar: movimento Suave continua (o index.html desliga a interpolação no boot)', pg2.evaluate("vm.runtime.frameLoop.interpolation") is True)
    check('sem erros de JavaScript na página', not errs, errs[:3])
    b.close()
print(f'\n{ok} ok, {bad} falha(s)'); raise SystemExit(1 if bad else 0)
