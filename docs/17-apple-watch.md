# Apple Watch : dicter un message à claap-agent ou perso-agent

Demande de Robin (30/10/2026) : sur la montre, dicter un message qui arrive dans une session
Kova, `claap-agent` ou `perso-agent`. Rien de plus en v1.

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

## Fichiers

| Partie | Fichier |
|---|---|
| Route | `packages/protocol/src/routes.ts` (`sessionText`), `daemon/src/kova/sessionText.ts`, `daemon/src/server/index.ts` |
| Tests | `daemon/test/sessiontext.test.ts` |
| Relais iPhone | `app/modules/watch-relay/` (Swift + `index.ts`), appelé depuis `src/store/credentials.ts` et `src/boot.ts` |
| App montre | `app/targets/watch/` (`expo-target.config.js`, SwiftUI) |

La cible montre est générée par `@bacons/apple-targets` (type `watch`, bundle
`io.claap.kovalink.watch`, embarquée dans l'app iPhone). C'est un changement natif : un build
EAS et un bump de `version`, jamais une OTA seule.

## Plus tard

- Dictée AssemblyAI avec le glossaire de Robin (`GET /v1/voice/stream-token`) : l'audio
  passerait par l'iPhone. La dictée système suffit pour la v1.
- Complication de cadran (cible `watch-widget`) et bouton Action (Ultra, App Intent) pour
  ouvrir directement la dictée.
- File d'attente quand l'iPhone est hors de portée (`transferUserInfo`).
