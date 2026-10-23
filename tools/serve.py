#!/usr/bin/env python3
"""Servidor local para rodar o port no celular (Termux) ou no PC, sem APK.
  python3 tools/serve.py        -> abra http://localhost:8080 no Chrome do Android
Depois, no Chrome: menu ⋮ > "Adicionar à tela inicial" / "Instalar app" (tela cheia, paisagem)."""
import http.server, os, socketserver, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.ogg': 'audio/ogg', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.zip': 'application/zip'}
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True; allow_reuse_address = True
print(f'Morningstar em http://localhost:{PORT}  (Ctrl+C para parar)'); S(('127.0.0.1', PORT), H).serve_forever()
