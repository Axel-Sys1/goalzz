// Noms des sélections nationales en français (les sources les donnent en anglais).
// Seuls les noms exacts sont traduits : un club ou un joueur n'est jamais modifié.
const FR = {
  Albania: 'Albanie', Algeria: 'Algérie', Andorra: 'Andorre', Argentina: 'Argentine', Armenia: 'Arménie',
  Australia: 'Australie', Austria: 'Autriche', Azerbaijan: 'Azerbaïdjan', Belarus: 'Biélorussie',
  Belgium: 'Belgique', Bolivia: 'Bolivie', 'Bosnia-Herzegovina': 'Bosnie-Herzégovine', 'Bosnia and Herzegovina': 'Bosnie-Herzégovine',
  Brazil: 'Brésil', Bulgaria: 'Bulgarie', Cameroon: 'Cameroun', Chile: 'Chili', China: 'Chine',
  Colombia: 'Colombie', Comoros: 'Comores', 'Cook Islands': 'Îles Cook', Croatia: 'Croatie', Cyprus: 'Chypre',
  Czechia: 'Tchéquie', 'Czech Republic': 'Tchéquie', Denmark: 'Danemark', Ecuador: 'Équateur', Egypt: 'Égypte',
  England: 'Angleterre', Estonia: 'Estonie', 'Faroe Islands': 'Îles Féroé', Fiji: 'Fidji', Finland: 'Finlande',
  Georgia: 'Géorgie', Germany: 'Allemagne', Greece: 'Grèce', Hungary: 'Hongrie', Iceland: 'Islande',
  India: 'Inde', Iraq: 'Irak', Ireland: 'Irlande', 'Republic of Ireland': 'Irlande', Israel: 'Israël',
  Italy: 'Italie', 'Ivory Coast': "Côte d'Ivoire", Japan: 'Japon', Jordan: 'Jordanie', Kazakhstan: 'Kazakhstan',
  'Kyrgyz Republic': 'Kirghizistan', Latvia: 'Lettonie', Lebanon: 'Liban', Lithuania: 'Lituanie',
  Malta: 'Malte', Mauritius: 'Maurice', Mexico: 'Mexique', Moldova: 'Moldavie', Montenegro: 'Monténégro',
  Morocco: 'Maroc', Mozambique: 'Mozambique', Namibia: 'Namibie', Netherlands: 'Pays-Bas',
  'New Caledonia': 'Nouvelle-Calédonie', 'New Zealand': 'Nouvelle-Zélande', Nigeria: 'Nigeria',
  'North Macedonia': 'Macédoine du Nord', 'Northern Ireland': 'Irlande du Nord', Norway: 'Norvège',
  'Papua New Guinea': 'Papouasie-Nouvelle-Guinée', Peru: 'Pérou', Poland: 'Pologne', Romania: 'Roumanie',
  Russia: 'Russie', 'Saudi Arabia': 'Arabie saoudite', 'San Marino': 'Saint-Marin', Scotland: 'Écosse',
  Senegal: 'Sénégal', Serbia: 'Serbie', Slovakia: 'Slovaquie', Slovenia: 'Slovénie',
  'Solomon Islands': 'Îles Salomon', 'South Africa': 'Afrique du Sud', 'South Korea': 'Corée du Sud',
  Spain: 'Espagne', Sweden: 'Suède', Switzerland: 'Suisse', Syria: 'Syrie', Tajikistan: 'Tadjikistan',
  Tunisia: 'Tunisie', Turkey: 'Turquie', Türkiye: 'Turquie', Turkmenistan: 'Turkménistan', Ukraine: 'Ukraine',
  'United States': 'États-Unis', USA: 'États-Unis', Uruguay: 'Uruguay', Uzbekistan: 'Ouzbékistan', Wales: 'Pays de Galles',
};

export const frenchTeamName = (name) => FR[name] || name;
