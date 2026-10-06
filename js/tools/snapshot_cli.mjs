// Exécuté par tools/update_snapshot.py avec le moteur JavaScript de macOS (jsc), sans navigateur.
// jsc n'a pas d'accès réseau : chaque URL demandée par les providers est lue dans un cache
// rempli par le script Python. Une URL absente est notée "manquante" ; Python la télécharge
// puis relance ce script, jusqu'à ce que plus rien ne manque.
// Deux caches : "a" pour la liste et la 1re lecture des résultats, "b" pour la 2e lecture
// (téléchargée au moins 20 s plus tard, pour confirmer chaque résultat).
//
// Usage : jsc -m snapshot_cli.mjs -- <dossierCache> <maintenantMs> <instantanéPrécédent> <fichierSortie>
import { createLiveProviders } from '../providers/index.js';
import { buildSnapshot } from './snapshot.js';

globalThis.console ||= { log: print, info: print, warn: () => {}, error: () => {} };

const [cacheDir, nowArg, previousPath, outPath] = globalThis.arguments;
const now = Number(nowArg);

function readJson(path, fallback) {
  try { return JSON.parse(readFile(path)); } catch { return fallback; }
}

const missing = { a: new Set(), b: new Set() };

function cachedGetJson(ns) {
  const index = readJson(`${cacheDir}/${ns}/index.json`, {});
  return async (url) => {
    const file = index[url];
    if (!file) {
      missing[ns].add(url);
      throw new Error(`pas encore en cache : ${url}`);
    }
    const data = readJson(`${cacheDir}/${ns}/${file}`, null);
    if (data === null) throw new Error(`réponse illisible : ${url}`);
    if (data && data.__httpError !== undefined) {
      const err = new Error(`HTTP ${data.__httpError} pour ${url}`);
      err.status = data.__httpError;
      throw err;
    }
    return data;
  };
}

const { report, snapshot } = await buildSnapshot({
  previous: readJson(previousPath, { matches: [] }),
  save: false,
  now,
  confirmDelayMs: 0,
  providers: createLiveProviders({ getJson: cachedGetJson('a'), unthrottled: true }),
  confirmProviders: createLiveProviders({ getJson: cachedGetJson('b'), unthrottled: true }),
});

const complete = !missing.a.size && !missing.b.size;
if (complete && outPath) writeFile(outPath, JSON.stringify(snapshot));
print(JSON.stringify({ complete, missing: { a: [...missing.a], b: [...missing.b] }, report }));
