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
  ('feminin', 'Foot féminin', 'football', '''
    Aitana Bonmati M; Alexia Putellas L; Kadidiatou Diani E; Wendie Renard E; Marie-Antoinette Katoto E; Sam Kerr E;
    Caroline Graham Hansen E; Ada Hegerberg E; Sakina Karchaoui R; Grace Geyoro R; Alessia Russo R; Lauren James R;
    Selma Bacha R; Delphine Cascarino R; Melchie Dumornay R; Trinity Rodman R; Mary Earps C; Sophia Smith C'''),
  ('wnba', 'Basket féminin', 'basketball', '''
    Caitlin Clark L; A'ja Wilson L; Breanna Stewart E; Sabrina Ionescu E; Paige Bueckers E; Napheesa Collier E;
    Angel Reese R; Gabby Williams R; Marine Johannes R; Jewell Loyd C; Kelsey Plum C'''),
  ('tennis', 'Tennis', 'tennis', '''
    Jannik Sinner M; Carlos Alcaraz M; Novak Djokovic L; Aryna Sabalenka L; Iga Swiatek L; Coco Gauff E;
    Alexander Zverev E; Elena Rybakina E; Mirra Andreeva E; Arthur Fils E; Taylor Fritz R; Daniil Medvedev R;
    Jack Draper R; Holger Rune R; Ben Shelton R; Alex de Minaur R; Lorenzo Musetti R; Jessica Pegula R;
    Jasmine Paolini R; Lois Boisson R; Ugo Humbert C; Gael Monfils C; Giovanni Mpetshi Perricard C; Arthur Rinderknech C'''),
  ('mma', 'UFC', 'mma', '''
    Islam Makhachev M; Ilia Topuria M; Jon Jones L; Alex Pereira L; Merab Dvalishvili L; Tom Aspinall E; Ciryl Gane E;
    Benoit Saint-Denis E; Dricus du Plessis E; Khamzat Chimaev E; Conor McGregor E; Alexandre Pantoja R; Belal Muhammad R;
    Max Holloway R; Sean O'Malley R; Manon Fiorot R; Nassourdine Imavov R; Charles Oliveira R; Justin Gaethje C; Dustin Poirier C'''),
  ('boxe', 'Boxe', 'boxing', '''
    Oleksandr Usyk M; Canelo Alvarez L; Naoya Inoue L; Terence Crawford L; Tyson Fury E; Anthony Joshua E; Gervonta Davis E;
    Shakur Stevenson R; Dmitry Bivol R; Artur Beterbiev R; Daniel Dubois R; David Benavidez R; Jake Paul C;
    Devin Haney C; Ryan Garcia C'''),
  ('rugby', 'Rugby', 'rugby', '''
    Antoine Dupont M; Damian Penaud L; Thomas Ramos E; Romain Ntamack E; Louis Bielle-Biarrey E; Siya Kolisi E; Eben Etzebeth E;
    Ardie Savea E; Cheslin Kolbe E; Charles Ollivon R; Matthieu Jalibert R; Thibaud Flament R; Gael Fickou R;
    Finn Russell R; Marcus Smith R; Peato Mauvaka R; Uini Atonio C; Yoram Moefana C; Paul Boudehent C'''),
  ('nhl', 'NHL', 'hockey', '''
    Connor McDavid M; Nathan MacKinnon L; Auston Matthews L; Leon Draisaitl L; Nikita Kucherov E; Cale Makar E; Sidney Crosby E;
    Alexander Ovechkin E; David Pastrnak R; Kirill Kaprizov R; Jack Hughes R; Connor Bedard R; Igor Shesterkin R; Mitch Marner R;
    Matthew Tkachuk C; Alexandre Texier C'''),
  ('nfl', 'NFL', 'americanfootball', '''
    Patrick Mahomes M; Josh Allen L; Lamar Jackson L; Joe Burrow E; Jalen Hurts E; Saquon Barkley E; Justin Jefferson E;
    Ja'Marr Chase E; Travis Kelce R; Tyreek Hill R; CeeDee Lamb R; Micah Parsons R; T.J. Watt R; Christian McCaffrey R;
    Derrick Henry R; Aaron Rodgers C; Caleb Williams C; Brock Purdy C'''),
]
RAR = {'M': 'mythique', 'L': 'legendaire', 'E': 'epique', 'R': 'rare', 'C': 'commun'}
POS = [
  (r'goal', 'Gardien'), (r'back|defen', 'Défenseur'), (r'midfield', 'Milieu'), (r'wing|forward|striker', 'Attaquant'),
  (r'point guard', 'Meneur'), (r'shooting guard|guard', 'Arrière'), (r'power forward', 'Ailier fort'),
  (r'small forward', 'Ailier'), (r'center|centre', 'Pivot'),
]
SPORT = {'football': 'Soccer', 'basketball': 'Basketball', 'tennis': 'Tennis', 'mma': 'Fighting', 'boxing': 'Fighting',
         'rugby': 'Rugby', 'hockey': 'Ice Hockey', 'americanfootball': 'American Football'}
# Sports individuels : la carte montre le pays du joueur (et sa catégorie de poids), pas un club.
SOLO = {'tennis', 'mma', 'boxing'}
NAT_FR = {'Italy': 'Italie', 'Spain': 'Espagne', 'Serbia': 'Serbie', 'Belarus': 'Biélorussie', 'Poland': 'Pologne',
  'United States': 'États-Unis', 'USA': 'États-Unis', 'Germany': 'Allemagne', 'Russia': 'Russie', 'England': 'Angleterre',
  'Great Britain': 'Royaume-Uni', 'United Kingdom': 'Royaume-Uni', 'Denmark': 'Danemark', 'France': 'France', 'Kazakhstan': 'Kazakhstan',
  'Australia': 'Australie', 'Ukraine': 'Ukraine', 'Mexico': 'Mexique', 'Japan': 'Japon', 'Georgia': 'Géorgie', 'Brazil': 'Brésil',
  'South Africa': 'Afrique du Sud', 'New Zealand': 'Nouvelle-Zélande', 'Scotland': 'Écosse', 'Canada': 'Canada', 'Sweden': 'Suède',
  'Czech Republic': 'Tchéquie', 'Norway': 'Norvège', 'Netherlands': 'Pays-Bas', 'Haiti': 'Haïti', 'Switzerland': 'Suisse',
  'Ireland': 'Irlande', 'Brazil ': 'Brésil', 'Cameroon': 'Cameroun', 'Samoa': 'Samoa', 'Tonga': 'Tonga', 'Fiji': 'Fidji'}
WEIGHT_FR = [('light heavyweight', 'Mi-lourds'), ('super middleweight', 'Super-moyens'), ('cruiserweight', 'Lourds-légers'),
  ('heavyweight', 'Lourds'), ('super lightweight', 'Super-légers'), ('middleweight', 'Moyens'), ('welterweight', 'Mi-moyens'),
  ('lightweight', 'Légers'), ('featherweight', 'Plumes'), ('bantamweight', 'Coqs'), ('flyweight', 'Mouches'), ('strawweight', 'Pailles')]
POS_SPORT = {
  'rugby': [('scrum', 'Demi de mêlée'), ('fly', "Demi d'ouverture"), ('wing', 'Ailier'), ('centre|center', 'Centre'), ('full', 'Arrière'),
            ('hooker', 'Talonneur'), ('prop', 'Pilier'), ('lock', 'Deuxième ligne'), ('flanker|back row', 'Troisième ligne'), ('number 8|no. 8', 'Numéro 8')],
  'hockey': [('left wing', 'Ailier gauche'), ('right wing', 'Ailier droit'), ('center|centre', 'Centre'), ('defen', 'Défenseur'), ('goal', 'Gardien')],
  'americanfootball': [('quarterback', 'Quarterback'), ('running', 'Running back'), ('wide', 'Receveur'), ('tight', 'Tight end'),
            ('linebacker', 'Linebacker'), ('defensive end|edge', 'Defensive end'), ('safety', 'Safety'), ('corner', 'Cornerback')],
}
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

def pos_fr(p, sport, team=''):
  if sport == 'tennis': return 'WTA' if 'women' in (team or '').lower() or 'wta' in (team or '').lower() else 'ATP'
  if sport in ('mma', 'boxing'):
    t = (team or '').lower()
    fr = next((v for k, v in WEIGHT_FR if k in t), '')
    return ('Poids ' + fr.lower()) if fr else ('UFC' if sport == 'mma' else 'Boxe')
  if sport in POS_SPORT:
    low = (p or '').lower()
    return next((v for k, v in POS_SPORT[sport] if re.search(k, low)), p or '')
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
    if (p.get('strTeam') or '').startswith('_Free'): p = {**p, 'strTeam': 'Agent libre'}
    setid = key
    if key in CLUB_SETS:
      setid = next((k for k, teams in LEAGUE_OF.items() if p['strTeam'] in teams), 'ailleurs')
    cid = f'{setid}-{slug(name)}'
    if any(c['id'] == cid for c in cards): continue
    cards.append({
      'id': cid, 'set': setid, 'sport': sport, 'name': p['strPlayer'], 'rarity': RAR[r],
      'team': nation or (NAT_FR.get(p.get('strNationality') or '', p.get('strNationality') or '') if sport in SOLO else p['strTeam']), 'national': bool(nation) or sport in SOLO, 'pos': pos_fr(p.get('strPosition'), sport, p.get('strTeam')),
      'num': None if nation or sport in SOLO else (p.get('strNumber') or None),
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
