#!/usr/bin/env python3
"""Serveur de développement de Goalz.

- Sert les fichiers de l'appli (sans cache, pour voir les modifications tout de suite).
- POST /__snapshot (depuis cette machine uniquement) enregistre data/real-matches.json,
  l'instantané des vrais matchs utilisé par la version publiée en ligne.

Usage : python3 serve.py [port]   (5173 par défaut)
"""
import http.server
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(ROOT, 'data', 'real-matches.json')
MAX_BYTES = 15_000_000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/__snapshot':
            self.send_error(404)
            return
        if self.client_address[0] not in ('127.0.0.1', '::1'):
            self.send_error(403, 'Réservé à cette machine')
            return
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= MAX_BYTES:
            self.send_error(413)
            return
        try:
            data = json.loads(self.rfile.read(length))
            if not isinstance(data.get('matches'), list):
                raise ValueError('matches manquant')
        except (ValueError, json.JSONDecodeError) as err:
            self.send_error(400, str(err))
            return
        os.makedirs(os.path.dirname(SNAPSHOT), exist_ok=True)
        tmp = SNAPSHOT + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, SNAPSHOT)
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    print(f'Goalz sur http://localhost:{port}')
    http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
