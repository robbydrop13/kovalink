# kovalinkd, le daemon macOS de KovaLink

Lot 1. Il fait tenir une phrase : **un agent Claude Code finit son tour dans un pane
Kova, l'iPhone de Robin vibre, il lit le dernier echange, il repond ou il interrompt.**

Node 22 + TypeScript, un processus, zero base de donnees. L'etat tient dans
`~/.kovalink/` et le secret maitre dans le trousseau macOS.

## Ce que le lot 1 fait, exactement

1. **Appairage** par QR affiche dans le terminal, jeton HMAC dans le trousseau, TLS par
   `tailscale cert`.
2. **Client IPC Kova** : decouverte du socket par glob `/tmp/kova-*.sock`, croisement
   `ps` pour ecarter les PID recycles, reconnexion, PID qui change.
3. **`subscribe`** et suivi d'etat des panes.
4. **Liste des sessions** avec etat live et badge `permissionMode`.
5. **Detection de fin de tour** : front descendant de `pane-working`, confirme par le
   tail du JSONL, puis push APNs.
6. **Tail incremental du JSONL** et rendu du dernier echange, groupe par `requestId`.
7. **Composer** : envoi de texte via `KeyGate`, assaini, en bracketed paste.
8. **Interrompre**, depuis la liste, la session ou la notification.
9. **Repli monospace** (~30 lignes du pane visible). Pas de xterm.js.

Hors lot 1 : chemin de prompt parse et barre de validation (lot 2), terminal xterm.js
(lot 2), routes fichiers et Share Extension (lot 3). Les types correspondants existent
deja dans `@kovalink/protocol` ; les messages de lot 2 recus par le daemon repondent
`FORBIDDEN_ACTION`, jamais un silence.

## Le declencheur de fin de tour, et pourquoi ce n'est pas `awaiting`

Mesure sur la machine de Robin, 5 panes, plusieurs minutes : **0 evenement
`pane-status`**, `awaiting` reste `false` partout (toutes les sessions tournent en
`bypassPermissions` ou `auto`), contre **33 evenements `pane-working`**.

Le declencheur du lot 1 est donc le **front descendant de `pane-working`**, et il n'est
retenu que si le tail du JSONL confirme un **tour assistant clos** : `stop_reason`
different de `tool_use` ET aucun `tool_use` sans `tool_result`. La double condition
elimine le faux positif d'un outil long qui rend la main brievement.

`awaiting` est relaye aux clients comme information d'etat. Il ne declenche aucun push.

## Securite, les regles qui ne se negocient pas

| Regle | Ou | Test |
|---|---|---|
| `KeyGate` est le point d'entree UNIQUE de toute ecriture vers un pane | `src/kova/keygate.ts` | `test/keygate.test.ts` compte les appelants de `sendKeys`, et `no-restricted-imports` interdit l'import ailleurs |
| Aucun retour chariot ne part sans verification d'etat | `emitText`, garde avant CHACUN des deux appels | `test/keygate.test.ts` |
| `sanitizeFreeText` supprime C0 (ESC compris) et C1, puis emballe en bracketed paste | `src/kova/keygate.ts` | `test/keygate.test.ts`, dont un cas OSC 52 |
| `TermInput` ne transporte jamais de string libre | `packages/protocol/src/messages.ts` | typage `KeyName[]`, table fermee |
| Jeton dans le trousseau macOS, jamais en fichier clair | `src/security/token.ts` | `test/security.test.ts` |
| Jeton jamais dans `Sec-WebSocket-Protocol` ni dans un log | `src/server/index.ts`, `src/logger.ts` | `test/security.test.ts` grep le fichier de log |
| Bind loopback et Tailscale, jamais `0.0.0.0` | `src/security/bind.ts` | `test/security.test.ts` balaye tout `src/` |
| Liste noire en ecriture | `src/security/denylist.ts` | `test/denylist.test.ts`, une assertion par entree |
| Decouverte du socket par glob, croisee avec `ps` | `src/kova/discover.ts` | `test/discover.test.ts`, dont le cas du PID recycle |
| Jamais root | `src/main.ts` | refus au demarrage |

Le sondage des commandes au demarrage ne porte que sur des commandes de **lecture** :
sonder une commande de controle reviendrait a l'emettre sans argument sur l'instance
vivante de Robin.

## Installation

Prerequis : Node 22 (`node -v` doit renvoyer 22.x ; launchd est fige sur le binaire
nvm 22, et les tests de l'app exigent 22.6 ou plus), Tailscale installe et connecte,
MagicDNS et les certificats HTTPS actives dans le tailnet.

```bash
# depuis la racine du depot
npm install
npm run build
```

Configuration minimale, `~/.kovalink/config.json` (cree au premier lancement) :

```jsonc
{
  "port": 8765,
  "tsDns": "macbook-robin.tailnet-xxxx.ts.net",   // nom MagicDNS de ce Mac
  "preventSleep": true,
  "push": { "minWorkingMsForTurnEnd": 60000, "quietHours": true, "onlyValidations": false }
}
```

`tsDns` est obligatoire : c'est le nom pour lequel `tailscale cert` emet le certificat.
Recupere le avec `tailscale status --json | grep -i dnsname`.

`preventSleep` est ECRIT par l'app : l'interrupteur « Garder le Mac eveille » des
Reglages arrive par `push.register` et remplace la valeur du fichier. `quietHours` et
`onlyValidations` sont les defauts tant qu'un appareil n'a pas envoye les siens.

Ce qui tourne en fond, sans commande a lancer :

- **certificat** : verifie une fois par jour, reemis par `tailscale cert` a moins de
  30 jours de l'expiration et recharge a chaud dans les ecouteurs (journal
  `certificat renouvele et recharge a chaud`) ;
- **clients WebSocket** : ping de trame toutes les 20 s, client declare mort apres deux
  pings sans reponse (journal `client WS mort, fermeture et nettoyage`, code 4408) ;
- **anti-veille** : `caffeinate -i -w <pid du daemon>` tant qu'un agent travaille,
  minuterie de 4 h, relache des que plus rien ne travaille ;
- **Kova quitte** : apres 10 s sans socket, `kova down`, liste des panes videe et
  diffusee vide (ecran « Kova n'est pas lance » dans l'app).

Le premier lancement cree le secret maitre dans le trousseau
(`security add-generic-password -s io.claap.kovalinkd -a master`). macOS demandera
peut-etre une autorisation d'acces au trousseau : accepte, et coche "Toujours
autoriser" pour que le LaunchAgent ne bloque pas au demarrage.

## Lancement

En premier plan, pour voir ce qui se passe :

```bash
node daemon/dist/src/main.js run
```

En LaunchAgent (le mode normal) :

```bash
node daemon/dist/src/main.js install     # ecrit le plist et le charge
```

Codes de sortie : `1` erreur de demarrage, `2` `tsDns` absent de la configuration,
`3` certificat TLS indisponible, `4` une instance vivante detient deja le verrou ou le
port, `5` aucun ecouteur n a pu etre ouvert.

L'installeur resout le vrai chemin de `node` (`process.execPath`) plutot que de
supposer `/usr/local/bin/node`, et ecrit
`~/Library/LaunchAgents/io.claap.kovalinkd.plist` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.claap.kovalinkd</string>
  <key>ProgramArguments</key>
  <array>
    <string>/chemin/reel/vers/node</string>
    <string>/chemin/du/depot/daemon/dist/src/main.js</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string><home>/.kovalink</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>KOVALINK_HOME</key><string><home>/.kovalink</string>
    <key>KOVALINK_QUIET</key><string>1</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/><key>Crashed</key><true/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <!-- Session graphique : le trousseau doit etre deverrouille. -->
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string><home>/.kovalink/logs/stdout.log</string>
  <key>StandardErrorPath</key><string><home>/.kovalink/logs/stderr.log</string>
  <key>SoftResourceLimits</key>
  <dict><key>NumberOfFiles</key><integer>4096</integer></dict>
</dict>
</plist>
```

Commandes utiles :

```bash
node daemon/dist/src/main.js status                      # une ligne d etat
launchctl kickstart -k gui/$(id -u)/io.claap.kovalinkd   # recharger
launchctl print gui/$(id -u)/io.claap.kovalinkd          # etat
node daemon/dist/src/main.js uninstall                   # decharger et supprimer
tail -f ~/.kovalink/logs/kovalinkd.log                   # journal
tail -f ~/.kovalink/audit/$(date +%F).jsonl              # journal d'audit
```

Menage au demarrage, puis une fois par jour (CA-129) : les captures
`~/Library/Logs/Kova/pty-capture-<pid>-*.raw` dont le PID n'est ni un socket Kova vivant ni
un processus Kova selon `ps -p <pid> -o comm=` partent dans `~/.Trash`, jamais supprimees.
Chaque deplacement est audite (`maintenance.purge`) et le bilan est dans le journal
(`purge .raw orphelins`). Un fichier modifie depuis moins d'une heure n'est jamais touche.
Le journal porte aussi une ligne `push envoye` par notification acceptee par Expo, avec le
pane, la categorie et l'identifiant de ticket : c'est la mesure de CA-12.

## Appairage de l'iPhone

```bash
node daemon/dist/src/main.js pair
```

Un QR s'affiche, valable **5 minutes, usage unique** (`PAIRING_TTL_MS`, decision de la passe de corrections). L'app le scanne, appelle
`POST /v1/pair/claim`, et recoit son jeton. Le QR est efface de l'ecran des qu'il est
consomme ou expire : le terminal de Robin est un pane Kova, donc tout ce qui s'y
affiche atterrit dans `~/Library/Logs/Kova/pty-capture-*.raw`, un fichier en 0644.

Revocation : `DELETE /v1/pair/devices/:deviceId`, qui coupe aussi les WebSocket
ouverts de l'appareil. Rotation globale : supprimer l'entree du trousseau, tous les
appareils sont deconnectes.

## Surface HTTP et WebSocket du lot 1

```
GET    /health                        sans auth, { ok, protocol } et rien d'autre
POST   /v1/pair/claim                 sans auth, code d'appairage -> jeton
DELETE /v1/pair/devices/:deviceId     revocation immediate
GET    /v1/panes                      liste des panes et onglets
GET    /v1/prompt/:promptRef          route de la Notification Service Extension
POST   /v1/panes/:paneId/interrupt    { nonce }
POST   /v1/panes/:paneId/text         { text, nonce }
GET    /v1/panes/:paneId/screen       repli monospace, ~30 lignes
GET    /v1/sessions/:sessionId/turns  dernier echange reconstruit
WSS    /ws                            temps reel, en-tete Authorization obligatoire
```

## Pieces jointes du chat (docs/15)

L'app televerse chaque piece par les routes d'upload du bloc C, dans
`/tmp/kovalink/attachments/<8 premiers caracteres de la session>/<horodatage>-<nom>`
(`ATTACHMENTS_ROOT` et `attachmentsDir` dans `@kovalink/protocol`), puis envoie par
`/v1/panes/:paneId/text` le texte suivi d'un chemin absolu par ligne, comme le collage
d'image de Kova. Le daemon cree ce dossier de session en 0700 a l'`init` du premier
transfert (`src/fs/attachments.ts`) : c'est la seule creation de dossier du daemon, et
elle ne porte que sur cette racine. Le reste (liste noire, `O_NOFOLLOW`, empreinte au
`complete`, lecture par `fs/read`) est inchange. Mesure sur un pane jetable, Claude Code
v2.1.268 : une image collee ainsi est affichee a Claude sans outil ; un fichier texte
hors du projet passe par `Read` et, en mode `default`, par un prompt de permission.

## Mode vocal (OpenAI Whisper)

L'app enregistre la voix de Robin (m4a) et l'envoie au daemon sur `POST /v1/transcribe`
(corps audio brut, 10 Mo au plus, types `audio/*` seulement, audite sans jamais le texte).
Le daemon appelle OpenAI (`gpt-4o-transcribe`, `POST /v1/audio/transcriptions`, langue
imposee au francais, delai de 120 s) avec une cle lue sur le Mac, et rend le texte a l'app, qui le met
dans le champ de message sans l'envoyer. Avant l'envoi, l'audio est normalise en wav
16 kHz mono par `afconvert` (Whisper refusait certains m4a de l'iPhone) : il passe par un
fichier temporaire prive (dossier `mkdtemp` 0700, fichier 0600), efface dans un `finally`
meme en cas d'erreur. Si la conversion echoue, le fichier d'origine part tel quel. En cas
de refus d'OpenAI, le journal garde le statut HTTP et le message d'OpenAI (jamais la cle ni
le texte), et l'app affiche une raison claire (cle refusee, plus de credits, audio indecodable).

**La cle ne quitte jamais le Mac et n'est jamais dans le depot.** Elle vit dans
`~/.kovalink/openai-key` (une ligne, mode `0600`, surchargeable par
`KOVALINK_OPENAI_KEY_FILE`), une par machine. Elle vient d'un compte OpenAI personnel ou
de celui de l'equipe. Installation en une ligne :

```bash
umask 077 && printf '%s\n' 'VOTRE_CLE_OPENAI' > ~/.kovalink/openai-key
```

Le daemon la relit a chaque transcription : aucun redemarrage n'est necessaire. Sans le
fichier, la route repond `503 TRANSCRIPTION_UNAVAILABLE` avec le chemin a creer, et le
bouton micro de l'app l'affiche tel quel. Une cle refusee par OpenAI (401) rend aussi
`503 TRANSCRIPTION_UNAVAILABLE` ; tout autre echec (audio invalide, 5xx, reseau, delai)
est relaye mot pour mot en `502 TRANSCRIPTION_FAILED`.

## Tests

```bash
npm test          # build puis node --test
npm run lint      # dont no-restricted-imports sur sendKeys
```

Ils tournent sans Kova et sans reseau. Ce qui est couvert : `KeyGate`,
`sanitizeFreeText`, le parseur JSONL, le tail incremental, la decouverte du socket, la
liste noire, le bind, le jeton, la redaction des journaux, le catalogue de categories
de notification, et la detection de fin de tour.

## Deux regimes de connexion IPC, et un seul est persistant

Mesure sur Kova 1.11.0 : **Kova ferme toute connexion inactive depuis exactement 5
secondes**, la connexion d'abonnement exceptee.

| Connexion | Comportement mesure |
|---|---|
| requete simple, puis silence | fermee par Kova a +5 017 ms |
| ouverte sans rien envoyer | fermee par Kova a +5 001 ms |
| `subscribe`, puis silence | toujours ouverte a +20 000 ms, 47 lignes recues |

Consequence sur le code :

- la connexion d'**abonnement** est persistante. Sa fermeture est un vrai incident :
  watchdog de 45 s, backoff, redecouverte du socket, `warn` dans le journal ;
- les connexions de **requete** sont **jetables**, une par requete. Leur fermeture est le
  cas nominal : aucun `warn`, aucun backoff, aucune reconnexion, aucun changement
  d'etat. Une connexion neuve coute 1 ms pour un aller-retour de 16 ms.

Avant cette correction, le daemon reconnectait toutes les 5 secondes et ecrivait de
l'ordre de 4 Mo de journal par jour de pur bruit. Apres : 6 lignes de journal pour une
recette complete, zero avertissement. Deux tests distinguent explicitement le cas
nominal du vrai incident (`test/ipcregimes.test.ts`).

**Regle qui en decoule.** Aucun appel synchrone a un processus externe sur le chemin
d'une requete. `tailscale status --json` est rafraichi en tache de fond et lu depuis un
cache : appele en synchrone, il bloquait la boucle d'evenements assez longtemps pour
faire expirer des requetes IPC et retarder les evenements `subscribe`. Constate pendant
la recette, corrige, teste.

## Instance unique et commande `status`

Un daemon qui tient une assertion d'alimentation, ecrit un journal d'audit et parle a
Kova ne doit pas exister en double. `~/.kovalink/kovalinkd.lock` porte le PID et le
chemin du script. La vivacite est verifiee par croisement `ps -p <pid> -o command=`,
**jamais par `kill(pid, 0)` seul** : les PID sont recycles, c'est la meme regle que pour
les sockets Kova.

**La comparaison porte sur la QUEUE du chemin, pas sur le chemin absolu.** `ps` rend la
commande telle qu'invoquee : `node daemon/dist/src/main.js run` quand on lance depuis la
racine du projet, chemin absolu quand launchd la lance. Comparer le chemin absolu complet
declarait perime un verrou bien vivant, et le verrou **echouait en s'ouvrant** : `status`
annoncait un daemon arrete alors qu'il ecoutait, et une seconde instance demarrait,
echouait sur `EADDRINUSE`, se declarait demarree avec `binds: []` et ecrasait le verrou de
la premiere. Les trois derniers segments (`dist/src/main.js`) sont communs aux deux formes,
et le programme doit en outre etre un `node`. Un test lance les deux formes et exige le
meme verdict.

**Second signal, independant du fichier : le port.** Un `EADDRINUSE` prouve a lui seul
qu'une instance vit, meme si le verrou a ete supprime, corrompu, ou ecrit par une version
anterieure. Les deux signaux se cumulent, comme `awaitingSince` complete le `promptHash`.

**Ordre d'acquisition.** La detection n'ecrit rien. Le verrou n'est pose qu'APRES avoir
reussi a ouvrir au moins un ecouteur, et un verrou vivant n'est jamais ecrase, meme par un
processus qui le croit perime. **Zero ecouteur est une erreur fatale** (code 5) : un daemon
qui se declare demarre sans rien ecouter est un fantome. Une seconde instance sort en
**code 4** avec le PID du titulaire, ou avec le numero de port quand c'est lui qui a
tranche.

```bash
node daemon/dist/src/main.js status
# kovalinkd tourne (pid 42732, v0.1.0), ecoute sur 127.0.0.1, ::1 port 8765,
# kova up (pid 85882), certificat valide jusqu'au Dec  9 14:49:48 2026 GMT
```

L'etat est publie dans `~/.kovalink/state.json` par le daemon en fonctionnement, ce qui
evite tout canal de controle. `status` signale un etat publie perime de plus de 5
minutes plutot que de mentir.

## Trois champs du contrat, et d'ou ils viennent vraiment

**`link` sur `hello.ok` et `daemon.status`** (A11). Il n'existe qu'un chemin reseau,
Tailscale, mais deux regimes : pair a pair direct, ou relaye par un serveur DERP. Le
daemon lit `tailscale status --json`, identifie le pair par l'adresse distante de sa
connexion WebSocket, et repond `{ relay: null }` en direct ou `{ relay: "lhr" }` sinon.
Chaque client recoit l'etat de SA liaison, pas une moyenne du tailnet. Mesure du
2026-09-10 : l'iPhone de Robin passe par le relais de Londres (`CurAddr` vide,
`Relay: "lhr"`), ce qui explique les 139 a 772 ms observes.

**`color` sur `Pane` et `Tab`.** Mesure : Kova 1.11.0 ne renvoie la couleur d'onglet ni
dans `list-tabs` ni dans `list-panes`, et `set-tab-color` est une commande d'ecriture
seule. La valeur existe pourtant : elle est persistee dans
`~/.config/kova/session.json` sous `windows[].tabs[].color`, avec le meme codage
(0 rouge a 5 violet). Le daemon la lit en lecture seule, avec un cache sur `mtime`, et
la joint par POSITION `(window, tab_index)`, seule cle commune aux deux sources. Un
pane herite de la couleur de son onglet, parce que la liste mobile affiche une ligne
par pane. Consequence assumee : Kova ecrit ce fichier periodiquement, la pastille peut
donc accuser quelques secondes de retard. C'est une decoration, pas une donnee de
decision.

**`resume` sur `hello`.** L'app annonce l'etag du dernier instantane qu'elle a en
cache. S'il correspond encore, `panes.subscribe` repond `ack` au lieu de renvoyer la
liste. L'etag porte l'identifiant de l'instance du daemon (`Kny9Aw-3`), sans quoi un
daemon redemarre repartirait de `1` et un etag garde par l'app pourrait coincider avec
un etat different.

## Ecarts constates par rapport aux documents de conception

- Le paquet npm du SDK push Expo s'appelle **`expo-server-sdk`**, pas
  `@expo/server-sdk` (qui n'existe pas sur le registre). Version retenue : `^6`.
- **Ne jamais sonder `subscribe` sur la connexion de requetes** : cela la transforme en
  flux d'evenements et desynchronise toutes les reponses suivantes. Mesure faite contre
  l'instance vivante.
- `mode: "scrollback"` reste interdit (A15), il renvoie zero octet sur un pane agent.
- La couleur d'onglet n'est PAS exposee par l'IPC, contrairement a ce que laissait
  supposer la presence de `set-tab-color`. Elle vient du fichier de session.
- `tailscale cert` echoue tant que les certificats HTTPS ne sont pas actives dans la
  console d'administration du tailnet. Le daemon s'arrete alors proprement, code de
  sortie 3, avec le lien exact a ouvrir, et sans trace d'appel.
