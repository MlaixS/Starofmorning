# Testa os controles de toque no Chromium (toques reais via CDP). Uso: python3 tests/test_touch_ui.py
import http.server, threading, socketserver, os, time, json, functools
from playwright.sync_api import sync_playwright
WWW = os.path.join(os.path.dirname(__file__), '..', 'www')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=WWW)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    if cond: ok += 1; print('  ok   ' + name)
    else: bad += 1; print('  FALHA ' + name, extra)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 915, 'height': 412}, has_touch=True, is_mobile=True); pg = ctx.new_page(); cdp = ctx.new_cdp_session(pg)
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_selector('.ms-layer', timeout=60000); time.sleep(6)
    pg.evaluate("window.__k=[];['keydown','keyup'].forEach(t=>document.addEventListener(t,e=>window.__k.push([t,e.key,Math.round(performance.now())])))")
    rect = lambda sel: pg.evaluate(f"(()=>{{const r=document.querySelector('{sel}').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,r.width/2]}})()")
    keys = lambda: pg.evaluate("window.__k.splice(0)")
    def touch(t, pts): cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
    print('direcional')
    cx, cy, R = rect('.ms-dir')
    touch('touchStart', [(cx + R * .7, cy)]); time.sleep(.15); k = keys()
    check('D-pad: direita -> só ArrowRight', [x[1] for x in k if x[0] == 'keydown'] == ['ArrowRight'], k)
    touch('touchMove', [(cx + R * .6, cy - R * .6)]); time.sleep(.15); k = keys()
    check('diagonal: ArrowUp pressionada e ArrowRight continua', [x[1] for x in k] == ['keydown'.replace('keydown', 'ArrowUp')] or [x[1] for x in k] == ['ArrowUp'], k)
    touch('touchEnd', []); time.sleep(.2); k = keys()
    check('soltar: todas as setas soltas', sorted(x[1] for x in k if x[0] == 'keyup') == ['ArrowRight', 'ArrowUp'], k)
    print('botões')
    zx, zy, _ = rect('.ms-btn[data-id=z]'); xx, xy, _ = rect('.ms-btn[data-id=x]')
    touch('touchStart', [(zx, zy), (xx, xy)]); time.sleep(.2); k = keys()
    check('multitoque: Z e X juntos', sorted(x[1] for x in k if x[0] == 'keydown') == ['x', 'z'], k)
    touch('touchEnd', []); time.sleep(.2); keys()
    touch('touchStart', [(zx, zy)]); time.sleep(.01); touch('touchEnd', []); time.sleep(.3); k = keys()
    dn = [x for x in k if x[0] == 'keydown']; up = [x for x in k if x[0] == 'keyup']
    check('toque de 10 ms mantém a tecla >= 60 ms', dn and up and up[0][2] - dn[0][2] >= 60, k)
    print('painel e editor')
    pg.click('.ms-gear'); time.sleep(.3); check('painel abre', pg.evaluate("getComputedStyle(document.querySelector('.ms-panel')).display") != 'none')
    pg.screenshot(path='/tmp/ui_panel.png')
    pg.click('.ms-seg button:nth-child(2), .seg button:nth-child(2)'); time.sleep(.2)
    check('modo analógico ligado', pg.evaluate("document.querySelector('.ms-layer').classList.contains('stick')"))
    pg.evaluate("(()=>{const i=document.querySelector('.ms-panel .sl input');i.value=30;i.dispatchEvent(new Event('input'));i.dispatchEvent(new Event('change'))})()")
    check('opacidade 30% aplicada', abs(float(pg.evaluate("getComputedStyle(document.querySelector('.ms-layer')).getPropertyValue('--ms-o')")) - .3) < .01)
    pg.click('text=Editar posições e tamanhos'); time.sleep(.3)
    check('barra do editor visível', pg.evaluate("getComputedStyle(document.querySelector('.ms-bar')).display") != 'none')
    zx, zy, _ = rect('.ms-btn[data-id=z]'); pg.mouse.move(zx, zy); pg.mouse.down(); pg.mouse.move(600, 200, steps=6); pg.mouse.up(); time.sleep(.2)
    pos = pg.evaluate("JSON.parse(localStorage.getItem('morningstar-touch-v1')).pos.l.z")
    check('arrastar Z salva a nova posição', pos and abs(pos[0] - 600 / 915) < .02 and abs(pos[1] - 200 / 412) < .02, pos)
    check('no editor, tocar não envia teclas', not [x for x in keys() if x[1] == 'z'])
    pg.screenshot(path='/tmp/ui_edit.png'); pg.click('.ms-bar .pri'); time.sleep(.2)
    print('persistência')
    pg.reload(); pg.wait_for_selector('.ms-layer', timeout=60000); time.sleep(3)
    s = pg.evaluate("JSON.parse(localStorage.getItem('morningstar-touch-v1'))")
    check('após recarregar: modo, opacidade e posição mantidos', s['mode'] == 'stick' and abs(s['opacity'] - .3) < .01 and s['pos']['l']['z'][0] > .6, s)
    check('após recarregar: analógico segue ativo', pg.evaluate("document.querySelector('.ms-layer').classList.contains('stick')"))
    b.close()
print(f'\n{ok} ok, {bad} falha(s)'); raise SystemExit(1 if bad else 0)
