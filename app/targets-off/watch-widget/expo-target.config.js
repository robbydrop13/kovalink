/**
 * Complication de cadran, ajoutée au prebuild par `@bacons/apple-targets` (type
 * `watch-widget`, bundle `io.claap.kovalink.watch.widget`, embarquée dans l'app montre).
 *
 * Elle ne calcule rien : l'app montre écrit `[asks, errors, ended, oldestAt]` dans les
 * defaults de l'App Group `group.io.claap.kovalink` sous `watch.counts`, et l'extension relit
 * ces quatre entiers à chaque timeline. Pas de WatchConnectivity ici, et jamais un mot du
 * contenu (ni question, ni nom de pane).
 *
 * `DSTokens.swift` est généré par `npm run tokens` (comme celui de la montre) : le plugin ne compile que
 * les fichiers du dossier de la cible, d’où cette seconde sortie du générateur.
 */
module.exports = {
  type: 'watch-widget',
  name: 'KovaLinkWatchWidget',
  displayName: 'KovaLink',
  // Préfixé par le bundle de l'app hôte : io.claap.kovalink.watch.widget.
  bundleIdentifier: '.watch.widget',
  deploymentTarget: '10.0',
  colors: {
    $accent: '#3A5EED',
  },
  entitlements: {
    'com.apple.security.application-groups': ['group.io.claap.kovalink'],
  },
};
