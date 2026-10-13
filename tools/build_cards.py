# Génère js/data/cards.js : catalogue des cartes joueurs (photos détourées de TheSportsDB).
# Lancer : python3 tools/build_cards.py   (≈ 4 min : l'API gratuite limite le nombre de requêtes)
# M = mythique, L = légendaire, E = épique, R = rare, C = commun. Un nom de pays après « @ » fait
# une carte de sélection nationale (même joueur, maillot de son pays).
import json, re, sys, time, unicodedata, urllib.parse, urllib.request, os

SETS = [
  ('ligue1', 'Ligue 1', 'football', '''
    Ousmane Dembele L; Achraf Hakimi E; Khvicha Kvaratskhelia E; Vitinha E; Desire Doue E; Nuno Mendes E;
    Marquinhos R; Joao Neves R; Bradley Barcola R; Warren Zaire-Emery R; Mason Greenwood E;
    Pierre-Emerick Aubameyang R; Paul Pogba R; Goncalo Ramos R; Folarin Balogun R; Ansu Fati C;
    Aleksandr Golovin C; Amine Gouiri C; Geronimo Rulli C; Leonardo Balerdi C; Lucas Hernandez C; Eliesse Ben Seghir C'''),
  ('pl', 'Premier League', 'football', '''
    Erling Haaland M; Mohamed Salah L; Bukayo Saka E; Cole Palmer E; Virgil van Dijk E; Alexander Isak E;
    Florian Wirtz E; William Saliba E; Martin Odegaard R; Declan Rice R; Bruno Fernandes R; Phil Foden R;
    Hugo Ekitike R; Alexis Mac Allister R; Gianluigi Donnarumma R; Enzo Fernandez R; Moises Caicedo R;
    Bryan Mbeumo C; Matheus Cunha C; Dominik Szoboszlai C; Jeremy Doku C'''),
  ('liga', 'LaLiga', 'football', '''
    Kylian Mbappe M; Lamine Yamal M; Vinicius Junior L; Jude Bellingham L; Pedri E; Robert Lewandowski E;
    Raphinha E; Julian Alvarez E; Thibaut Courtois R; Federico Valverde R; Antoine Griezmann R; Jan Oblak R;
    Aurelien Tchouameni R; Arda Guler R; Nico Williams R; Eduardo Camavinga C; Frenkie de Jong C; Dani Olmo C;
    Joan Garcia C; Alvaro Carreras C'''),
  ('europe', 'Serie A & Bundesliga', 'football', '''
    Harry Kane L; Jamal Musiala E; Michael Olise E; Lautaro Martinez E; Luka Modric E; Kevin De Bruyne E;
    Rafael Leao R; Nicolo Barella R; Scott McTominay R; Kenan Yildiz R; Christian Pulisic R; Mike Maignan R;
    Serhou Guirassy R; Joshua Kimmich R; Dusan Vlahovic C; Adrien Rabiot C; Marcus Thuram C; Luis Diaz C'''),
  ('edf', 'Équipe de France', 'football', '''
    Kylian Mbappe M @France; Ousmane Dembele L @France; William Saliba E @France; Michael Olise E @France;
    Desire Doue E @France; Mike Maignan R @France; Aurelien Tchouameni R @France; Jules Kounde R @France;
    Bradley Barcola R @France; Theo Hernandez R @France; Rayan Cherki R @France; Marcus Thuram R @France;
    Hugo Ekitike R @France; Dayot Upamecano C @France; Eduardo Camavinga C @France; Ibrahima Konate C @France'''),
  ('monde', 'Stars des nations', 'football', '''
    Lionel Messi M @Argentine; Cristiano Ronaldo M @Portugal; Neymar L @Brésil; Lamine Yamal L @Espagne;
    Erling Haaland L @Norvège; Harry Kane E @Angleterre; Achraf Hakimi E @Maroc; Mohamed Salah E @Égypte;
    Vinicius Junior E @Brésil; Luka Modric R @Croatie; Kevin De Bruyne R @Belgique; Son Heung-min R @Corée du Sud'''),
  ('nba', 'NBA', 'basketball', '''
    Victor Wembanyama M; LeBron James L; Stephen Curry L; Nikola Jokic L; Giannis Antetokounmpo L; Luka Doncic L;
    Shai Gilgeous-Alexander L; Jayson Tatum E; Kevin Durant E; Anthony Edwards E; Jalen Brunson E; Cooper Flagg E;
    Joel Embiid R; Tyrese Haliburton R; Devin Booker R; Kyrie Irving R; Anthony Davis R; Paolo Banchero R;
    Zaccharie Risacher C; Alexandre Sarr C; Rudy Gobert C; Jimmy Butler C; Bam Adebayo C'''),
]
RAR = {'M': 'mythique', 'L': 'legendaire', 'E': 'epique', 'R': 'rare', 'C': 'commun'}
POS = [
  (r'goal', 'Gardien'), (r'back|defen', 'Défenseur'), (r'midfield', 'Milieu'), (r'wing|forward|striker', 'Attaquant'),
  (r'point guard', 'Meneur'), (r'shooting guard|guard', 'Arrière'), (r'power forward', 'Ailier fort'),
  (r'small forward', 'Ailier'), (r'center|centre', 'Pivot'),
]
SPORT = {'football': 'Soccer', 'basketball': 'Basketball'}
# Noms tels que TheSportsDB les connaît, quand la recherche simple tombe sur un homonyme.
ALIASES = {'Pedri': 'Pedri Gonzalez', 'Rodri': 'Rodrigo Hernandez', 'Kenan Yildiz': 'Kenan Yıldız', 'Alexandre Sarr': 'Alex Sarr'}
# Club actuel quand TheSportsDB ne connaît que la sélection (vérifié chez ESPN, oct. 2026).
TEAM_FIX = {'Thibaut Courtois': 'Real Madrid', 'Kevin De Bruyne': 'Napoli', 'Jeremy Doku': 'Manchester City'}
NATIONS = {'France', 'Belgium', 'Spain', 'England', 'Brazil', 'Argentina', 'Portugal', 'Germany', 'Netherlands', 'Italy', 'Croatia', 'Morocco', 'Norway', 'Egypt'}
# Club actuel → collection (un joueur parti ailleurs change de collection ; hors grands championnats : « Ailleurs »).
LEAGUE_OF = {
  'ligue1': {'Paris SG', 'Marseille', 'Monaco', 'Lyon', 'Lille', 'Lens', 'Nice', 'Rennes', 'Strasbourg', 'Nantes', 'Toulouse', 'Brest', 'Reims', 'Montpellier', 'Auxerre', 'Angers', 'Le Havre', 'Lorient', 'Metz', 'Paris FC'},
  'pl': {'Arsenal', 'Chelsea', 'Liverpool', 'Manchester City', 'Manchester United', 'Tottenham Hotspur', 'Newcastle United', 'Aston Villa', 'Brighton and Hove Albion', 'West Ham United', 'Crystal Palace', 'Brentford', 'Fulham', 'Everton', 'Nottingham Forest', 'Bournemouth', 'Wolverhampton Wanderers', 'Leeds United', 'Sunderland', 'Burnley'},
  'liga': {'Real Madrid', 'Barcelona', 'Atletico Madrid', 'Atlético Madrid', 'Athletic Bilbao', 'Real Sociedad', 'Villarreal', 'Real Betis', 'Sevilla', 'Valencia', 'Girona', 'Celta Vigo'},
  'europe': {'Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen', 'RB Leipzig', 'Eintracht Frankfurt', 'Inter Milan', 'AC Milan', 'Juventus', 'Napoli', 'Roma', 'Lazio', 'Atalanta'},
}
CLUB_SETS = set(LEAGUE_OF)

def slug(s):
  s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
  return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

def pos_fr(p, sport):
  p = (p or '').lower()
  for pat, fr in POS:
    if sport == 'basketball' and fr in ('Gardien', 'Défenseur', 'Milieu', 'Attaquant'): continue
    if sport == 'football' and fr in ('Meneur', 'Arrière', 'Ailier fort', 'Ailier', 'Pivot'): continue
    if re.search(pat, p): return fr
  return ''

cache_file = os.path.join(os.path.dirname(__file__), '.cards_cache.json')
cache = json.load(open(cache_file)) if os.path.exists(cache_file) else {}

def search(name, sport):
  if name in cache: return cache[name]
  url = 'https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=' + urllib.parse.quote(ALIASES.get(name, name))
  for attempt in range(5):
    try:
      with urllib.request.urlopen(url, timeout=20) as r: d = json.load(r)
      break
    except Exception as e:
      print('  retry', name, e, file=sys.stderr); time.sleep(10 * (attempt + 1))
  else: return None
  time.sleep(2.2)
  cands = [p for p in (d.get('player') or []) if p.get('strSport') == SPORT[sport]]
  cands.sort(key=lambda p: ((p.get('strTeam') or '').startswith('_'), (p.get('strTeam') or '') in NATIONS, not p.get('strCutout')))
  hit = cands[0] if cands else None
  cache[name] = hit and {k: hit.get(k) for k in ('idPlayer', 'strPlayer', 'strTeam', 'strNationality', 'strPosition', 'strNumber', 'strCutout', 'strThumb')}
  json.dump(cache, open(cache_file, 'w'))
  return cache[name]

cards, sets, missing = [], [], []
for key, label, sport, spec in SETS:
  for entry in [e.strip() for e in spec.split(';') if e.strip()]:
    m = re.match(r'(.+?)\s+([MLERC])(?:\s+@(.+))?$', entry)
    name, r, nation = m.group(1), m.group(2), m.group(3)
    p = search(name, sport)
    if not p: missing.append(name); print('MISSING', name, file=sys.stderr); continue
    if name in TEAM_FIX and not nation: p = {**p, 'strTeam': TEAM_FIX[name]}
    setid = key
    if key in CLUB_SETS:
      setid = next((k for k, teams in LEAGUE_OF.items() if p['strTeam'] in teams), 'ailleurs')
    cid = f'{setid}-{slug(name)}'
    if any(c['id'] == cid for c in cards): continue
    cards.append({
      'id': cid, 'set': setid, 'sport': sport, 'name': p['strPlayer'], 'rarity': RAR[r],
      'team': nation or p['strTeam'], 'national': bool(nation), 'pos': pos_fr(p.get('strPosition'), sport),
      'num': None if nation else (p.get('strNumber') or None),
      'img': p.get('strCutout') or p.get('strThumb') or None, 'cutout': bool(p.get('strCutout')),
    })
    print(f"{cid:45} {p['strTeam']:25} {p.get('strPosition')} {'cutout' if p.get('strCutout') else 'thumb' if p.get('strThumb') else 'NO IMG'}")
  sets.append({'id': key, 'name': label, 'sport': sport})
  if key == 'europe': sets.append({'id': 'ailleurs', 'name': 'Ailleurs dans le monde', 'sport': 'football'})

out = os.path.join(os.path.dirname(__file__), '..', 'js', 'data', 'cards.js')
os.makedirs(os.path.dirname(out), exist_ok=True)
sets = [st for st in sets if any(c['set'] == st['id'] for c in cards)]
with open(out, 'w') as f:
  f.write('// Généré par tools/build_cards.py (photos : TheSportsDB). Ne pas modifier à la main.\n')
  f.write('export const CARD_SETS = ' + json.dumps(sets, ensure_ascii=False, indent=1) + ';\n')
  f.write('export const CARDS = [\n' + ',\n'.join(json.dumps(c, ensure_ascii=False) for c in cards) + ',\n];\n')
print(len(cards), 'cartes;', 'introuvables:', missing)
