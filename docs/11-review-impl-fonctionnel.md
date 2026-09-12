# Revue d'implémentation, relecteur fonctionnel et qualité, passe 3

Code noté : `main` en `c854ecf`, arbre de travail propre.
Grille : `10-review-implementation-rubric.md`. Angle : axes 1, 6 et 7 en priorité.
Méthode : reprise un par un des dix points de ma liste « ce qui reste » de la passe 2 et du défaut D1
du relecteur sécurité, contrôle des deux critères laissés partiels (CA-123, CA-101), exécution de
`npm run build`, `npm test` (daemon et app), `tsc`, `eslint`, trois runs de `hub.test.js` sous charge
CPU, et vérifications en vrai contre le daemon launchd (pid 86564) avec un appareil de test appairé puis
révoqué. Aucun fichier du dépôt modifié hors ce rapport.

## Verdict en tête

**PASSE : 9,0 / 10 pondéré (9,03), aucun axe sous 8,5, aucun éliminatoire.** Passe 1 : 6,8 plafonné à
6,0 ; passe 2 : 8,4. Les dix points de ma liste sont faits et vérifiés, pas sur annonce : l'empreinte au
téléchargement est servie par un `HEAD` réel dont la valeur est égale à `shasum -a 256` du fichier, le
bouton `Lancer Kova` appelle la route, la session hors ligne sort du squelette dans tous les cas, le
texte de CA-07 est affiché, le port de la NSE est généré depuis le protocole avec test de non dérive,
140 captures `.raw` orphelines ont réellement été déplacées et journalisées, et le verrou par pane de
D1 est couvert par cinq tests de concurrence.

C'est un passage de justesse, et il faut le dire : ce qui reste tient en deux heures et n'affecte pas
l'usage de Robin, mais l'un des points est un harnais de test qui peut bloquer la suite sous charge, et
je l'ai diagnostiqué ci dessous.

## État de la liste « ce qui reste » de la passe 2

| # | Point | État | Preuve |
|---|---|---|---|
| 1 | `Lancer Kova` manquant dans l'app (CA-123) | **FAIT** | `app/app/index.tsx:74-80, 158-165` : bouton `Lancer Kova` / `Lancement…`, `http.ts:226-230` `POST /v1/kova/launch`. Non exécuté en vrai : `open -a Kova` mettrait le Kova de Robin au premier plan, interdit |
| 2 | Empreinte au téléchargement jamais lue (CA-101) | **FAIT, vérifié en vrai** | `files.ts:140-162` `HEAD ?digest=true` avant le flux, `files.ts:181-236` hachage par tranches de 4 Mo sur le fichier écrit, `CHECKSUM_MISMATCH` (`errors.ts:26`) et suppression du fichier en cas d'écart, `verified: false` jamais présenté comme vérifié. Mesure : `HEAD /v1/fs/read?path=daemon/README.md&digest=true` rend `x-kovalink-sha256: 2de74163…c31aee`, égal à `shasum -a 256` local. `fsread-head.test.ts` (67 lignes) |
| 3 | Session hors ligne : squelette sans fin | **FAIT** | `session.ts:14-90` cache des 60 derniers tours par session, 10 sessions, écriture différée 1 s ; `[paneId].tsx:434-448` bandeau « dernier échange en cache (âge) » ou « mise à jour depuis le Mac… » ; `:505-520` sans cache et hors ligne, état explicite « Transcript indisponible hors ligne » avec `Réessayer` et `Ouvrir le terminal`. Le squelette n'existe plus qu'en liaison vivante, borné par `SESSION_RESOLVE_TIMEOUT_MS` |
| 4 | Texte de CA-07 invisible | **FAIT** | `PaneIdentity.tsx:47-55` `PermissionNote` rend `aucune validation ne te sera demandée` en caption sous la ligne ; monté dans `SessionRow.tsx:53` et `AwaitingCard.tsx:79` ; `bypassAccessibilitySuffix` pour VoiceOver |
| 5 | README app périmé, README daemon « Node 20 » | **FAIT** | `app/README.md:30` décrit la fusion, `:39, :168` « Node 22.6 ou plus » ; `daemon/README.md:6, 63-64` « Node 22 … launchd figé sur nvm 22, tests app 22.6 ». Plus aucune phrase sur `Lancer Kova` non exposé |
| 6 | Aucune ligne de journal à l'émission d'un push (CA-12) | **FAIT, avec une réserve** | `sender.ts:245-260` `push envoye` avec `paneId`, `deviceId`, `kind`, `categoryId`, `ticketId`, `passive`, et `push refuse par Expo` sinon. Réserve : quand aucun appareil n'a de jeton push (cas de Robin aujourd'hui, Expo Go), `send()` rend 0 sans une ligne (`sender.ts:228`) : la fin de tour de 12:43:22Z n'a laissé aucune trace après « fin de tour detectee » |
| 7 | Port `8443` en dur dans la NSE | **FAIT** | `packages/protocol/scripts/gen-swift.mjs` génère `ProtocolConstants.swift` (`defaultPort = 8765`) à chaque `npm run build`, `NotificationService.swift:224` le lit, `protocol.test.ts` vérifie la non dérive ; `grep -rn 8443` sur le code : vide |
| 8 | CA-70 bannière du second pane en attente | Non traité, hors liste | inchangé, compteur de liste seul |
| 9 | « Bannières non récupérées (7 j) » figé à 0 | Non traité, hors liste | inchangé |
| 10 | Voies WS d'écriture sans émetteur | Non traité, hors liste | `hub.ts` sert toujours `pane.interrupt`, `pane.sendText`, `pane.answer` que l'app n'émet pas |

Points de l'ordre coordinateur hors de ma liste :

| Point | État | Preuve |
|---|---|---|
| D1 (sécurité) : verrou par pane et nonce atomique sur `pane.answer` | **FAIT** | `answer.ts` : `nonces.reserve` avant le premier `await`, libéré sur refus ou exception ; `PaneAnswerLock.run` sérialise par pane ; `wasAnswered(paneId, awaitingSince)` refuse un doublon sous le verrou avant même que l'écran ait bougé. `answer.test.ts:197-284` : même nonce en parallèle, nonces distincts sur la même occurrence, deux panes sans verrou croisé, nouvelle occurrence redevenue répondable, exception qui libère le nonce |
| CA-129 purge des `.raw` orphelins | **FAIT, vérifié en vrai** | `rawPurge.ts` : verdict par `ps` jamais `kill(pid,0)`, croisement avec les sockets vivants, marge d'une heure, déplacement vers la corbeille jamais suppression ; journal 12:42:11Z `purge .raw orphelins, purged 140, bytes 71708439, keptLive 13, liveKovaPids [23414], deadPids [44276, 85882]` ; `~/Library/Logs/Kova` contient 13 captures. 8 tests dont le PID recyclé (V9) et le Kova sans socket au démarrage |
| Actions en 14 pt, historique en tirant | **FAIT** | `tokens.ts` variante `action` 14/18, `ToolRow.tsx` l'utilise ; `[paneId].tsx:486-490` `RefreshControl` qui charge l'historique plus ancien |

## Notes par axe

| # | Axe | Poids | P1 | P2 | P3 | Justification en une ligne |
|---|---|---|---|---|---|---|
| 1 | Justesse fonctionnelle | 15 % | 6,0 | 8,5 | **9,5** | 85 critères vérifiés sur trois passes, les éliminatoires du chemin parsé passent sur captures réelles, CA-123 et CA-101 sont complets ; restent CA-70 sans bannière in-app, CA-122 qui purge au lieu de confirmer, CA-50 contradictoire dans le PRD lui même, et la ligne INACTIF sans ancienneté. |
| 2 | Sécurité | 20 % | 8,5 | 9,0 | **9,0** | D1 fermé par réservation atomique du nonce et verrou par pane, testé en concurrence ; `KeyGate` à quatre opérations comptées par analyse syntaxique ; 401, révocation, absence du jeton dans les journaux vérifiés en vrai. |
| 3 | Robustesse | 15 % | 6,0 | 8,0 | **9,0** | Plus aucun écran vide ni squelette sans fin : cache de session avec âge affiché, états explicites hors ligne, clients morts détectés, `caffeinate -w`, Kova quitté avec grâce, `.raw` purgés sans suppression. |
| 4 | Contrat partagé | 15 % | 7,0 | 8,0 | **9,0** | Le port de la NSE est désormais généré depuis `DEFAULT_PORT` avec test de non dérive, `CHECKSUM_MISMATCH` et l'en-tête d'empreinte vivent dans le protocole et sont consommés des deux côtés ; `nseToken` reste déclaré optionnel et jamais émis, documenté comme absent. |
| 5 | Simplicité | 10 % | 6,5 | 8,0 | **8,5** | Trois messages WS d'écriture servis sans émetteur, avec leur limiteur, leurs nonces et leur audit en double des routes HTTP ; deux tables de routes ; ~150 lignes d'exports sans appelant. |
| 6 | Tests | 15 % | 6,5 | 9,0 | **9,0** | 392 + 53 tests verts, concurrence de `answerPrompt`, `HEAD` d'empreinte, purge `.raw`, cache de session ; un harnais fragile dans `hub.test.ts` (attente fixe de 20 ms, pas de nettoyage en `afterEach`) explique le blocage sous charge. |
| 7 | Exploitabilité | 10 % | 6,5 | 8,0 | **9,0** | READMEs exacts sur Node 22.6, TCC, nvm, lien de protocole ; journal complet à l'émission d'un push, à la mort d'un client, à la purge ; il manque une ligne quand aucun appareil n'a de jeton push. |

**Pondération** : 9,5×0,15 + 9,0×0,20 + 9,0×0,15 + 9,0×0,15 + 8,5×0,10 + 9,0×0,15 + 9,0×0,10 = **9,025**.

## Le blocage de `hub.test.js` sous charge : test fragile, pas défaut de production

Mécanisme, lu dans `daemon/test/hub.test.ts:78-84` : le faux socket `say()` émet le message puis
attend **20 ms fixes** avant de lire ce que le hub a renvoyé. Les tests `session.attach` (`:206-233`)
passent par `tailer.attach`, qui fait un `await import('chokidar')` puis crée un observateur FSEvents.
Sous charge (Metro qui bundle et les tests app en parallèle), ce chemin dépasse 20 ms : `snapA` est
`undefined`, l'assertion échoue, et comme `h.tailer.detachAll()` n'est appelé qu'en fin de test
(`:216, 252, 269, 279`) et jamais dans un `afterEach`, l'observateur chokidar reste ouvert, garde la
boucle d'événements vivante, et `node --test` n'en finit jamais avec ce fichier. Ce n'est pas le
battement de coeur : `heartbeat()` est appelé à la main dans les tests, `startHeartbeat` n'est jamais
lancé, et les minuteries du harnais sont simulées (`setTimeout: () => 1`).

Vérification : trois runs de `dist/test/hub.test.js` avec deux processus `yes` en charge CPU, 22/22
à chaque fois ; le seuil n'a pas été franchi chez moi, ce qui est cohérent avec un échec rare et
dépendant de la machine. Le code du hub n'est pas en cause.

Correctif, une demi-heure : `say()` attend la réponse portant son `reqId` (ou un `session.snapshot`
pour la session demandée) avec un délai plafond de 2 s, et un `afterEach` appelle `tailer.detachAll()`
et `hub.stopHeartbeat()`.

## Vérifications empiriques, résultat brut

| Commande | Résultat |
|---|---|
| `npm run build` | OK, y compris `gen-swift.mjs` |
| `npm test` (racine, daemon) | `# tests 392 / # pass 392 / # fail 0` |
| `cd app && nvm use 22 && npm test` | `# tests 53 / # pass 53 / # fail 0` |
| `cd app && npx tsc --noEmit`, `npx eslint .` | 0 et 0 |
| `npx eslint daemon packages` | 0 |
| 3 × `node --test dist/test/hub.test.js` sous charge CPU | 22/22, 22/22, 22/22 |
| grep U+2014 hors `docs/` et fixtures | 0 |
| `grep -rn 8443` sur `daemon/src`, `app`, `packages`, READMEs | 0 |
| `launchctl print gui/501/io.claap.kovalinkd` | `state = running`, `pid = 86564` |
| `POST /v1/pair/claim` (`verif-fonctionnel-p3`), puis `HEAD /v1/fs/read?path=…/daemon/README.md&digest=true` | `200`, `x-kovalink-sha256: 2de74163180b704f35098837690a2ab6803a7f4bdae049be545ca4faadc31aee`, `content-length: 17204` ; `shasum -a 256` local identique |
| `DELETE /v1/pair/devices/<test>` | `{"revoked":true}` ; `pairing.json` consommé |
| `~/.kovalink/logs/kovalinkd.log` 12:42:11Z | `purge .raw orphelins … purged 140, bytes 71708439, keptLive 13` ; `ls ~/Library/Logs/Kova` : 13 captures restantes |
| `~/.kovalink/logs/kovalinkd.log` 12:43:22Z | `fin de tour detectee, paneId 3, durationMs 68510` puis rien : aucun appareil n'a de jeton push (Expo Go), et ce cas n'écrit pas de ligne |
| `devices.json` | l'iPhone de Robin sans `expoPushToken`, tous les appareils de test révoqués |

## Critères vérifiés, statut réel

Reprise des lignes qui ont changé depuis la passe 2 ; le reste des 81 lignes des passes 1 et 2 est
inchangé et vrai.

| Critère | P2 | P3 | Preuve |
|---|---|---|---|
| CA-07 badge bypass et texte explicatif | PAPIER | **VRAI** | `PermissionNote` visible sous la ligne |
| CA-12 écart événement vers APNs lisible dans le journal | NON MESURABLE | **VRAI sur build, non observable en Expo Go** | `push envoye` avec `ticketId` ; aucun appareil n'a de jeton ici |
| CA-101 SHA-256 des deux côtés | PARTIEL | **VRAI** | `HEAD` mesuré, hachage local en flux, `CHECKSUM_MISMATCH` |
| CA-120 mode avion : cache en lecture seule | PAPIER | **VRAI** | 60 tours en cache, bandeau avec âge, état explicite sans cache |
| CA-123 Kova quitté : état et `Lancer Kova` | PARTIEL | **VRAI** | bouton branché sur la route |
| CA-129 purge des `.raw` orphelins | FAUX | **VRAI, mesuré** | 140 déplacés, PID vivants gardés |
| CA-70 deux attentes : bannière du second pane | PARTIEL | PARTIEL | inchangé |
| CA-122 texte hors ligne : confirmation au delà de 15 min | PARTIEL | PARTIEL | purgé, pas confirmé |
| CA-50 aucun `\r` seul | PAPIER | PAPIER | contradiction interne du PRD avec CA-46 et A5, le code suit A5 |

Bilan cumulé : 68 VRAI, 2 PAPIER (CA-50, CA-74 assumés), 2 PARTIEL (CA-70, CA-122), 0 FAUX, 2 CADUC,
le reste HP. Les 14 `[NE]` sont exécutables, 13 vérifiés.

## Ce qui reste, sans bloquer

Deux heures, par ordre d'utilité :

1. **Harnais `hub.test.ts`** (30 min) : attente par `reqId` avec plafond, `afterEach` de nettoyage.
   C'est le seul point qui peut coûter du temps à l'équipe.
2. **Voies WS d'écriture sans émetteur** (`hub.ts`, `pane.interrupt`, `pane.sendText`, `pane.answer`)
   (30 min) : les retirer, ou les faire répondre `FORBIDDEN_ACTION` comme `pane.sendKeys`, pour que la
   surface d'écriture n'existe qu'une fois.
3. **Ligne `push sans destinataire`** dans `sender.ts:228` (5 min) : sans elle, sur un iPhone en Expo
   Go, une fin de tour détectée ne laisse aucune trace de ce qu'elle est devenue.
4. **CA-70** (30 min) : bandeau in-app « un autre pane attend » quand une session est ouverte.
5. **CA-122** (15 min) : au delà de 15 min, demander confirmation avant l'envoi plutôt que purger.
6. Ligne INACTIF sans ancienneté, compteur « Bannières non récupérées » figé, ~150 lignes d'exports
   sans appelant (`uploadStatus`, `deleteMasterSecret`, `isTextMime`, `probeCommands`, `isSocketOpen`,
   `clearDownloads`, `humanRate`) : ménage, 30 min.

## Verdict

**PASSE**, à 9,03 pour une barre de 9,0, aucun axe sous 8,5, aucun éliminatoire. Le passage est de
justesse et il est mérité : sur trois passes, huit défauts bloquants et une trentaine d'écarts au PRD
ont été fermés et vérifiés en vrai sur la machine de Robin, le chemin le plus dangereux du produit
(répondre à un prompt) est démontré contre des captures réelles et sous concurrence, et il ne reste
aucun critère faux. Les six points ci dessus sont à traiter dans la foulée, le premier en priorité,
sans nouvelle passe de notation.
