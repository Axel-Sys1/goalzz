#!/usr/bin/env python3
"""Met à jour data/real-matches.json sans navigateur ni dépendance.

Les providers JavaScript de l'appli sont exécutés par le moteur JavaScript de macOS (jsc),
qui n'a pas d'accès réseau : ce script télécharge les URL qu'ils demandent, les met en
cache, et relance jusqu'à ce que tout soit disponible. Chaque résultat est lu deux fois,
à 25 secondes d'écart, avant d'être validé.

Les logos des équipes et les drapeaux sont aussi embarqués dans l'instantané (clé « logos » :
adresse d'origine → image en data URI), car la page publiée ne peut pas charger d'images
venant d'autres sites. Les logos déjà présents dans l'ancien instantané sont réutilisés.

Usage : python3 tools/update_snapshot.py            (tout mettre à jour)
        python3 tools/update_snapshot.py --logos    (seulement compléter les logos de l'instantané actuel)
Code de sortie 0 si l'instantané a été écrit, 1 sinon (l'ancien fichier est alors conservé).
"""
import concurrent.futures
import datetime
import http.client
import re
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc'
CLI = os.path.join(ROOT, 'js', 'tools', 'snapshot_cli.mjs')
SNAPSHOT = os.path.join(ROOT, 'data', 'real-matches.json')
MAX_PASSES = 40  # la boxe (TheSportsDB) découvre une page par passe, une passe coûte ~0,1 s
CONFIRM_WAIT_S = 25
# Délai minimal entre deux requêtes vers un même hôte limité (TheSportsDB : 30 requêtes/min).
HOST_DELAY_S = {'www.thesportsdb.com': 2.5}
_host_locks = {host: threading.Lock() for host in HOST_DELAY_S}


def fetch(url):
    host = urllib.parse.urlparse(url).hostname or ''
    req = urllib.request.Request(url)  # en-tête par défaut de Python (ESPN refuse les noms inconnus)
    for attempt in range(3):
        lock = _host_locks.get(host)
        try:
            if lock:
                with lock:
                    time.sleep(HOST_DELAY_S[host])
                    body = urllib.request.urlopen(req, timeout=25).read()
            else:
                body = urllib.request.urlopen(req, timeout=25).read()
            json.loads(body)  # vérifie que c'est bien du JSON
            return body.decode('utf-8')
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            return json.dumps({'__httpError': err.code})
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError, ValueError):
            if attempt < 2:
                time.sleep(2)
                continue
            return json.dumps({'__httpError': 0})  # erreur réseau : jamais interprétée comme une annulation
    return json.dumps({'__httpError': 0})


# La boxe lit les jours un par un et s'arrête au premier jour absent du cache :
# on télécharge d'avance les jours suivants pour éviter une passe par jour.
_DAY_RE = re.compile(r'(eventsday\.php\?d=)(\d{4}-\d{2}-\d{2})')


def with_following_days(urls, count=9):
    out = list(urls)
    for url in urls:
        m = _DAY_RE.search(url)
        if not m:
            continue
        day = datetime.date.fromisoformat(m.group(2))
        for i in range(1, count):
            nxt = url[:m.start(2)] + (day + datetime.timedelta(days=i)).isoformat() + url[m.end(2):]
            if nxt not in out:
                out.append(nxt)
    return out


def fetch_all(work, ns, urls):
    urls = with_following_days(urls)
    folder = os.path.join(work, ns)
    os.makedirs(folder, exist_ok=True)
    index_path = os.path.join(folder, 'index.json')
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    todo = [u for u in urls if u not in index]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        bodies = list(pool.map(fetch, todo))
    for url, body in zip(todo, bodies):
        name = f'{len(index)}.json'
        with open(os.path.join(folder, name), 'w', encoding='utf-8') as f:
            f.write(body)
        index[url] = name
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f)
    return len(todo)


LOGO_PX = 64
LOGO_MAX_BYTES = 40_000


def logo_fetch_url(url):
    """Version réduite d'un logo : 64 px chez ESPN (redimensionneur), « tiny » chez TheSportsDB."""
    parsed = urllib.parse.urlparse(url)
    if (parsed.hostname or '').endswith('thesportsdb.com'):
        return url + '/tiny'
    if parsed.hostname != 'a.espncdn.com':
        return url
    if parsed.path.startswith('/combiner/i'):
        q = dict(urllib.parse.parse_qsl(parsed.query))
        q.update(w=str(LOGO_PX), h=str(LOGO_PX))
        return f'https://a.espncdn.com/combiner/i?{urllib.parse.urlencode(q)}'
    return f'https://a.espncdn.com/combiner/i?img={urllib.parse.quote(parsed.path)}&w={LOGO_PX}&h={LOGO_PX}'


def fetch_logo(url):
    try:
        res = urllib.request.urlopen(urllib.request.Request(logo_fetch_url(url)), timeout=20)
        kind = (res.headers.get('Content-Type') or '').split(';')[0].strip()
        body = res.read(LOGO_MAX_BYTES + 1)
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError, ValueError):
        return None
    if not kind.startswith('image/') or len(body) > LOGO_MAX_BYTES:
        return None
    return f'data:{kind};base64,{base64.b64encode(body).decode()}'


def embed_logos(snapshot, previous_logos):
    """Ajoute snapshot['logos'] pour chaque logo utilisé. Un échec ne bloque jamais la mise à jour."""
    wanted = set()
    for m in snapshot.get('matches', []):
        for t in (m.get('home') or {}, m.get('away') or {}):
            if t.get('logo'):
                wanted.add(t['logo'])
        if m.get('competitionLogo'):
            wanted.add(m['competitionLogo'])
    logos = {u: previous_logos[u] for u in wanted if u in previous_logos}
    todo = sorted(wanted - logos.keys())
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for u, data in zip(todo, pool.map(fetch_logo, todo)):
            if data:
                logos[u] = data
    snapshot['logos'] = logos
    return len(logos), len(wanted)


def previous_logos():
    try:
        return json.load(open(SNAPSHOT, encoding='utf-8')).get('logos') or {}
    except (OSError, ValueError):
        return {}


def write_snapshot(snapshot):
    os.makedirs(os.path.dirname(SNAPSHOT), exist_ok=True)
    tmp = SNAPSHOT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(snapshot, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, SNAPSHOT)


def logos_only():
    snapshot = json.load(open(SNAPSHOT, encoding='utf-8'))
    got, wanted = embed_logos(snapshot, previous_logos())
    write_snapshot(snapshot)
    print(f'Logos : {got} / {wanted} embarqués.')
    return 0


def run_cli(work, now, out):
    previous = SNAPSHOT if os.path.exists(SNAPSHOT) else os.path.join(work, 'none.json')
    proc = subprocess.run([JSC, '-m', CLI, '--', work, str(now), previous, out],
                          capture_output=True, text=True, timeout=900)
    lines = [l for l in proc.stdout.splitlines() if l.startswith('{')]
    if proc.returncode != 0 or not lines:
        raise RuntimeError(f'jsc a échoué ({proc.returncode}) : {proc.stderr.strip() or proc.stdout.strip()}')
    return json.loads(lines[-1])


def main():
    now = int(time.time() * 1000)
    work = tempfile.mkdtemp(prefix='goalz-snapshot-')
    out = os.path.join(work, 'snapshot.json')
    waited = False
    try:
        for _ in range(MAX_PASSES):
            res = run_cli(work, now, out)
            if res['complete']:
                break
            missing_a, missing_b = res['missing']['a'], res['missing']['b']
            if missing_a:
                fetch_all(work, 'a', missing_a)
                continue
            if not waited:
                time.sleep(CONFIRM_WAIT_S)
                waited = True
            fetch_all(work, 'b', missing_b)
        else:
            print('Échec : les données n\'ont pas pu être rassemblées.', file=sys.stderr)
            return 1

        report = res['report']
        snapshot = json.load(open(out, encoding='utf-8'))
        if not snapshot.get('matches') or report.get('upcoming', 0) == 0:
            print(f'Échec : instantané vide, ancien fichier conservé. Erreurs : {report.get("errors")}', file=sys.stderr)
            return 1
        got, wanted = embed_logos(snapshot, previous_logos())
        write_snapshot(snapshot)
        settled = sum(p.get('settled', 0) for p in report['providers'].values())
        voided = sum(p.get('voided', 0) for p in report['providers'].values())
        print(f"Instantané écrit : {report['total']} matchs, {report['upcoming']} à venir, "
              f"{settled} résultats validés, {voided} remboursés."
              + (f" Logos : {got} / {wanted}." if got < wanted else '')
              + (f" Avertissements : {'; '.join(report['errors'])}" if report['errors'] else ''))
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(logos_only() if '--logos' in sys.argv[1:] else main())
