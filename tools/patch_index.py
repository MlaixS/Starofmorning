#!/usr/bin/env python3
"""Aplica ao index.html ORIGINAL do jogo as 5 mudanças do port. Idempotente e estrita:
falha se algum ponto de ancoragem não existir exatamente uma vez."""
import sys, re
p = sys.argv[1]
h = open(p, encoding='utf-8').read()
if 'ms-android/vfs-shim.js' in h: print('já aplicado'); sys.exit(0)
def once(old, new):
    global h
    assert h.count(old) == 1, f'âncora ausente/duplicada ({h.count(old)}x): {old[:60]}'
    h = h.replace(old, new)
# 1) shim + extras + desempenho ANTES do runtime (script.js); 2) controles de toque depois
once('<script src="script.js"', '<script src="ms-android/vfs-shim.js"></script>\n<script src="ms-android/ms-extras.js"></script>\n<script src="ms-android/perf.js"></script>\n<script src="script.js"')
once('</body>', '<script src="ms-android/touch-controls.js"></script>\n</body>')
# 3) só inicia o jogo depois que o disco virtual estiver pronto (manifesto + saves carregados)
once('run().catch(handleError);', '(window.MSVFS ? window.MSVFS.ready : Promise.resolve()).then(run).catch(handleError);')
# 5) app instalável (Chrome > "Adicionar à tela inicial": tela cheia, paisagem)
once('</head>', '<link rel="manifest" href="ms-android/app.webmanifest">\n<meta name="theme-color" content="#000000">\n</head>')
# 4) tela cheia sob o entalhe (notch)
m = re.search(r'<meta name="viewport" content="([^"]*)"', h); assert m, 'viewport ausente'
if 'viewport-fit' not in m.group(1): h = h.replace(m.group(0), m.group(0)[:-1] + ', viewport-fit=cover"', 1)
open(p, 'w', encoding='utf-8').write(h); print('patch aplicado')
