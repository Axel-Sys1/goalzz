// Déménagement de goalzz.pages.dev vers goalzz.fr. Script classique, chargé avant l'appli :
// la partie des joueurs sans compte est stockée par adresse de site, l'ancienne adresse l'envoie
// donc à la nouvelle dans le lien (#transfert=…), et la nouvelle l'enregistre si elle n'a rien.
// L'ancienne adresse ne redirige que si goalzz.fr sert bien le site (image de test chargée) :
// tant que le domaine n'est pas branché, rien ne change.
(function () {
  var KEY = 'goalz:v1';
  var NEW = 'https://goalzz.fr/';
  var OLD = { 'goalzz.pages.dev': 1, 'axel-sys1.github.io': 1 };
  try {
    if (OLD[location.hostname]) {
      var probe = new Image();
      probe.onload = function () {
        var saved = localStorage.getItem(KEY);
        var hash = saved ? '#transfert=' + encodeURIComponent(btoa(unescape(encodeURIComponent(saved)))) : location.hash;
        location.replace(NEW + location.search + hash);
      };
      probe.src = NEW + 'icons/icon-192.png?v=' + Date.now();
      return;
    }
    var m = /^#transfert=(.+)$/.exec(location.hash);
    if (m) {
      var data = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
      JSON.parse(data); // partie illisible : on l'ignore
      if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, data);
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { /* stockage indisponible ou lien abîmé : on continue sans transfert */ }
})();
