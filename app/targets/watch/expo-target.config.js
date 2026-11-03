/**
 * Cible Apple Watch, ajoutée au prebuild par `@bacons/apple-targets` (bundle
 * `io.claap.kovalink.watch`, embarquée dans l'app iPhone).
 *
 * V1 volontairement minuscule : choisir claap-agent ou perso-agent, dicter, envoyer. La
 * montre n'a pas Tailscale : elle ne parle jamais au Mac. Elle passe le texte à l'iPhone par
 * WatchConnectivity, et c'est le module natif `modules/watch-relay` de l'app iPhone qui
 * l'envoie au daemon (`POST /v1/sessions/text`). Aucun jeton ne vit sur la montre.
 */
module.exports = {
  type: 'watch',
  name: 'KovaLinkWatch',
  displayName: 'KovaLink',
  // Même icône que l'app iPhone (celle par défaut de prebuild) : TestFlight refuse une
  // app montre sans icône.
  icon: './icon.png',
  deploymentTarget: '10.0',
  colors: {
    $accent: '#3A5EED',
  },
  // L'App Group (`group.io.claap.kovalink`) porte les nombres du cadran jusqu'à l'extension
  // `watch-widget`. Retiré tant que l'App ID de la montre n'a pas le groupe sur le portail
  // Apple (voir `targets-off/README.md`) : sans lui, Xcode refuse de signer. PhoneLink écrit
  // alors dans ses propres préférences, sans effet visible puisque la complication est hors build.
};
