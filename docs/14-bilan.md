# Bilan KovaLink, 11 septembre 2026

## Verdict du panel

| Etape | Passe 1 | Passe 2 | Passe 3 | Verdict |
|---|---|---|---|---|
| Specs (PRD, design, archi) | 7,40 | 8,43 | 8,61 (un PASSE a 9,05) | Robin a decide d'avancer |
| Implementation, securite | 7,55 | **9,20** | | **PASSE** |
| Implementation, fonctionnel | 6,0 | 8,4 | **9,03** | **PASSE** |

Chaque passe a ete faite par des relecteurs adverses qui ont rejoue les contournements
en conditions reelles contre le daemon, pas sur annonce.

## Ce qui est livre et utilise

- Appairage par QR ou code, jeton en trousseau, TLS Let's Encrypt via `tailscale cert`.
- Liste des sessions Kova avec etat live, badge bypass, interruption depuis la liste.
- Chat : bandeau d'etat, texte sans bulle, actions en lignes compactes avec resultats
  rattaches, point pulsant, trois derniers echanges d'abord, cache hors ligne.
- Composer a trois regimes, barre de validation branchee sur de vrais prompts captures.
- Fichiers : navigation complete du Mac, apercu, telechargement avec empreinte, envoi
  avec reprise, destinations rapides depuis les projets recents de Kova.
- Daemon en service launchd, detection de fin de tour, clients morts detectes,
  certificat renouvele a chaud, purge des captures orphelines, acces disque complet
  accorde au binaire Node signe (Kova ne l'est pas).
- 393 tests daemon, 59 tests app.

## Ce qui attend le compte Apple (Team ID et identifiant App Store Connect)

- Notifications push : tout le code est ecrit, jamais execute.
- Share Extension : idem.
- Premier build EAS et TestFlight : configure, valeurs `appleTeamId` et `ascAppId` a
  renseigner dans `app/app.json` et `app/eas.json`.

## Reste non bloquant : fait le 11 septembre, en une passe

| Point | Etat | Ou |
|---|---|---|
| Harnais de `hub.test.js` fragile sous charge | **Fait.** `say()` attend la reponse qui porte son `reqId` (ou l'instantane pousse sans identifiant), plafond 2 s ; `afterEach` appelle `detachAll()` et `stopHeartbeat()`. La suite passe de 2,6 s a 0,6 s, et 3 runs sous charge CPU avec les tests app en parallele finissent a chaque fois. Le diagnostic du panel est confirme : avec l'ancienne attente fixe, `close()` partait avant que `chokidar` ait cree son observateur, qui restait vivant | `daemon/test/hub.test.ts` |
| Trois messages WS d'ecriture sans emetteur | **Retires du protocole.** `pane.answer`, `pane.interrupt`, `pane.sendText` et `action.result` n'existent plus ; le hub repond `BAD_REQUEST` a qui les emettrait encore, et `keygate.test.ts` verifie que `server/index.ts` est le seul appelant de KeyGate. La reponse des routes HTTPS d'ecriture est `ActionResponse`, declare dans le protocole et consomme des deux cotes (l'app avait sa copie `AppliedResult`) | `packages/protocol/src/messages.ts`, `errors.ts`, `daemon/src/server/hub.ts` |
| Journal sans destinataire push | **Fait.** `push sans destinataire` en `info` avec `paneId`, `kind`, `categoryId`, `reason: aucun_jeton_push`, `pairedDevices` (revoques exclus). Teste | `daemon/src/push/sender.ts` |
| CA-70, banniere du second pane | **Fait.** Sur l'ecran de session, une banniere `Un autre pane attend : projet · onglet` avec `Voir` (ou `N autres panes attendent` vers la liste). La question affichee reste celle du pane ouvert | `app/app/session/[paneId].tsx` |
| CA-122, confirmation au dela de 15 min | **Fait.** Un texte en file depuis plus de 15 min n'est plus purge : `purgeExpired` ne jette que les reponses et interruptions, `pending` ne l'envoie pas, `staleTexts` le liste, et l'ecran montre chaque message avec son age et deux choix, `Envoyer` (15 min neuves, meme nonce) ou `Abandonner`. Testes | `app/src/db/outbox.ts`, `app/src/features/chat/StaleQueue.tsx` |
| Exports morts | **Fait.** Six fonctions sans appelant supprimees (`humanRate`, `clearDownloads`, `isSocketOpen`, `uploadStatus`, `isTextMime`, `deleteMasterSecret`), `isNotificationCategory` retire du protocole, `isBypass` de l'app remplace par `isBypassMode` du protocole, 48 fonctions et constantes n'utilisees que dans leur fichier ne sont plus exportees. Gardes dans le contrat, desormais consommes : `PairClaimRequest`, `UploadInitRequest`, `UploadOffsetMismatch` ; garde et documente : `WsCloseCode`. Inventaire par `ts-prune` (npx) puis grep croise sur les trois paquets, rien ajoute aux dependances | partout |

Retour de Robin traite dans la meme passe, « tu replies trop vite l'historique »
(`docs/13-chat-lisibilite.md`, points 7 a 10) :

- `lastExchange()` ne rendait que le segment depuis le dernier message utilisateur, et
  chaque envoi repliait l'echange precedent. Remplace par `recentExchanges()` : les trois
  derniers echanges, et l'ecran pose un plancher de `seq` a l'ouverture de la session qui
  ne remonte jamais. Un envoi ajoute en bas, il ne replie rien en haut. Tests app : trois
  echanges gardes, un nouvel envoi n'en retire aucun.
- Les groupes d'actions ne se replient qu'au dela de 5 actions (`isCollapsible`, teste), et
  l'etat deplie ou replie a la main est memorise dans le store de session par identifiant
  du premier appel du groupe, jamais par position ; vide quand une autre session s'ouvre.
- Aucun repli dans le temps : rien ne se referme sur un delai ni sur un evenement.

Compteurs : 393 tests daemon, 59 tests app. Observation hors liste : `ipcregimes.test.ts`
(vrais delais avec un faux Kova) a echoue une fois sur trois runs complets juste apres une
charge CPU, puis passe seul et sur deux runs complets suivants ; a surveiller, non traite.

## Decouvertes sur Kova a retenir

- `pane-status.awaiting` ne se leve jamais, ni en fin de tour ni sur un prompt de
  permission. Le daemon synthetise l'attente depuis `pane-working` et une lecture d'ecran.
- Kova ferme toute connexion IPC inactive depuis 5 s, `subscribe` excepte.
- La couleur d'onglet n'est exposee que dans `session.json`, jamais par l'IPC.
- Kova n'est pas signe : une autorisation TCC donnee a Kova ne s'applique pas.
- Le prompt Bash de Claude Code 2.1.268 a 4 options : pas de chiffres en banniere
  d'ecran verrouille pour Bash (regle C30), les boutons sont dans l'app.

## Lecons de methode

- Un panel avec une grille et une barre trouve ce que des audits sans barre manquent.
- Un message d'erreur generique coute des heures : chaque `catch` porte la cause reelle.
- Tout ce qui traverse la frontiere daemon/app vit dans `packages/protocol`, sans
  exception. Chaque fois que cette regle a ete contournee, un bug est apparu.
- Simuler le telephone depuis le Mac (curl, WebSocket) vaut mieux que des allers-retours.
