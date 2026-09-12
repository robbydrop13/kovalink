/**
 * Cible Share Extension, ajoutée au prebuild par `@bacons/apple-targets`.
 *
 * Même mécanisme que la Notification Service Extension du lot 1 : un dossier `targets/`,
 * un `expo-target.config.js`, et le plugin déjà déclaré dans `app.json` fait le reste au
 * `prebuild`. On n'ajoute PAS un second plugin de partage : une cible de plus dans un
 * mécanisme qui fonctionne déjà coûte moins cher qu'une dépendance de plus.
 *
 * L'App Group `group.io.claap.kovalink` est partagé avec l'app hôte : c'est par lui que
 * les pièces jointes transitent. L'extension ne fait QUE copier et passer la main, elle
 * n'ouvre aucune connexion réseau et ne lit aucun jeton.
 */
module.exports = {
  type: 'share',
  name: 'KovaLinkShare',
  displayName: 'KovaLink',
  entitlements: {
    'com.apple.security.application-groups': ['group.io.claap.kovalink'],
  },
  deploymentTarget: '17.0',
};
