# KovaLink, application iOS

Application Expo / React Native qui pilote les sessions Kova du Mac depuis un iPhone.

**Le scénario que ce code sert :** l'agent finit son tour, l'iPhone vibre, Robin ouvre, lit le
dernier échange, envoie l'instruction suivante, ou interrompt. Il n'a pas ouvert son Mac.

Ce n'est pas le scénario de la validation. Mesure de D1 dans `docs/09-decision-finale.md` : sur
la machine de Robin, `pane-status.awaiting` ne se lève jamais, parce que toutes ses sessions
tournent en `bypassPermissions`. Le déclencheur réel est le front descendant de `pane-working`,
et le chemin critique va de la notification au rendu du dernier échange, puis au composer.

## Périmètre livré

| Bloc | Ce qui est implémenté | Où |
|---|---|---|
| Appairage | QR, jeton en trousseau, TLS validé par la chaîne système | `app/pair.tsx`, `src/store/credentials.ts` |
| Liaison | WebSocket, reprise par etag, ping avec signal de premier plan | `src/net/ws.ts`, `src/net/connection.ts` |
| Sessions | Liste live, sections EN ATTENTE / TRAVAILLE / INACTIF, « Kova n'est pas lancé », appui long `Ouvrir sur le Mac` | `app/index.tsx`, `src/features/sessions/` |
| Session | Bandeau d'état de l'agent, dernier échange, texte pleine largeur, actions en lignes compactes avec leur état, historique à la demande, `Non confirmé` à 20 s | `app/session/[paneId].tsx`, `src/features/chat/` |
| Terminal | Repli monospace alimenté par `pane.screen` toutes les 2 s, pavé numérique | `src/features/terminal/` |
| Composer | Trois régimes, file d'attente hors ligne, renvoi d'un message en échec | `src/features/chat/Composer.tsx`, `src/actions/sendText.ts` |
| Pièces jointes | Bouton « + » (Photos, Appareil photo, Fichiers), vignettes retirables, téléversement par la file de transferts AVANT le texte, message = texte puis un chemin absolu par ligne, vignettes dans la bulle, même file hors ligne que le texte (docs/15) | `src/features/chat/attachments.ts`, `src/features/chat/AttachmentViews.tsx`, `src/actions/attachments.ts` |
| Interrompre | Liste, session, barre de validation, notification | `src/actions/interrupt.ts` |
| Notifications | Catégories statiques dérivées du protocole, NSE, actions rapides, une bannière par pane | `src/notifications/`, `targets/notification-service/` |
| Fichiers | Navigation, aperçu, envoi par morceaux avec reprise, SHA-256 calculé sur l'iPhone, seuil cellulaire, journal d'accès | `app/files/`, `src/features/files/`, `src/store/transfers.ts` |
| Partage | Share Extension iOS vers le Mac | `app/share.tsx`, `targets/share/` |
| Réglages | Validations seulement, heures calmes, anti-veille du Mac, révocation, bloc Activité | `app/settings.tsx` |

Le chemin de prompt parsé (barre de validation à options) est câblé de bout en bout depuis
la fusion de `lot2/prompt-parse` : le daemon lit l'écran, hache la question et n'émet qu'un
seul `send-keys`. Quand l'écran n'est pas lisible, la barre s'affiche en `unparsable`, et
c'est voulu.

**Absents, volontairement :** xterm.js, sous-agents, sessions fermées, coloration syntaxique,
diffs teintés, `Nouvelle session`. Un bouton mort est pire qu'un bouton absent.

## Installation et développement

Node 22.6 ou plus (Metro l'exige, et `npm test` s'appuie sur le dépouillement natif des
types). Le fichier `.npmrc` fige deux réglages sans lesquels `npm install`
produit un autre arbre : `legacy-peer-deps` (un conflit de pairs `react-dom` / `react` hérité
du SDK) et `install-links=false` (voir « Le protocole partagé »).

```bash
cd app
npm ci
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm test               # node --test, voir « Tests »
npm run check          # les trois
npm start              # reconstruit le protocole, vide le cache Metro, lance Expo Go
```

### Le protocole partagé et le cache Metro

`src/protocol/index.ts` ne contient qu'une ligne, `export * from '@kovalink/protocol'`. Aucun
type ni identifiant du protocole n'est redéclaré dans l'app : les routes, les catégories de
notification, la jointure `tool_use` vers `tool_result`, les TTL, les codes de fermeture
WebSocket viennent tous de `packages/protocol`.

`app/node_modules/@kovalink/protocol` est un **lien symbolique** vers `../packages/protocol`.
Ce n'était pas le cas avant : `npm install` en faisait une copie (réglage `install-links`), et
après un changement de protocole l'app compilait contre l'ancienne version jusqu'au prochain
`npm install`, en silence. Le `.npmrc` fige `install-links=false`, et `metro.config.js`
ajoute `packages/protocol` aux dossiers surveillés par Metro, sans quoi le bundle échoue sur un
module introuvable derrière le lien.

Après un changement dans `packages/protocol`, deux choses :

1. reconstruire le paquet : `npm run protocol:sync` (c'est `npm run build` à la racine, qui
   émet `packages/protocol/dist`) ;
2. relancer Metro avec le cache vidé : le cache de transformation garde l'ancienne version
   du module, et le lien symbolique n'y change rien.

`npm start` fait les deux (`expo start --go --clear`). À la main, avec l'hôte Tailscale pour que
l'iPhone joigne le Mac :

```bash
pkill -f "expo start"
REACT_NATIVE_PACKAGER_HOSTNAME=mon-mac.tailnet-xxxx.ts.net npx expo start --go --clear
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&hot=false&transform.routerRoot=app"
```

Le `curl` doit répondre `200` : c'est la vérification que le bundle compile, sans téléphone.

### Expo Go, ou un vrai build

`npm start` lance **Expo Go** (`--go`). C'est le mode de développement quotidien, et tout ce qui
est listé plus haut y fonctionne, sauf ce qui exige un binaire natif propre à l'app :

| Exige un build | Pourquoi |
|---|---|
| Notifications distantes (jeton Expo, catégories, badge, actions rapides, NSE) | Le push distant a été retiré d'Expo Go depuis le SDK 53 |
| Share Extension (partager un fichier depuis une autre app vers le Mac) | Expo Go n'embarque aucune cible iOS supplémentaire |
| Schéma `kovalink://` | Dans Expo Go, l'app vit sous `exp://<hôte>:8081/--/…` ; le daemon envoie donc un chemin, et l'app reconstruit l'URL avec `Linking.createURL` |
| Trousseau partagé avec la NSE (`extra.keychainAccessGroup`) | Un groupe d'accès n'existe que signé |

`src/env.ts` détecte Expo Go et l'app dégrade proprement : rien n'est demandé, un bandeau
l'explique dans Sessions, Réglages et à la fin de l'appairage. Le reste fonctionne, y compris
l'anti-veille et les réglages, qui passent par le WebSocket et non par le push.

### L'accès au disque du Mac : à accorder au binaire Node, pas à Kova

Le bloc Fichiers lit `~/Desktop`, `~/Documents`, `~/Downloads`. Sous macOS, ces dossiers sont
protégés par TCC et le processus qui les lit doit avoir « Accès complet au disque ». Ce
processus est le **daemon**, c'est à dire le binaire `node` lancé par launchd, pas Kova, pas
le terminal, pas l'app. Le daemon n'est pas signé : macOS ne propose donc jamais l'autorisation
tout seul, il refuse en silence, et le premier `fs/list` renvoie « Accès refusé par macOS ».

À faire une fois, dans Réglages Système, Confidentialité et sécurité, Accès complet au disque :
ajouter le binaire exact que le plist lance, c'est à dire
`~/.nvm/versions/node/v22.23.2/bin/node` (voir ci dessous pour ce chemin). Un autre `node`
(Homebrew, une autre version nvm) n'hérite de rien.

### Le chemin nvm figé dans le plist launchd

`node daemon/dist/src/main.js install` écrit `~/Library/LaunchAgents/io.claap.kovalinkd.plist`
avec le chemin **réel** de Node au moment de l'installation, aujourd'hui
par exemple
`~/.nvm/versions/node/v22.23.2/bin/node`. launchd ne connaît pas nvm.
Conséquences :

- `nvm install` ou `nvm uninstall` de cette version casse le daemon en silence : launchd le
  relance en boucle toutes les 10 s (`ThrottleInterval`) et l'app affiche « Mac injoignable » ;
- l'autorisation d'accès au disque est attachée à ce binaire précis, elle est à refaire après
  un changement de version.

Après un changement de Node : `node daemon/dist/src/main.js install` à nouveau (il réécrit le
plist avec le nouveau chemin), puis l'accès au disque pour le nouveau binaire.

### Avant le premier build, trois valeurs à renseigner

Elles sont volontairement laissées en clair dans les fichiers de configuration, avec des
marqueurs `REMPLACER_`, plutôt que devinées :

1. `app.json`, `extra.eas.projectId` et `updates.url` : identifiant du projet EAS, obtenu par
   `eas init`.
2. `app.json`, plugin `@bacons/apple-targets`, `appleTeamId` et `eas.json`, `submit.production.ios`
   (`ascAppId`, `appleTeamId`) : compte Apple Developer de Claap.
3. `app.json`, `extra.keychainAccessGroup` : `<AppIdentifierPrefix>.io.claap.kovalink`, c'est à
   dire l'identifiant d'équipe suivi du bundle. C'est ce qui permet à la Notification Service
   Extension de lire le jeton court et le nom MagicDNS dans le trousseau partagé. Laissé à
   `null`, l'app fonctionne, mais la NSE retombe systématiquement sur son état 3 : bannière
   « La question n'a pas pu être récupérée », sans aucune action d'option. C'est un chemin
   spécifié et sûr, pas un crash.

## Build et distribution

Xcode n'est pas installé sur la machine : `eas build --local` et `expo run:ios` sont
impossibles. Tout passe par les builds EAS dans le cloud, qui gèrent aussi les certificats et
la clé APNs.

```bash
source app/scripts/eas-env.sh              # à chaque nouveau shell, voir ci-dessous
eas init                                   # une fois
eas build -p ios --profile development     # client de développement, installé une fois
eas build -p ios --profile preview         # TestFlight interne, canal rapide
eas build -p ios --profile production      # TestFlight interne
eas submit -p ios --latest
eas update --channel preview               # OTA
```

### Secrets EAS : hors du dépôt, dans `~/.kovalink`

`eas.json` ne contient que des identifiants non secrets (`appleTeamId`, `ascAppId`). La clé
API App Store Connect et le jeton Expo ne sont jamais versionnés : `scripts/eas-env.sh` les
lit dans `~/.kovalink` (ou `$KOVALINK_HOME`) et exporte les variables que `eas-cli` consulte.

| Fichier | Contenu | Variables exportées |
|---|---|---|
| `~/.kovalink/asc-api.json` | `{"keyId": "…", "issuerId": "…", "keyPath": "/chemin/vers/la-cle-asc.p8"}` | `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, `EXPO_ASC_API_KEY_PATH` |
| `~/.kovalink/expo-token` | jeton d'accès Expo, une ligne | `EXPO_TOKEN` |
| `eas.json` (versionné) | `submit.production.ios.appleTeamId` | `EXPO_APPLE_TEAM_ID`, `EXPO_APPLE_TEAM_TYPE=COMPANY_OR_ORGANIZATION` |

Le script est à **sourcer**, pas à exécuter, sous zsh ou bash. Il échoue proprement si
`asc-api.json` manque ; sans `expo-token`, il prévient et `eas login` reste possible.
Vérification : `source app/scripts/eas-env.sh && npx eas-cli whoami`.

`runtimeVersion.policy` vaut `fingerprint` : l'empreinte inclut la NSE, la Share Extension et
les config plugins, donc une mise à jour OTA ne peut pas s'appliquer à un build natif
incompatible. Une politique `appVersion` provoquerait des crashs au lancement.

## Mode vocal

Le bouton micro de la barre de message enregistre tant qu'on le maintient (niveau et
durée affichés, glisser vers la gauche annule), envoie l'audio au daemon à la relâche, et
le texte transcrit remplace le contenu du champ : Robin relit et appuie sur Send. La
transcription est faite par Gladia **depuis le Mac** : la clé se place dans
`~/.kovalink/gladia-key` sur le Mac (`0600`, une par machine, jamais dans le dépôt, voir
`daemon/README.md`) ; sans elle, le daemon répond `TRANSCRIPTION_UNAVAILABLE` et le bouton
l'explique.

```bash
umask 077 && printf '%s\n' 'VOTRE_CLE_GLADIA' > ~/.kovalink/gladia-key
```

L'enregistrement passe par `expo-audio`, un module natif : il faut un build qui le
contient (dépendance et permission micro déclarées dans `app.json`). Sur un build qui ne
l'a pas, le module est chargé paresseusement et le bouton dit que le mode vocal arrive
avec le prochain build, sans rien casser. Le fichier audio temporaire de l'iPhone est
supprimé après l'envoi.

## Tests

`npm test` lance le lanceur natif de Node (`node --test`) sur `test/*.test.ts`. Node 22.6 ou
plus dépouille les types lui même (`nvm use 22` d'abord, le nvm par défaut de la machine est
en 20 et le lanceur le dit) ; le seul outillage est `test/loader.mjs`, un crochet de
résolution de vingt lignes pour l'alias `@/` et les imports sans extension. Aucune dépendance
de test.

Seules les fonctions **pures** sont testées, jamais un composant ni un module natif Expo.
C'est un choix : les bugs de l'app ont vécu dans ces fonctions, pas dans le rendu.

| Fichier | Ce qu'il prouve |
|---|---|
| `session.test.ts` | `withoutEchoed` : le doublon de message (bulle locale plus écho du transcript) ne revient pas ; `merge` : un tour est remplacé, jamais dupliqué, un append vide ne perd rien ; la jointure `tool_use` / `tool_result` du protocole ; `unconfirmed` à 20 s |
| `outbox.test.ts` | `purgeExpired` : une réponse de validation de plus de 60 s est abandonnée, borne incluse, idempotente ; `pending` et `countPending` sur un store en mémoire |
| `sha256.test.ts` | L'empreinte incrémentale vaut celle de `node:crypto` à toutes les longueurs et par tranches |
| `toolLabel.test.ts` | Verbe, cible et `+n -m` des lignes d'action ; « en cours » seulement si le pane travaille |
| `segments.test.ts` | Découpage d'un tour en texte, groupes d'actions, réflexion |
| `statusLabel.test.ts` | Priorité des états du bandeau : fermée, hors ligne, attend, travaille, terminé |
| `bannerMatch.test.ts` | Reconnaissance du pane visé par une bannière (CA-14) |

Pour rendre l'outbox testable, SQLite est un adaptateur d'un `OutboxStore` de quatre méthodes
(`src/db/outbox.ts`), et `expo-sqlite` est importé paresseusement (`src/db/index.ts`).

## Ce qui est non négociable dans ce code

Ces règles ne sont pas des préférences de style. Les changer change la surface de risque du
produit, et chacune est commentée à l'endroit où elle s'applique.

- **Catégories de notification pré-enregistrées statiquement au lancement**
  (`src/notifications/categories.ts`), dérivées de la table du protocole, jamais réécrites par
  la NSE. Ré-enregistrer une catégorie depuis une extension n'est pas une capacité documentée
  par Apple. La NSE réécrit uniquement le **corps** de la bannière.
- **Aucune saisie de texte libre depuis une notification.** `UNTextInputNotificationAction`
  n'apparaît nulle part. Taper `1` puis Envoyer depuis un iPhone verrouillé approuverait
  l'option 1 sans Face ID, sans `promptHash` et sans relecture du pane.
- **Face ID sur Approuver uniquement** (`src/actions/faceId.ts`). Rien sur Refuser, rien sur
  Interrompre. Exiger Face ID sur le geste défensif pousse à approuver par facilité.
- **Composer verrouillé quand un prompt parsé est ouvert** (`src/actions/sendText.ts`). Le
  verrou existe aussi côté daemon : l'app évite la frustration, le daemon garantit qu'aucun
  chiffre déguisé en phrase ne part.
- **Jeton dans `expo-secure-store`**, accessibilité `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, jamais
  dans AsyncStorage, jamais dans une URL, jamais dans `Sec-WebSocket-Protocol`.
- **Budget de 4 actions de notification**, `Interrompre` jamais retiré. Au delà de 3 options,
  la bannière retombe sur `KL_AWAITING_BLIND` sans aucune action d'option.
- **Le chiffre du badge d'un bouton EST l'`optionIndex` envoyé** (`OptionButton.tsx`). S'ils
  divergent, c'est un bug bloquant.
- **Aucun bouton d'approbation sur la liste des sessions.** Approuver exige d'ouvrir et de lire.
- **TTL de 60 s sur une réponse de validation en file** (`src/db/outbox.ts`). Au delà, elle
  n'est jamais envoyée.
- **Les trois réglages traversent la frontière** (`prefsForDaemon` dans `src/net/connection.ts`),
  dérivés du type `Prefs` entier : un réglage stocké sur l'iPhone et jamais transmis est un
  placebo, et « Garder le Mac éveillé » en a été un.
- **Le signal de premier plan part dans chaque ping** (`foregroundPaneId`). Le daemon ne
  supprime une notification de fin de tour que si un client vivant regarde ce pane depuis
  moins de 60 s ; un téléphone verrouillé envoie `null`.

## Robustesse au démarrage et diagnostic

L'app ne doit jamais afficher un écran blanc. Trois mécanismes s'en chargent.

1. **Frontière d'erreur racine** (`src/ui/RootErrorBoundary.tsx`) autour de tout l'arbre,
   providers compris, plus la frontière d'expo-router exportée par `app/_layout.tsx` pour les
   erreurs de route. Les deux affichent le message, une pile tronquée et un bouton Réessayer.
2. **Séquence de démarrage isolée** (`src/boot.ts`) : chaque étape est protégée
   individuellement. Une connexion qui échoue mène à l'écran Sessions en mode dégradé, jamais
   à un blocage. Un délai maximal de 12 s sur l'état `loading` mène à un écran d'erreur
   actionnable plutôt qu'à un squelette éternel.
3. **Traces `[KovaLink boot]`** à chaque étape, visibles dans le journal Metro. Elles disent
   où le démarrage s'arrête.

**Le portillon d'appairage vit dans une route, jamais dans le layout racine.** Le layout racine
rend TOUJOURS un navigateur dès le premier rendu. La raison est écrite en tête de
`app/_layout.tsx` : un `<Redirect>` rendu à la place du navigateur rend `null` et attend une
navigation montée qui n'existera jamais, ce qui produit un écran blanc parfaitement silencieux.

## Architecture

```
app/                        routes expo-router
  _layout.tsx               thème sombre, badge d'icône
  index.tsx                 Sessions, état « Kova n'est pas lancé », appui long Ouvrir sur le Mac
  pair.tsx                  appairage, 4 étapes de vérification
  session/[paneId].tsx      écran central : bandeau d'état, dernier échange, historique, Term
  prompt/[promptRef].tsx    cible du lien profond des notifications
  settings.tsx              réglages, bloc Activité
  activity.tsx              journal des accès fichiers du Mac
  files/, share.tsx         bloc Fichiers et cible de la Share Extension
src/
  protocol/index.ts         export * from '@kovalink/protocol', rien d'autre
  theme/                    tokens du design, un seul fichier, sombre uniquement (A9)
  net/                      http.ts, ws.ts, connection.ts, files.ts
  store/                    zustand : credentials, connection, panes, prompts, session, screen, prefs, files, transfers
  db/                       SQLite : outbox (via OutboxStore) et kv
  actions/                  answer, interrupt, sendText, faceId, outboxRunner
  notifications/            catégories, enregistrement, actions rapides, bannières par pane
  features/chat/            AgentStatus, Bubble, ToolRow, ToolGroup, toolLabel, segments, Markdown, Composer
  features/sessions/        AwaitingCard, SessionRow, openOnMac, useInterrupt
  features/terminal/        MonospaceFallback, NumericKeypad
  features/files/           navigation, aperçu, transferts
  utils/                    sha256 incrémental, temps, haptique, useClock
  ui/                       Txt, Button, LinkPill, StatusGlyph, états dégradés
test/                       node --test, fonctions pures uniquement
targets/                    NSE et Share Extension, en Swift
metro.config.js             ajoute packages/protocol aux dossiers surveillés
```

## Écarts assumés par rapport aux documents

1. **Versions.** `03-architecture.md` annonce `expo-router` v6. Le SDK courant est Expo 57 avec
   React Native 0.86 et `expo-router` 57, et c'est ce qui est installé.
2. **Cache.** Le document prévoit deux tables SQLite plus un fichier JSON. L'instantané des
   panes, les préférences et les compteurs vivent dans une table `kv` de la même base.
3. **Écritures en HTTP.** `answer`, `interrupt` et `sendText` passent par les miroirs HTTP des
   routes, y compris depuis l'interface. Une action rapide de notification n'a pas le budget
   d'une poignée de main WebSocket, et un seul chemin d'écriture vaut mieux que deux. Le
   WebSocket porte ce qui est vivant : panes, session, écran du pane, `focus-pane`, réglages.
4. **Repli monospace à 2 s** et non 1 Hz : le daemon plafonne `screen` à 60 lectures par
   minute et par appareil.
5. **`Lancer Kova`** appelle `POST /v1/kova/launch` : le daemon exécute `open -a Kova`, la
   liste se remplit d'elle même quand le socket réapparaît. Aucun état n'est relu par l'app.
6. **Barre d'action basse de l'écran Sessions** (`Nouvelle`) et segment `Fich` de l'écran de
   session : non rendus, plutôt qu'affichés morts.
7. **Cinquième entrée des Réglages**, « Journal des accès fichiers » : elle mène à l'écran
   Activité prévu par le PRD C7.
