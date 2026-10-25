// Pub récompensée : le joueur regarde une pub entière et reçoit des Goalz, quelques fois par jour
// (compteur remis à zéro à minuit). L'affichage de la pub elle-même est dans ui/rewardAd.js.
import { CONFIG } from '../config.js';
import { getState, update } from '../store.js';
import { currentPlayer } from './players.js';
import { dayKey } from './progress.js';

const settings = () => CONFIG.ADS?.rewarded || {};

export const rewardAdEnabled = () => Boolean(CONFIG.ADS?.enabled && settings().enabled);
export const AD_GOALZ = () => settings().goalz || 0;
export const AD_PER_DAY = () => settings().perDay || 0;

// Pubs qu'il reste à regarder aujourd'hui.
export function adsLeft(p, t = Date.now()) {
  const watched = p?.adDay?.day === dayKey(t) ? p.adDay.watched : 0;
  return Math.max(0, AD_PER_DAY() - watched);
}

// Pub regardée jusqu'au bout : on verse la récompense.
export function rewardAdWatched() {
  const p = currentPlayer(getState());
  if (!p) throw new Error('Choisis d\'abord ton pseudo.');
  if (!adsLeft(p)) throw new Error('Plus de bonus vidéo aujourd\'hui. Reviens demain !');
  const amount = AD_GOALZ();
  update((s) => {
    const me = s.players[p.id];
    const day = dayKey(Date.now());
    if (me.adDay?.day !== day) me.adDay = { day, watched: 0 };
    me.adDay.watched += 1;
    me.balance += amount;
    const left = adsLeft(me);
    me.inbox.push({
      type: 'reward', amount,
      text: `Bonus vidéo : +${amount.toLocaleString('fr-FR')} Goalz · ${left ? `encore ${left} aujourd'hui` : 'reviens demain pour les suivantes'}`,
    });
  });
}
