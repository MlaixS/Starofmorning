import sys, time, json
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
WAIT = int(sys.argv[2]) if len(sys.argv) > 2 else 60
logs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 915, 'height': 412}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:220]}'))
    pg.on('pageerror', lambda e: logs.append(f'[PAGEERROR] {str(e)[:300]}'))
    pg.on('requestfailed', lambda r: logs.append(f'[REQFAIL] {r.url[-80:]}'))
    pg.goto(URL, wait_until='load')
    t0 = time.time(); last = ''
    while time.time() - t0 < WAIT:
        time.sleep(5)
        st = pg.evaluate("({ready: !!(window.MSVFS), launch: (document.querySelector('#launch,.launch,[id*=launch]')||{}).hidden, canvas: document.querySelectorAll('canvas').length})")
        cur = json.dumps(st)
        if cur != last: print(f'{int(time.time()-t0)}s', cur); last = cur
    pg.screenshot(path='/tmp/shot1.png')
    print('--- logs (últimos 25) ---'); print('\n'.join(logs[-25:]))
    print('total de logs:', len(logs), '| erros:', sum(1 for l in logs if l.startswith(('[error]', '[PAGEERROR]', '[REQFAIL]'))))
    b.close()
