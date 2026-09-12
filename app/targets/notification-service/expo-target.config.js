/**
 * Cible Notification Service Extension, ajoutée au prebuild par `@bacons/apple-targets`.
 *
 * Elle partage le groupe de trousseau de l'app pour lire le jeton court dédié à la NSE et le
 * nom MagicDNS. Ce jeton n'ouvre que la route `GET /v1/prompt/{promptRef}` : il ne peut ni
 * répondre, ni lire un fichier, ni ouvrir un WebSocket.
 */
module.exports = {
  type: 'notification-service',
  name: 'KovaLinkNotificationService',
  entitlements: {
    'keychain-access-groups': ['$(AppIdentifierPrefix)io.claap.kovalink'],
  },
  deploymentTarget: '17.0',
};
