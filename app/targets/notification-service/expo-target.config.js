/**
 * Cible Notification Service Extension, ajoutée au prebuild par `@bacons/apple-targets`.
 *
 * Elle partage le groupe de trousseau de l'app pour lire le jeton court dédié à la NSE et le
 * nom MagicDNS. Ce jeton n'ouvre que la route `GET /v1/prompt/{promptRef}` : il ne peut ni
 * répondre, ni lire un fichier, ni ouvrir un WebSocket.
 *
 * Le groupe d'apps `group.io.claap.kovalink` est déclaré ici comme sur l'app hôte et sur la
 * Share Extension : il a été créé dans le portail développeur Apple et rattaché aux trois
 * bundle ids, le profil de provisionnement de chaque cible doit donc le porter.
 */
module.exports = {
  type: 'notification-service',
  name: 'KovaLinkNotificationService',
  entitlements: {
    'keychain-access-groups': ['$(AppIdentifierPrefix)io.claap.kovalink'],
    'com.apple.security.application-groups': ['group.io.claap.kovalink'],
  },
  deploymentTarget: '17.0',
};
