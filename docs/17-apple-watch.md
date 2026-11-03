# Apple Watch : dicter un message à claap-agent ou perso-agent

Demande de Robin (30/10/2026) : sur la montre, dicter un message qui arrive dans une session
Kova, `claap-agent` ou `perso-agent`. Rien de plus en v1.

## État (30/10/2026)

- Code sur `main` (local, non poussé), daemon redéployé avec `POST /v1/sessions/text`.
- Vérifié : tests daemon (`sessiontext.test.ts`), typecheck de l'app, build Xcode iPhone +
  montre, aller-retour montre, iPhone (app fermée, réveillée en arrière-plan), réponse du
  relais, en simulateur. Pas vérifié : l'envoi jusqu'au Mac depuis un vrai iPhone.
- Build 1.2.0 (18) sur TestFlight depuis le 30/10 à 23:18, en test interne. Le contrat Apple a
  été accepté par Thomas le 30/10. Le premier build avec une nouvelle cible demande un passage
  interactif d'`eas build` (création du profil de provisionnement), les suivants passent en
  `--non-interactive`.
- Après l'installation du 1.2.0, une OTA doit viser la version d'exécution 1.2.0 (canal
  `production`, celui de `npm run ota` depuis 4413568).
- Limite connue : si l'écriture dans Kova dépasse 12 s, un nouvel essai depuis la montre
  peut répondre « Delivered » (nonce déjà réservé) alors que le premier envoi échoue ensuite.
- Complication (03/11/2026) : code sur `feat/ds-tokens`, typecheck watchOS des deux cibles
  passé. Pas encore de build EAS : `watch-widget` est une nouvelle cible, le bundle
  `io.claap.kovalink.watch.widget` et son App Group restent à déclarer dans le portail Apple.

## Parcours

1. Ouvrir KovaLink sur la montre. La cible affichée est la dernière choisie (`claap-agent`
   par défaut), un tap pour changer.
2. Tap sur **Dictate** : la saisie système de watchOS (dictée, gribouillage ou clavier).
3. Le texte s'affiche, **Send**.
4. Retour haptique et **Delivered to claap-agent**, ou la raison de l'échec en orange
   (iPhone injoignable, Mac injoignable, session absente avec la liste des sessions
   ouvertes, Kova arrêté). Un nouvel essai garde le même nonce : pas de doublon.

## Chemin d'un message

```
Montre (SwiftUI, targets/watch)
  -- WatchConnectivity sendMessage {kind:send, session, text, nonce} -->
iPhone, code natif (modules/watch-relay), réveillé en arrière-plan si l'app est fermée
  -- HTTPS POST /v1/sessions/text, Bearer du téléphone, via Tailscale -->
kovalinkd : resolveSession (comme le pont Slack) puis KeyGate.emitText (comme l'iPhone)
  --> pane Kova de la session
```

- **Pourquoi l'iPhone relaie** : watchOS n'a pas Tailscale, la montre ne joint pas le Mac.
  Aucun jeton ne vit sur la montre.
- **Pourquoi en natif et pas en JS** : un message de la montre réveille l'app iPhone en
  arrière-plan sans garantie que le JS démarre. Le module natif active WatchConnectivity au
  lancement (`ExpoAppDelegateSubscriber`) et poste lui-même.
- **iPhone verrouillé** : le trousseau de l'app est en `WHEN_UNLOCKED`, donc fermé dans la
  poche. Le JS copie l'adresse du Mac et le jeton dans un élément de trousseau propre au
  relais, en `AfterFirstUnlockThisDeviceOnly`, à chaque lancement, appairage et rotation ;
  le désappairage l'efface. Un jeton expiré rend « Open KovaLink on the iPhone ».
- **Session occupée** : même comportement que l'envoi depuis l'iPhone, le texte est tapé
  tout de suite (Claude Code le met en file). Le pont Slack, lui, attend la fin du tour.

## Complication (cadran)

- L'iPhone pousse `[asks, errors, ended, oldestAt]` par `updateApplicationContext` et, quand
  il reste du budget, `transferCurrentComplicationUserInfo` (module `watch-relay`).
- La montre le reçoit (`didReceiveApplicationContext`, `didReceiveUserInfo`, et le contexte
  déjà reçu à l'activation), l'écrit dans les defaults de l'App Group `group.io.claap.kovalink`
  sous `watch.counts` plus `watch.counts.at`, puis recharge les timelines.
- L'extension `targets/watch-widget` relit ces quatre entiers : rond avec le nombre d'asks,
  rectangle avec l'âge de la plus ancienne attente, inline et coin en « N asks ».
- Rafraîchissement demandé toutes les 15 min, un tap ouvre l'app montre. Jamais un mot du
  contenu : ni question, ni nom de pane.

## Fichiers

| Partie | Fichier |
|---|---|
| Route | `packages/protocol/src/routes.ts` (`sessionText`), `daemon/src/kova/sessionText.ts`, `daemon/src/server/index.ts` |
| Tests | `daemon/test/sessiontext.test.ts` |
| Relais iPhone | `app/modules/watch-relay/` (Swift + `index.ts`), appelé depuis `src/store/credentials.ts` et `src/boot.ts` |
| App montre | `app/targets/watch/` (`expo-target.config.js`, SwiftUI) |
| Complication | `app/targets/watch-widget/` (`expo-target.config.js`, `Widget.swift`, `DSTokens.swift` généré) |

La cible montre est générée par `@bacons/apple-targets` (type `watch`, bundle
`io.claap.kovalink.watch`, embarquée dans l'app iPhone). C'est un changement natif : un build
EAS et un bump de `version`, jamais une OTA seule. Les deux cibles déclarent l'App Group
`group.io.claap.kovalink` dans `entitlements`, l'extension sous le bundle
`io.claap.kovalink.watch.widget`.

## Plus tard

- Dictée AssemblyAI avec le glossaire de Robin (`GET /v1/voice/stream-token`) : l'audio
  passerait par l'iPhone. La dictée système suffit pour la v1.
- Bouton Action (Ultra, App Intent) pour ouvrir directement la dictée.
- File d'attente quand l'iPhone est hors de portée (`transferUserInfo`).
