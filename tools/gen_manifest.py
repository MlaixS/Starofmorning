#!/usr/bin/env python3
"""Gera www/ms-android/manifest.json: lista dos arquivos que o disco virtual enxerga.
  /app/data/...                    <- www/data/...
  /app/resources/app.asar/...      <- demais arquivos de www/ (index.html, part1.zip, assets/...)
Uso: python3 tools/gen_manifest.py [pasta_www]"""
import json, os, sys
www = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'www'))
files = []
for dp, dn, fn in os.walk(www):
    dn.sort()
    for f in sorted(fn):
        full = os.path.join(dp, f); rel = os.path.relpath(full, www).replace(os.sep, '/')
        if rel.startswith('ms-android/'): continue
        vp = '/app/' + rel if rel.startswith('data/') else '/app/resources/app.asar/' + rel
        files.append([vp, rel, os.path.getsize(full)])
out = os.path.join(www, 'ms-android', 'manifest.json')
json.dump({'v': 1, 'files': files}, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(f'manifest: {len(files)} arquivos -> {out}')
