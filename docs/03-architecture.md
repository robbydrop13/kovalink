# KovaLink, spécification d'architecture technique (passe 3)

> Staff Engineer. Amont : `00-context.md`, `01-prd.md`, `02-design.md`.
> Arbitrages `05-arbitrages.md` (A1 à A16) et ordres de correction `07-corrections.md`
> (C1 à C19) puis `08-corrections-passe2.md` (C20 à C37) appliqués intégralement.
> Aucun arbitrage n'est rouvert.
> Mesures machine faites en lecture seule le 2026-09-10, instance Kova PID 85882.

**La règle centrale de ce document.** Le produit tient dans une phrase : une notification dit
qu'un agent attend, Robin lit la question, il approuve, l'agent repart. Tout ce qui n'est pas
sur ce chemin est en lot 2 ou 3. Tout ce qui pourrait faire approuver la mauvaise action est
traité comme un défaut de sécurité, pas comme un cas limite.

---

## 0. Mesures machine

| Outil | Version |
|---|---|
| macOS | 14.2.1 (23C71) |
| Node / npm / pnpm | v20.20.1 / 10.8.2 / 9.15.9 |
| Expo CLI / EAS CLI | 57.0.23 / 24.0.0 |
| Xcode | **absent** (seuls les Command Line Tools) |
| Tailscale | **absent** (aucune interface en 100.64.0.0/10) |
| bun | absent |

Latences IPC (socket Unix, 10 itérations) :

```
get-pane-content visible, connexion neuve : p50 17,0 ms  p90 21,5 ms  6 043 octets (221x64)
list-panes sur connexion persistante      : 15,8 / 16,4 / 16,6 / 16,8 / 17,5 ms
subscribe, snapshot initial               : 6 ms, 2 644 octets
```

Le plancher à 16 ms est **une frame à 60 Hz** : l'IPC de Kova est traité dans sa boucle de rendu
Metal. Inutile de sonder plus vite, et la reconnexion par requête coûte 1 ms.

Faits vérifiés qui contraignent la conception :

**V1. `list-panes` et `list-tabs` renvoient `data` en tableau direct**, pas `data.panes`.
Le pluriel `panes` n'existe que pour `get-pane-content` et `count-pane-content`, dont les
formes de réponse diffèrent l'une de l'autre.

**V2. Un pane inexistant renvoie `ok:true` avec une erreur par élément.**
```
$ {"cmd":"get-pane-content","panes":[9999],"mode":"visible"}
{"data":{"panes":[{"error":"not found","id":9999}]},"ok":true}
```
Sans `text`, `cols`, `rows` ni `cursor`. Traiter `ok:true` comme un succès casse le rendu.

**V3. Aucune commande de version ou de capacités.**
```
$ {"cmd":"capabilities"} -> {"error":"unknown command: capabilities","ok":false}
$ pasdujson              -> {"error":"invalid JSON: expected value at line 1 column 1","ok":false}
```
`error` est une chaîne libre sans code machine.

**V4. `mode:"scrollback"` renvoie 0 octet sur un pane Claude Code** (écran alterné).
`visible` 10 330 octets, `scrollback` 0, `all` 10 330. Inutilisable comme historique (A15).

**V5. Le JSONL contient 12 types réels**, pas 10. Relevé sur la session courante (263 lignes,
1,0 Mo, ligne la plus longue **132 746 octets**) :
```
assistant 76, attachment 41, user 36, queue-operation 14, permission-mode 14, mode 14,
last-prompt 14, bridge-session 14, atis-latch 14, ai-title 13, system 7, file-history-snapshot 1
```
Aucune énumération ne doit se présenter comme exhaustive.

**V6. Les lignes `assistant` portent `apiBlockIndex`**, ce qui donne un ordre déterministe
à l'intérieur d'un `requestId`. Distribution mesurée : **1 à 5 lignes par `requestId`**
(3 lignes x 10, 2 x 9, 5 x 2, 1 x 3). Aucune hypothèse sur ce nombre.

**V7. Les gros résultats d'outils sont externalisés** dans
`<sessionId>/tool-results/<id>.txt`. Voir V12 : rien dans le JSONL ne relie ces fichiers au
transcript, contrairement à ce que la passe 2 supposait.

**V8. Le `.raw` grossit de 145,2 Ko/min sur un pane actif** (+111 495 octets en 45 s), 0 octet
sur un pane au repos. Flux de redessin plein écran, vérifié à l'octet :
`ESC[1B`, `ESC[199C`, `ESC[?2026h` (synchronized output), `ESC]0;` (titre).

**V9. Les PID sont recyclés, la purge par `kill(pid,0)` est fausse.**
Cinq instances Kova ont laissé des `.raw` (21975, 428, 44276, 488, 85882), une seule vivante.
Le PID 488 est aujourd'hui `sociallayerd` : `kill(488,0)` réussit. 1,1 Go de logs Kova présents.

**V10. `get-pane-content` renvoie du texte déjà nettoyé de l'ANSI**, avec `cols:221 rows:64`.
221 colonnes sur un écran de 6 pouces : le repli monospace doit gérer le débordement.

**V11. Toutes les sessions de Robin tournent en mode qui ne produit jamais de prompt.**
```
dernier permissionMode par projet : "auto", "bypassPermissions", "bypassPermissions",
                                    "auto", "bypassPermissions"
barre d'état du pane 66 dans le .raw : bypass permissions on (shift+tab to cycle)
recherche d'un rendu de prompt réel dans les 58 fichiers .raw :
  "Do you want" -> 0 fichier   "No, and tell Claude" -> 0 fichier
```
Aucun rendu de prompt de permission n'existe sur cette machine. C'est la base du changement de
prémisse (0.1) et la raison pour laquelle la grammaire du parseur est une hypothèse, pas une
mesure.

**V12. Le JSONL ne référence pas les fichiers de `tool-results/`.**
```
grep -c 'tool-results' <session>.jsonl -> 5, toutes des citations dans le texte d'une
                                          conversation, aucune référence de service
grep -c 'by8zqugpa'    <session>.jsonl -> 0   (alors que le fichier existe et porte un résultat)
```
Le dossier existe et contient de vrais résultats d'outils externalisés, mais **aucun marqueur
textuel ni champ ne les relie au transcript**. Toute route promettant le résultat complet est
donc à ce jour inimplémentable.

---

---

## 0.1 Changement de prémisse, validé par Robin

**Toutes les sessions de Robin tournent en `bypassPermissions` ou `auto`** (mesure V11).
Claude Code ne lui demande donc jamais de permission, et l'écran sur lequel reposait le lot 1
de la passe précédente n'est jamais produit sur sa machine.

Ce qui ne change pas : le déclencheur reste `pane-status.awaiting`, qui se lève **aussi bien**
quand l'agent demande une permission que quand il a fini son tour et attend l'instruction
suivante. La chaîne de notification, le daemon, le protocole et la sécurité sont identiques.

Ce qui change : **le lot 1 vise désormais "l'agent a fini, je donne la suite"**. Le rendu du
transcript remonte du lot 2 au lot 1, il est sur le chemin critique. La barre de validation
reste dans le lot 1 comme filet, pour les cas où un prompt survient malgré le mode bypass
(mode plan, question explicite de l'agent), mais elle ne justifie plus le lot.
Conséquence sur le parseur : aucun échantillon réel n'existe, voir 2.3 et C37.

## 1. Schéma d'architecture

```
                      iPhone (Expo / React Native, io.claap.kovalink)
 +----------------------------------------------------------------------------+
 | Notification Service Extension --+  (récupère la question, réécrit la       |
 |   entitlement trousseau partagé  |   bannière, décide des actions rapides)  |
 +----------------------------------+-----------------------------------------+
 | Écran Sessions | Écran Question | Chat (lot 2) | Terminal (lot 2) | Fichiers|
 +----------------------------------------------------------------------------+
 | zustand + instantané JSON + SQLite (turns, outbox)                          |
 +----------------------------------------------------------------------------+
 | fetch + WebSocket standards (certificat tailscale cert, chaîne système)     |
 +---------------------------------+------------------------------------------+
                                   | WSS + HTTPS, Authorization: Bearer
                                   | un seul chemin : Tailscale (direct ou relayé)
                                   v
 +----------------------------------------------------------------------------+
 | kovalinkd  (Node 20 + TypeScript, LaunchAgent, uid robin, jamais root)      |
 |                                                                            |
 | fastify -> auth (jeton HMAC, trousseau macOS) -> audit -> routeur          |
 |     |                                                                      |
 |     +-- KovaIpc ---- conn A : subscribe (flux) ------> /tmp/kova-<pid>.sock |
 |     |                conn B : requêtes sérialisées                    ^     |
 |     |                                                                 |     |
 |     +-- PromptParser <-- get-pane-content visible --------------------+     |
 |     |     question + options + promptHash                             |     |
 |     |     revérifié juste avant émission                              |     |
 |     |                                                                 |     |
 |     +-- KeyGate ----- sanitize + table fermée --> send-keys ----------+     |
 |     |                                                                      |
 |     +-- TranscriptTailer (lot 1) -incrémental-> ~/.claude/projects/*.jsonl  |
 |     +-- PtyStreamer (lot 2) -----seek+tail----> ~/Library/Logs/Kova/*.raw   |
 |     +-- FileEngine (lot 3) --lecture totale, écriture sur liste noire--> /  |
 |     +-- PushSender --HTTPS--> exp.host --> APNs --> iPhone                  |
 |                                                                            |
 | État : trousseau macOS (secret) + ~/.kovalink/{config,devices,audit,logs}   |
 +---------------------------------+------------------------------------------+
                                   v
                     Kova.app (Rust/Metal) -> panes -> claude -> écrit le JSONL
```

Sens des flux et autorité :

| Flux | Sens | Source d'autorité |
|---|---|---|
| État des panes | Kova vers daemon vers iPhone | `subscribe`, poussé, jamais de polling client |
| **Question de permission** | pane visible vers parseur vers iPhone | `get-pane-content`, **jamais** le JSONL (A6) |
| **Réponse à une question** | iPhone vers daemon vers Kova | `send-keys` d'un chiffre, après revérification du hash |
| Conversation | JSONL vers daemon vers iPhone | tail incrémental (lot 1, chemin critique) |
| Octets terminal | `.raw` vers daemon vers iPhone | resync puis stream (lot 2) |
| Fichiers | bidirectionnel | HTTPS en flux (lot 3) |

Le daemon n'écrit jamais dans le JSONL. Toute écriture passe par `send-keys` filtré.

---

## 2. Le daemon macOS (`kovalinkd`)

### 2.1 Runtime

**Node 20 LTS + TypeScript, un processus, zéro base de données.**

1. Le daemon est un pont d'I/O en flux : socket Unix, `fs` avec `start:`, WebSocket, HTTPS.
   `node:net`, `node:fs`, `node:tls` couvrent tout sans rien réécrire.
2. Node 20.20.1 est déjà installé. Aucune toolchain à ajouter.
3. `packages/protocol` est importé par le daemon **et** par l'app. Le contrat ne peut pas
   dériver, il casse à la compilation des deux côtés. C'est l'argument décisif.
4. `@expo/server-sdk` est une lib Node de première partie.

Écartés : Rust (x3 en coût d'écriture pour un pont d'I/O, et perte du type partagé), Bun et Deno
(absents de la machine, aucun gain sur un service permanent), Swift (double la surface de build).

Dépendances, six au total :

```jsonc
{ "fastify": "^5", "@fastify/websocket": "^11", "ws": "^8",
  "@expo/server-sdk": "^3", "qrcode-terminal": "^0.12", "chokidar": "^4" }
```

Pas d'ORM, pas de SQLite, pas de Redis, pas de file de messages. L'état persistant tient dans
`~/.kovalink/config.json`, `~/.kovalink/devices.json` et un journal JSONL. Le secret maître est
dans le trousseau macOS, pas sur disque.

### 2.2 Module `KovaIpc`

**Découverte du socket.** Le nom porte le PID de Kova, qui change à chaque redémarrage. On ne lit
jamais `KOVA_SOCKET` (le daemon n'est pas lancé depuis un pane). V9 impose de ne pas se fier à
`kill(pid, 0)` seul : les PID sont recyclés.

```ts
// src/kova/discover.ts
const KOVA_EXEC = '/Applications/Kova.app/Contents/MacOS/kova';

/** Vrai seulement si le PID tourne ET que c'est bien Kova. V9 : le PID 488 est sociallayerd. */
function isLiveKova(pid: number): boolean {
  try { process.kill(pid, 0); } catch (e: any) { if (e.code !== 'EPERM') return false; }
  try {
    const comm = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], {encoding:'utf8'});
    return comm.trim() === KOVA_EXEC;
  } catch { return false; }
}

export function liveKovaPids(): number[] {
  const out: number[] = [];
  for (const name of readdirSync('/tmp')) {
    const m = /^kova-(\d+)\.sock$/.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    const path = `/tmp/${name}`;
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (!st || !st.isSocket()) continue;
    if (st.uid !== process.getuid!()) continue;         // /tmp est accessible en écriture à tous
    if ((st.mode & 0o077) !== 0) continue;              // doit être 0600
    if (!isLiveKova(pid)) continue;
    out.push(pid);
  }
  return out;
}

export async function discoverSocket(): Promise<{ path: string; pid: number } | null> {
  const cands = liveKovaPids()
    .map(pid => ({ pid, path: `/tmp/kova-${pid}.sock`,
                   mtime: statSync(`/tmp/kova-${pid}.sock`).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const c of cands) if (await probe(c.path)) return c;   // sonde active list-tabs
  return null;
}
```

Le PID retenu sert aussi à construire les chemins `.raw` (`pty-capture-{pid}-{pane}.raw`).
C'est la seule source fiable de ce PID.

**Sondage des commandes au démarrage.** V3 montre qu'il n'existe aucune commande de version.
Le daemon envoie une fois `{"cmd":"<nom>"}` sans argument pour chaque commande attendue et
observe la forme de l'erreur : `unknown command:` signale une absence, tout autre message une
présence avec de mauvais arguments. Résultat exposé dans `hello.ok.kova.commands`.
C'est le seul repli praticable pour l'exigence PRD 5.5.

**Connexion.**

```
DISCOVERING --socket validé--> CONNECTING --subscribe ok--> READY
     ^                             | échec                    | close / error
     +------- BACKOFF <------------+--------------------------+ ou 45 s sans ligne
```

- Backoff `min(500ms * 2^n, 10s) * (0,8 + 0,4*random())`. `DISCOVERING` re-scanne `/tmp` à
  chaque tentative : c'est ainsi qu'un redémarrage de Kova (PID différent) est rattrapé seul.
- **Watchdog 45 s** réarmé à chaque ligne, `ping` compris (le contexte documente un keepalive à
  30 s). Un socket Unix à moitié mort ne remonte jamais d'erreur, ce timer est la seule parade.
- **Deux connexions.** A pour `subscribe` (lecture pure), B pour les requêtes. Le protocole
  JSON-lines n'a **aucun identifiant de corrélation** : interdiction de pipeliner, une requête en
  vol à la fois sur B, file FIFO, timeout 5 s. À 16 ms l'aller-retour, c'est sans conséquence.
- Buffer de lignes avec garde : au-delà de 8 Mo sans saut de ligne, la connexion est détruite.

**Interrogation par identifiant, jamais `"all"`.** `get-pane-content panes:"all"` mesuré à
20 576 octets pour 4 panes, et la charge croît linéairement avec le nombre de panes. Le daemon
n'interroge que les panes explicitement concernés.

**Typage de la réponse (V2).** L'union discriminée est imposée au niveau du client IPC, aucun
appelant ne voit la forme brute :

```ts
export type PaneContent =
  | { id: number; text: string; cols: number; rows: number; cursor: { row: number; col: number } }
  | { id: number; error: string };

export const isPaneError = (p: PaneContent): p is { id: number; error: string } => 'error' in p;
```

Table de correspondance des erreurs IPC vers les codes du protocole (V3, `error` est une chaîne
libre) :

| Chaîne renvoyée par Kova | Code protocole |
|---|---|
| `not found` (par élément, avec `ok:true`) | `PANE_NOT_FOUND` |
| `unknown command: <x>` | `IPC_UNSUPPORTED` |
| `invalid JSON: ...` | `INTERNAL` (bug du daemon, jamais du client) |
| timeout local | `IPC_TIMEOUT` |
| socket absent ou `DISCOVERING` | `KOVA_DOWN` |

**Kova fermé.** Le daemon reste vivant : `/health` répond `kova:"down"`, le WS pousse
`daemon.status`, les commandes de pane répondent `KOVA_DOWN` immédiatement (jamais un timeout
muet), et le bloc fichiers du lot 3 continue de fonctionner. Aucune route ne lance Kova.

### 2.3 Module `PromptParser`

Il implémente A6 et la grammaire du PRD 3.2. Depuis le changement de prémisse (voir 0.1), il
n'est plus la justification du lot 1, mais il reste le module dont une erreur coûte le plus cher :
c'est lui qui décide de ce que Robin peut approuver d'un pouce.

**Fait fondateur.** Le prompt de permission de Claude Code n'est pas garanti présent dans le
JSONL au moment où il s'affiche. La source de vérité est le contenu visible du pane. Le parseur
travaille sur `text` de `get-pane-content`, qui est **déjà nettoyé de l'ANSI** (V10).

**Aucun échantillon réel n'existe (V11, C37).** Toutes les sessions de Robin tournent en
`bypassPermissions` ou `auto`, et aucun rendu de prompt n'a pu être capturé sur la machine. La
grammaire ci-dessous est donc **une hypothèse, pas une mesure**, et le document ne la présente
pas autrement. Conséquences assumées :

1. Le parseur est **défensif par défaut** : en l'absence d'échantillon, `unparsable` est le
   comportement **attendu**, pas un cas d'erreur. Aucun bouton n'est jamais deviné.
2. Les critères d'acceptation qui portent sur le parsing sont marqués **non exécutables en
   l'état** en section 7, avec la procédure pour les exécuter.
3. La grammaire vit dans un fichier unique, `src/prompt/grammar.ts`, testé contre des fixtures
   dans `fixtures/prompts/*.txt`. Le jour où un prompt réel est capturé, il devient une fixture
   et la grammaire s'ajuste sans toucher au reste du daemon.

```ts
// packages/protocol : types partagés
export type OptionKind = 'approve' | 'approve_always' | 'reject' | 'neutral';
export interface PromptOption { index: number; label: string; kind: OptionKind }

export type Prompt =
  | { state: 'none';  paneId: number }
  | { state: 'parsed'; paneId: number; awaitingSince: string;
      question: string;
      detail: string[];                              // 0 à 5 lignes : commande, chemin, diff
      options: PromptOption[];                       // 2 ou plus, jamais 3 en dur
      freeTextAllowed: boolean;
      promptHash: string;
      promptRef: string }                            // référence opaque pour la NSE, voir 2.8
  | { state: 'unparsable'; paneId: number; awaitingSince: string;
      rawScreen: string;                             // 30 dernières lignes non vides
      cols: number; rows: number };
```

**Grammaire hypothétique (PRD 3.2), sur les 30 dernières lignes non vides :**

```ts
const OPTION_RE = /^\s*[>*]?\s*(\d+)[.)]\s+(\S.*?)\s*$/;

export function parsePrompt(pc: PaneContent, awaitingSince: string): Prompt {
  if (isPaneError(pc)) return { state: 'none', paneId: pc.id };          // V2
  const lines = pc.text.split('\n').map(l => l.replace(/\s+$/, ''));
  const window = lines.map((l, i) => [l, i] as const)
                      .filter(([l]) => l.trim() !== '').slice(-30);

  // 1. Options : numérotation consécutive à partir de 1, au moins deux.
  const opts: PromptOption[] = [];
  let firstOptLine = -1;
  for (const [line, idx] of window) {
    const m = OPTION_RE.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    if (n !== opts.length + 1) { opts.length = 0; firstOptLine = -1; }   // suite rompue
    if (n === 1) firstOptLine = idx;
    if (n === opts.length + 1) opts.push({ index: n, label: m[2], kind: classify(m[2]) });
  }
  if (opts.length < 2 || firstOptLine < 0) return unparsable(pc, awaitingSince, window);

  // 2. Question et détail, au dessus de l'option 1, hors filets de cadre.
  const above = lines.slice(0, firstOptLine).filter(l => l.trim() !== '' && !isBoxRule(l));
  if (above.length === 0) return unparsable(pc, awaitingSince, window);
  const question = above[above.length - 1].trim();
  const detail   = above.slice(-6, -1).map(l => l.trim());               // jusqu'à 5 lignes

  return { state: 'parsed', paneId: pc.id, awaitingSince, question, detail, options: opts,
           freeTextAllowed: opts.some(o => /tell claude|autre|other/i.test(o.label)),
           promptHash: hashPrompt(question, detail, opts),
           promptRef: mintPromptRef(pc.id) };
}

/** Heuristique de nature. En cas de doute : neutral, et le rendu bascule en liste (design 4.3). */
function classify(label: string): OptionKind {
  const l = label.toLowerCase();
  if (/don'?t ask again|ne plus (me )?demander|always allow/.test(l)) return 'approve_always';
  if (/^(yes|oui|allow|autoriser|accept)\b/.test(l))                  return 'approve';
  if (/^(no|non|reject|refuser|cancel|annuler)\b/.test(l)
      || /tell claude what to do/.test(l))                            return 'reject';
  return 'neutral';
}
```

#### Le `promptHash`, périmètre exact

**La règle qui gouverne tout le reste : tout ce qui est affiché à Robin pour qu'il décide entre
dans le hash, et rien de ce qui n'entre pas dans le hash n'est affiché.** Le type `Prompt` porte
exactement les trois champs hachés (`question`, `detail`, `options`) et rien d'autre du contenu de
l'écran. La bannière de notification, la barre de validation et le corps réécrit par la NSE
n'affichent que ces trois champs.

```ts
export function hashPrompt(question: string, detail: string[], options: PromptOption[]): string {
  const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
  const canon = [
    'v1',
    'Q:' + norm(question),
    ...detail.map((d, i) => `D${i}:` + norm(d)),          // commande, chemin, résumé de diff
    ...options.map(o => `O${o.index}:` + norm(o.label)),  // index ET libellé, dans l'ordre
  ].join('\n');
  return createHash('sha256').update(canon, 'utf8').digest('base64url');
}
```

| Entre dans le hash | Pourquoi |
|---|---|
| La question | C'est l'énoncé de l'action |
| **Le bloc de détail, jusqu'à 5 lignes** | **C'est ce qui identifie l'action** : la commande shell, le chemin du fichier, le résumé du diff. Deux demandes `Bash` consécutives ont la même question et les mêmes libellés d'options, et ne diffèrent que là. Sans le détail, l'approbation destinée à `ls` s'applique à `rm -rf`. |
| L'index et le libellé de chaque option, dans l'ordre | Réordonner ou insérer une option changerait la cible d'un index déjà envoyé |

| Exclu du hash | Pourquoi cette exclusion est sûre |
|---|---|
| Le marqueur de surlignage (chevron, astérisque) | C'est la position du curseur **sur le Mac**. L'inclure invaliderait toutes les réponses en vol dès que Robin bouge son curseur, et C1 impose que ce curseur ne soit jamais une entrée de la décision. |
| Les répétitions d'espaces (normalisées) | Le TUI re-wrap quand la largeur du pane change. Un `resize-pane` invaliderait sinon une réponse en vol sans que rien de décisionnel n'ait bougé. |
| Les filets de cadre | Purement décoratifs, ils suivent la largeur du pane. Ils sont aussi retirés de `detail`, donc ils ne sont ni hachés ni affichés : la règle tient. |
| Tout ce qui est hors de la fenêtre de 30 lignes | Non affiché à Robin, donc hors de sa décision par définition. |
| Les séquences ANSI | Absentes par construction, `get-pane-content` renvoie du texte nettoyé (V10). |

**Second garde-fou, indépendant du texte.** `pane.answer` reporte l'`awaitingSince` reçu dans le
`Prompt`, et le daemon le compare à `pane.awaiting_since` avant d'émettre. Deux demandes
successives strictement identiques au caractère près restent donc discriminées, dès lors que
`awaiting` est retombé entre les deux. Les deux gardes sont cumulatifs : le hash couvre le
changement de contenu, `awaitingSince` couvre le changement d'occurrence.

#### Cycle de vie

```
pane-status.awaiting: false -> true   (front montant, A6.4 : jamais de boucle permanente)
   |
   +-> get-pane-content panes:[id] mode:visible trim_trailing_blank_lines:true
        |
        +--parsed------> S2C prompt{...} + PushSender
        +--unparsable--> S2C prompt{state:'unparsable', rawScreen}
                         push "Validation requise", AUCUNE action d'approbation (C27)

Tant qu'un client a l'écran Question ouvert sur ce pane, app au premier plan :
   re-sondage toutes les 2 s, `prompt` repoussé si le hash change.
   Bornes : l'écran doit être ouvert, ET arrêt après 10 minutes sans changement de hash.
   Reprise sur `pane.peek`. Ce n'est jamais une boucle de fond.

pane-status.awaiting: true -> false -> S2C prompt{state:'none'} + retrait de la notification
```

#### Émission d'une réponse

C1 et C20, dans l'ordre strict, sans aucune étape optionnelle :

```ts
/** timingSafeEqual leve une RangeError si les longueurs different, ce qui transformerait
 *  un hash malforme en 500 et divulguerait la longueur attendue. On compare d'abord. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function answer(paneId: number, optionIndex: number,
                      promptHash: string, awaitingSince: string, nonce: string) {
  if (nonces.has(nonce)) return { applied: false, reason: 'duplicate' as const };

  const pane = panes.get(paneId);
  if (!pane) return { applied: false, reason: 'pane_gone' as const };
  if (!pane.awaiting) return { applied: false, reason: 'not_awaiting' as const };
  // Garde 2 : meme occurrence de awaiting, independamment du texte.
  if (pane.awaiting_since !== awaitingSince)
    return { applied: false, reason: 'prompt_changed' as const };

  // Relecture systematique, jamais un etat mis en cache.
  const fresh = await ipc.getPaneContent([paneId]);
  const p = parsePrompt(fresh[0], pane.awaiting_since!);
  if (p.state !== 'parsed') return { applied: false, reason: 'prompt_changed' as const };
  // Garde 1 : le hash couvre question + detail + options (C20).
  if (!timingSafeEqualStr(p.promptHash, promptHash))
    return { applied: false, reason: 'prompt_changed' as const };

  const opt = p.options.find(o => o.index === optionIndex);
  if (!opt) return { applied: false, reason: 'prompt_changed' as const };

  // UN SEUL send-keys, chiffre et Entree ensemble, AUCUN delai entre les deux (C1.3) :
  // un delai ouvre une fenetre ou Claude peut enchainer sur une autre question
  // et recevoir l'Entree. Le texte est construit par le serveur a partir d'un entier valide,
  // jamais a partir d'une chaine du client.
  await keyGate.emitAnswer(paneId, optionIndex);       // seul appelant autorise, voir 2.4

  nonces.add(nonce, 10 * 60_000);
  audit({ action: 'pane.answer', paneId, result: 'ok',
          detail: `index=${optionIndex} kind=${opt.kind}` });   // jamais le libelle
  return { applied: true };
}
```

Ce que ce code interdit par construction : approuver sans avoir lu (le client doit fournir un
`optionIndex`, il n'existe aucun `approve` générique), approuver la mauvaise option (le hash
couvre les libellés), **approuver une seconde demande identique en apparence** (le hash couvre le
détail, et `awaitingSince` couvre l'occurrence), approuver deux fois (nonce), approuver un écran
périmé (relecture), et approuver un `approve_always` par accident depuis une notification
(voir 5.2, les actions rapides ne l'offrent jamais).

**Écart assumé.** Ce parseur repose sur un rendu TUI qui peut changer avec une version de Claude
Code, et qu'aucun échantillon réel ne valide aujourd'hui. La parade est l'état `unparsable`, qui
est un état de premier ordre : aucun bouton, repli sur l'affichage monospace du pane, et une
notification sans action d'approbation. Le produit se dégrade, il ne se trompe jamais.
### 2.4 Module `KeyGate`, point d'entrée unique des écritures

**Périmètre exact, énoncé sans raccourci.** `KeyGate` est le seul module du daemon qui appelle
`ipc.sendKeys`. Aucun autre module, aucune route, aucun gestionnaire de message n'y accède : la
règle est vérifiée par une règle de lint (`no-restricted-imports` sur `ipc.sendKeys` hors de
`keygate.ts`) et par un test qui compte les appelants. `KeyGate` expose quatre opérations, et
quatre seulement.

**La règle qui compte (C23) : aucun retour chariot ne part sans vérification d'état.**
`KEY_TABLE.enter` existe, donc trois chemins pouvaient laisser partir un `\r` nu. Ils sont tous
les trois passés sous la même garde.

```ts
// src/kova/keygate.ts
/** Touches autorisées, PRD B4. Type énuméré fermé : aucun texte libre n'atteint le terminal. */
export const KEY_TABLE = {
  esc: '\x1b', tab: '\t', enter: '\r',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
  digit1: '1', digit2: '2', digit3: '3', slash: '/', at: '@',
  ctrl_c: '\x03',        // PRD B4 : confirmation par glissement côté app
} as const;
export type KeyName = keyof typeof KEY_TABLE;

/** Touches qui peuvent valider une option d'un prompt sans passer par le hash. */
const DECIDING = new Set<KeyName>(['enter', 'digit1', 'digit2', 'digit3']);

/**
 * Garde d'état commune. Vraie seulement quand une décision protégée est en cours :
 * le pane attend ET le prompt a été parsé, donc l'app a des boutons à proposer.
 * Si le prompt est `unparsable`, la garde est FAUSSE et tout passe : c'est le repli
 * imposé par A6 règle 2, Robin répond à la main devant l'écran monospace, et le lui
 * interdire le laisserait sans aucun moyen de débloquer sa session.
 */
async function hasParsedPromptPending(paneId: number): Promise<boolean> {
  const pane = panes.get(paneId);
  if (!pane?.awaiting) return false;
  const p = await promptParser.current(paneId);        // cache de 500 ms, sinon relecture
  return p.state === 'parsed';
}
```

**Opération 1, répondre à un prompt.** Seul `PromptParser.answer()` (2.3) peut l'appeler, après
ses deux gardes. Un seul `send-keys` atomique.

```ts
export async function emitAnswer(paneId: number, optionIndex: number) {
  await ipc.sendKeys(paneId, `${optionIndex}\r`);      // chiffre et Entrée ensemble
}
```

**Opération 2, interrompre (C21).** Opération de premier ordre, lot 1, aucune authentification
(A2), aucune confirmation. C'est le geste que A7 veut rendre le plus facile de toute l'app.

```ts
export async function emitInterrupt(paneId: number) {
  await ipc.sendKeys(paneId, KEY_TABLE.esc);           // exactement 0x1b, une fois
  audit({ action: 'pane.interrupt', paneId, result: 'ok' });
}
// Jamais Ctrl-C ici : l'echappement arrete le tour de l'agent, Ctrl-C tuerait le processus.
// Aucune garde d'etat : interrompre est l'action sure par defaut, elle doit toujours passer.
```

**Opération 3, envoyer un message libre.**

```ts
const MAX_TEXT = 8192;

export function sanitizeFreeText(raw: string): string {
  const s = raw.normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // C0 sauf \t et \n. La plage \u000E-\u001F contient ESC (\u001B),
    // donc AUCUNE séquence OSC, DCS ou APC ne peut survivre à cette ligne.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u0080-\u009F]/g, '');       // C1, dont OSC/DCS/APC en 8 bits
  if (s.length > MAX_TEXT) throw forbidden('TEXT_TOO_LONG');
  return `\x1b[200~${s}\x1b[201~`;          // bracketed paste
}

export async function emitText(paneId: number, text: string) {
  const pane = panes.get(paneId);
  // Le bracketed paste n'est honore que par un programme qui a active DECSET 2004.
  // Sur un pane qui n'est pas un agent, les marqueurs sont ignores et chaque \n s'execute.
  // On refuse donc le texte libre vers un pane sans agent : ca ferme la derniere voie
  // d'execution de commande, et le texte libre n'a de sens que vers un agent.
  if (!pane || pane.agent === null) throw forbidden('FORBIDDEN_ACTION');

  if (await hasParsedPromptPending(paneId))
    return { applied: false, reason: 'became_awaiting' as const };

  await ipc.sendKeys(paneId, sanitizeFreeText(text));            // appel 1, le texte

  // C23 : le second appel est un \r nu. Entre les deux, l'agent a pu basculer en awaiting
  // (une frame IPC, environ 16 ms, en usage normal et sans aucun attaquant). Ce \r
  // validerait alors l'option surlignee d'une question que Robin n'a jamais vue.
  // C'est exactement la fenetre que C1.3 ferme pour les reponses : on la ferme ici aussi.
  if (await hasParsedPromptPending(paneId)) {
    pushPromptToClients(paneId);              // Robin voit la question qui vient d'arriver
    return { applied: false, reason: 'became_awaiting' as const };   // le \r ne part PAS
  }
  await ipc.sendKeys(paneId, KEY_TABLE.enter);                   // appel 2, la validation
  return { applied: true as const };
}
```

Les deux appels restent séparés (PRD R8, CA-09) : la séparation laisse le TUI enregistrer le
collage avant la validation. Ce qui change, c'est que la fenêtre entre les deux est désormais
gardée. Si le texte est parti mais pas le `\r`, il reste dans le composer du pane, visible sur le
Mac et dans le prochain `get-pane-content` : rien n'est perdu, et Robin voit pourquoi.

**Opération 4, touches brutes (lot 2).**

```ts
export async function emitKeys(paneId: number, keys: KeyName[]) {
  const pending = keys.some(k => DECIDING.has(k)) && await hasParsedPromptPending(paneId);
  if (pending)
    throw forbidden('FORBIDDEN_KEY',
      'Une question est en attente. Reponds par les boutons, ou ouvre le mode brut.');
  await ipc.sendKeys(paneId, keys.map(k => {
    const v = KEY_TABLE[k];
    if (v === undefined) throw forbidden('FORBIDDEN_KEY');
    return v;
  }).join(''));
}
```

`pane.sendKeys` et `term.input` passent tous deux par `emitKeys`. Sans cette garde,
`['digit2','enter']` choisirait l'option 2 en contournant entièrement le `promptHash`. Avec elle,
la seule façon d'approuver depuis un prompt parsé est `pane.answer`, donc le hash et
l'`awaitingSince`. Quand le prompt est `unparsable`, la garde est fausse et tout passe : c'est le
repli de A6, il doit rester complet.

Récapitulatif des quatre chemins, il n'y en a pas d'autre :

| Opération | Garde d'état | Texte émis | Lot |
|---|---|---|---|
| `emitAnswer` | `promptHash` + `awaitingSince`, dans `PromptParser.answer()` | `${optionIndex}` puis `\r`, **un seul appel** | 1 |
| `emitInterrupt` | aucune, volontairement | `0x1b`, une fois | 1 |
| `emitText` | `agent !== null`, puis `hasParsedPromptPending` **avant chaque** des deux appels | bracketed paste, puis `\r` | 1 |
| `emitKeys` | `hasParsedPromptPending` si la séquence contient `enter` ou un chiffre | table fermée | 2 |

**`dispatch-action` est retiré du protocole** (C7). Le contexte expose une cinquantaine d'actions,
dont `close-pane-or-tab`, `paste`, `detach-tab` et `break-pane`. Aucun écran n'en a besoin. Un
champ `string` présenté comme une liste blanche est une liste blanche fausse. `close-pane`,
`close-tab`, `split` et `merge-*` ne sont exposés nulle part et ne le seront pas.

Actions Kova exposées hors `KeyGate`, union littérale fermée (elles n'écrivent pas dans le pane) :

```ts
export type PaneCommand =
  | { cmd: 'focus-pane' }                                             // PRD A10, L1
  | { cmd: 'set-pane-status'; status: 'waiting' | 'none' }            // PRD A11, L1
  | { cmd: 'resize-pane'; axis: 'horizontal'; direction: 'grow' | 'shrink';
      amount_pct: number }                                            // PRD B5, L2
  | { cmd: 'new-tab'; recentProjectIndex: number };                   // PRD A8, L2
```

`new-tab` ne prend **pas** un `cwd` libre : il prend un index dans
`~/.config/kova/recent_projects.json`, résolu côté daemon. Un jeton volé ne peut donc pas lancer
un shell dans un répertoire arbitraire.
### 2.5 Module `TranscriptTailer` (lot 1 depuis C36)

**Schéma réel.** 12 types de lignes (V5), deux familles.

**(a) Conversation** (`user`, `assistant`), portent `message` :

```ts
interface ConvLine {
  type: 'user' | 'assistant';
  uuid: string; parentUuid: string | null; timestamp: string;
  sessionId: string; cwd: string; gitBranch: string; version: string;
  isSidechain: boolean;                 // true = ligne de sous-agent
  requestId?: string;                   // assistant
  apiBlockIndex?: number;               // assistant, ordre dans le requestId (V6)
  promptId?: string;                    // user
  message: AnthropicMessage;
  toolUseResult?: unknown;              // user portant un tool_result
  sourceToolAssistantUUID?: string;
}
```

Règles imposées par les mesures :

- `assistant.message.content` contient **toujours un seul bloc**. Une réponse est éclatée sur
  **1 à 5 lignes** de même `requestId` (V6). Aucun code, aucun test unitaire ne doit supposer un
  nombre. Regroupement par `requestId`, **ordre par `apiBlockIndex`** (déterministe), et
  `timestamp` puis `parentUuid` en départage entre groupes.
- `usage` est répété à l'identique sur chaque ligne d'un groupe. Prendre la dernière, ne jamais
  sommer (A16).
- Les blocs `thinking` observés ont `.thinking` vide et une `signature` opaque : badge replié,
  aucun texte, aucun écran construit dessus.
- `user.message.content` est **soit une string** (prompt de Robin), **soit un tableau de
  `tool_result`**. C'est le discriminant entre message humain et retour d'outil.
- `toolUseResult` a une forme par outil (5 formes distinctes relevées : `stdout/stderr`,
  `agentId/status/outputFile`, `bytes/code/url`, `questions/answers`, `matches/query`). Le
  parseur en extrait un aperçu générique et laisse le reste opaque. **Aucun `switch` exhaustif** :
  un nouvel outil ne doit pas casser le client.
- **Gros résultats externalisés : aucun mécanisme de liaison connu (V12, C34).** Le dossier
  `<sessionId>/tool-results/` contient de vrais résultats, mais le JSONL **ne les référence
  nulle part**, ni par un marqueur textuel, ni par un champ. Le marqueur `Full output saved to:`
  supposé en passe 2 n'existe pas dans les données. Conséquence : le bloc porte
  `truncated: true, retrievable: false`, l'app affiche "résultat complet non récupérable, voir
  sur le Mac", et **aucune route ne promet ce contenu**. Le lot 2 porte une demi-heure
  d'investigation sur la vraie clé de jointure ; tant qu'elle n'est pas trouvée, on ne spécifie
  pas une route qui échouera.

**(b) Métadonnées.** Traitement, la liste ne se prétend pas exhaustive (V5) :

| Type | Traitement |
|---|---|
| `ai-title` | Titre de session. **Jamais dans une bannière de notification** (A14, il est généré à partir du contenu). |
| `mode`, `permission-mode` | Badge d'état de la session |
| `queue-operation` | **Ignoré, jamais rendu** (C22). Mesure : 20 occurrences, dont 11 blocs XML `<task-notification>` générés par le système et 9 avec `content: null`. **Zéro message de Robin.** Le rendre en bulle utilisateur injecterait du XML de service dans le fil. |
| `system` | `{subtype:'turn_duration', durationMs, messageCount}`. Ignoré. |
| `attachment` | Ignoré en bloc |
| `last-prompt`, `atis-latch`, `bridge-session`, `file-history-snapshot` | Ignorés |
| **tout type inconnu** | **Ignoré silencieusement, jamais une erreur** |

**Sous-agents (A16).** `<sessionId>/subagents/agent-<id>.jsonl` plus `agent-<id>.meta.json`
(`{agentType, description, toolUseId, spawnDepth, model, requestShape}`, forme vérifiée).
Jointure par `toolUseId` avec le bloc `tool_use` de l'outil `Agent`. Rendu en bloc replié dans
la bulle de l'outil parent, **chargé à la demande uniquement** : 6 fichiers de ~350 Ko sont
présents pour une seule session, les streamer noierait le mobile.

**Lecture incrémentale, jamais de relecture complète.**

```ts
interface TailState {
  path: string; offset: number; inode: number;
  head: Buffer;                  // 64 premiers octets, empreinte anti-réécriture
  decoder: StringDecoder;        // persistant, sinon un caractère UTF-8 coupé devient U+FFFD
  carry: string;                 // ligne partielle, une ligne fait jusqu'à 132 746 octets
}

function onChange(s: TailState) {
  const st = statSync(s.path);
  // Trois signaux de réouverture, pas deux. Une réécriture en place (même inode) qui
  // regrossit au delà de l'ancien offset passe les deux tests classiques : /clear et une
  // reprise de session produisent exactement ce motif.
  if (st.ino !== s.inode || st.size < s.offset || !readHead(s.path).equals(s.head))
    return reopen(s);                                   // + session.snapshot complet au client
  if (st.size === s.offset) return;

  const buf = readRangeSync(s.path, s.offset, st.size);
  s.offset = st.size;
  const parts = (s.carry + s.decoder.write(buf)).split('\n');
  s.carry = parts.pop()!;                               // consommée seulement après son saut
  emit(parts.filter(Boolean).map(safeParse).filter(Boolean));
}
```

À l'ouverture, fenêtre glissante depuis la fin, doublée jusqu'à 200 turns ou **2 Mo maximum**.
Le plafond est indispensable : avec des lignes de 132 Ko, une session à turns longs finirait
sinon par lire le fichier entier, ce que la spécification interdit. Au-delà, on sert moins de
turns et on pagine.

**Surveillance.** `chokidar` (FSEvents) coalescé à 80 ms pour le JSONL : 80 ms de latence y sont
sans conséquence. Le `.raw` utilise un autre mécanisme, voir 2.6.

**Pagination, valeur unique.** Un `turn` est une bulle, c'est ce que le PRD 3.1 appelle un
message. Chargement initial **200 turns**, pagination par **100** vers le passé. Une seule
valeur dans tout le projet.

### 2.6 Module `PtyStreamer` (lot 2)

```ts
const rawPath = `${homedir()}/Library/Logs/Kova/pty-capture-${kovaPid}-${paneId}.raw`;
```

À l'attache :

1. `stat()`. Absent : **mode dégradé polling** immédiat, `get-pane-content mode:"visible"` à
   1 Hz (PRD B3), envoyé en `term.screen` (texte, pas d'ANSI).
2. Présent : **resynchronisation, jamais de rejeu**. Le flux est du redessin plein écran à
   positionnement absolu (V8), rejouer l'historique ne reconstruit rien. Budget de rejeu :
   **au plus 2 Mo en arrière** (C35, valeur unique dans les trois documents), et **0 octet si le
   fichier a grossi de plus de 2 Mo depuis le détachement**. À 145,2 Ko/min (V8), 30 minutes de
   déconnexion représentent 4,3 Mo : on ne rejoue rien, on resynchronise.
   a. `get-pane-content` donne `text`, `cols`, `rows`, `cursor` (V10).
   b. `term.resync` envoyé au client, qui fait `reset()`, `resize()`, écrit le texte, place le
      curseur.
   c. `offset = st.size`, puis stream à partir de là.
3. **Indicateur "rendu simplifié".** Le `text` de `get-pane-content` est sans couleur ni
   attribut. Sur un pane qui travaille, le premier redessin du TUI rétablit la fidélité en moins
   d'une seconde. Sur un pane **au repos, aucun redessin n'arrive jamais** et l'écran resterait
   monochrome sans que l'utilisateur comprenne pourquoi. Le client affiche donc un indicateur
   discret tant qu'aucun octet brut n'est arrivé depuis le resync.
4. **Surveillance par `fstat` à 20 ms**, pas par FSEvents, et **uniquement pour les `.raw`
   attachés**. `~/Library/Logs/Kova/` contient 58 fichiers `.raw` : un watcher de dossier se
   réveillerait en permanence, ce qui contredit le budget PRD de 1 % de CPU au repos, et la
   latence FSEvents n'est pas bornée sous les 250 ms d'écho clavier exigés. Une boucle `fstat`
   sur un descripteur ouvert est déterministe et gratuite quand rien ne bouge.
5. **Coalescence 16 ms** (une frame) avant envoi en frame WS binaire.
6. **Contre-pression.** Si `ws.bufferedAmount > 2 Mo` : arrêt de lecture, saut en fin de fichier,
   `term.gap {droppedBytes}` puis `term.resync` quand le buffer redescend sous 256 Ko. Un
   terminal en retard de 30 s ne vaut rien.
7. **Repli continu (PRD B3).** Si `working === true` et que la taille n'a pas bougé depuis 10 s,
   bascule en `term.screen` à 1 Hz avec l'indicateur de mode dégradé. Le repli n'est pas décidé
   une fois pour toutes à l'attache, il est réévalué en continu.
8. **Redémarrage de Kova.** Le PID change donc le chemin change : sur `kova:reconnected`, chaque
   streamer refait l'étape 1.
9. **Détachement.** Plus aucun client attaché, le stream est fermé. Aucun tail sans consommateur.

**Purge des `.raw` orphelins (A15, corrigée par V9).** Au démarrage :

```ts
const live = new Set(liveKovaPids());               // PID vivants ET réellement Kova (2.2)
for (const f of readdirSync(logsDir)) {
  const m = /^pty-capture-(\d+)-(\d+)\.raw$/.exec(f);
  if (!m || live.has(Number(m[1]))) continue;
  const st = statSync(join(logsDir, f));
  if (Date.now() - st.mtimeMs < 7 * 864e5) continue;   // marge de sûreté de 7 jours
  renameSync(join(logsDir, f), join(homedir(), '.Trash', f));   // réversible, 1,1 Go en jeu
  audit({ action: 'maintenance.purge', path: f, bytes: st.size, result: 'ok' });
}
```

Le test `ps -p <pid> -o comm=` est ce qui rend la purge correcte : sans lui, `pty-capture-488-*`
ne serait jamais nettoyé puisque le PID 488 est aujourd'hui `sociallayerd` (V9). Volume concerné
mesuré : 1,1 Go, dont 38 fichiers de la seule instance morte 21975. Aucune route HTTP n'expose
cette maintenance, elle est locale au démarrage et journalisée.

### 2.7 Module `FileEngine` (lot 3)

Périmètre exact du PRD C7 : **lire, télécharger, envoyer**. Ni renommer, ni déplacer, ni
supprimer, ni créer de dossier, ni révéler dans le Finder (C18). Cinq routes en moins, autant de
surface d'attaque en moins.

**Résolution de chemin.** `realpath()` échoue sur un chemin qui n'existe pas encore, donc le
contrôle classique est inopérant précisément sur les écritures, là où il compte.

```ts
function resolveForRead(p: string): string {
  const full = realpathSync(resolve(p));                 // liens et .. neutralisés
  if (isReadDenied(full)) throw denied('PATH_DENIED');
  return full;
}

function resolveForWrite(p: string): string {
  const parent = realpathSync(dirname(resolve(p)));      // le PARENT doit exister
  const base = basename(p);
  if (base === '.' || base === '..' || base.includes('/')) throw denied('PATH_DENIED');
  const full = join(parent, base);
  if (isWriteDenied(full)) throw denied('PATH_DENIED');
  return full;
}
```

Ouverture avec `O_NOFOLLOW` sur le dernier segment, puis comparaison de `fstat().ino` avec le
`stat` de contrôle : la fenêtre TOCTOU entre la résolution et l'ouverture est fermée.

**Aucun appel shell.** `execFile` avec un tableau d'arguments partout, jamais `exec` avec une
chaîne, et **jamais d'`osascript`** : construire de l'AppleScript par concaténation de chemin est
une injection immédiate. Les seuls binaires appelés par le daemon sont `/bin/ps`,
`/usr/bin/security`, `/usr/bin/caffeinate` et `/usr/bin/tailscale`, tous avec des arguments
constants ou numériques.

### 2.8 Protocole client / serveur

Contrat unique, `packages/protocol/src/index.ts`, importé par le daemon et par l'app.
Chaque message porte son lot : **L1** est implémenté au lot 1, **L2** au lot 2, **L3** au lot 3.

**Transport.** HTTPS pour requête/réponse et fichiers, WSS sur `/ws` pour le temps réel.
Certificat `tailscale cert` sur le nom MagicDNS, validé par la chaîne système (A12) : `fetch` et
`WebSocket` standards suffisent, aucun module natif.

**Authentification.** En-tête `Authorization: Bearer <deviceId>.<exp>.<token>` sur HTTP **et** sur
le WebSocket (React Native accepte un troisième argument `{ headers }` sur iOS). Le jeton
n'apparaît **jamais** dans `Sec-WebSocket-Protocol` (C8) : ce champ est renvoyé tel quel dans la
réponse de handshake et atterrit dans tous les journaux d'accès. Repli documenté si un client ne
peut pas poser d'en-tête : `POST /v1/ws/ticket` rend un ticket à usage unique valable 30 s.

**Frames.** Texte = JSON. Binaire = octets de terminal, en-tête de 8 octets pour éviter un tour
de base64 côté daemon :

```
0 : uint8 version=1 | 1 : uint8 kind=1 | 2 : uint16 paneId | 4 : uint32 seq | 8.. : octets ANSI
```

Versionnement : `hello.protocol = 1`, incrémenté seulement sur rupture. Une version inconnue
répond `PROTOCOL_VERSION`.

#### Types de domaine

```ts
export const PROTOCOL_VERSION = 1;

export interface Pane {
  id: number; window: number; tab: number;
  cwd: string; title: string | null; focused: boolean; pid: number;
  child_processes: Array<{ name: string; pid: number; version: string | null }>;
  is_idle: boolean; working: boolean;
  awaiting: boolean; awaiting_since: string | null; awaiting_seen: boolean;
  minimized: boolean;
  agent: string | null;
  agent_session_id: string | null; agent_session_name: string | null;
  claude_session_id: string | null; claude_session_name: string | null;   // V1
  // calculés par le daemon
  projectName: string;              // basename(cwd)
  hasTranscript: boolean;
  chatCapable: boolean;             // agent === 'claude' && hasTranscript (A5)
  /** V11 : lu dans la dernière ligne `permission-mode` du JSONL. Sert le badge
   *  "cette session est en bypass, aucune validation ne te sera demandée". */
  permissionMode: 'default' | 'plan' | 'acceptEdits' | 'auto' | 'bypassPermissions' | null;
}

export interface Tab {
  id: number; window: number; tab_index: number; title: string | null;
  pane_count: number; focused_pane_id: number; active: boolean;
  has_bell: boolean; has_completion: boolean; has_running: boolean;
}

export interface Turn {                                  // L1 depuis C36
  id: string;                        // requestId (assistant) ou uuid (user)
  kind: 'user' | 'assistant' | 'tool_result';
  ts: string; seq: number; uuids: string[];
  blocks: Block[];
  model?: string; stopReason?: string | null;
  usage?: { input: number; output: number; cacheRead: number; cacheCreate: number };
  isSidechain: boolean;
}

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking' }                                           // contenu toujours vide
  | { type: 'tool_use'; id: string; name: string; input: unknown; preview: string }
  | { type: 'tool_result'; toolUseId: string; isError: boolean;
      preview: string;
      /** true quand l'aperçu est tronqué ET que le contenu complet n'est pas récupérable.
       *  Le JSONL ne référence pas les fichiers de `tool-results/` (V12) : l'app affiche
       *  "résultat complet non récupérable, voir sur le Mac" plutôt qu'un bouton mort. */
      truncated: boolean; retrievable: false;
      subagentId?: string };                                       // L2

export interface SessionMeta {
  sessionId: string; paneId: number | null; title: string | null;
  cwd: string; gitBranch: string | null;
  mode: string | null;
  permissionMode: string | null;      // exposé comme badge, V11
  lastSeq: number;
}
```

#### Client vers serveur

```ts
export type C2S =
  | Hello | Ping                                                         // L1
  | PanesSubscribe | PanePeek | PaneCommandMsg                           // L1
  | PaneAnswer | PaneInterrupt | PaneSendText                            // L1
  | SessionAttach | SessionDetach | SessionHistory                       // L1
  | PushRegister                                                         // L1
  | PaneSendKeys | TermAttach | TermDetach | TermInput;                  // L2

interface Hello {                                                        // L1
  t: 'hello'; id: string; protocol: 1;
  deviceId: string; appVersion: string; platform: 'ios';
  expoPushToken?: string;          // renvoyé s'il a changé (réinstallation, restauration)
  resume?: { panesEtag?: string };
}
interface Ping { t: 'ping'; id: string }

interface PanesSubscribe { t: 'panes.subscribe'; id: string }             // L1, idempotent

/** Relecture explicite du prompt : ouverture de l'écran Question, tirer pour rafraîchir,
 *  reprise après l'arrêt du sondage à 10 minutes. */
interface PanePeek { t: 'pane.peek'; id: string; paneId: number }         // L1

interface PaneCommandMsg {                                               // L1 pour focus/status
  t: 'pane.cmd'; id: string; paneId: number; cmd: PaneCommand;           // union fermée, 2.4
}

/** Répondre à un prompt. Il n'existe aucun `approve` générique dans le protocole. */
interface PaneAnswer {                                                   // L1
  t: 'pane.answer'; id: string;
  paneId: number;
  optionIndex: number;        // entier >= 1, validé contre les options relues
  promptHash: string;         // couvre question + detail + options (C20)
  awaitingSince: string;      // second garde-fou, discrimine deux prompts identiques
  nonce: string;              // uuid v4, idempotence sur 10 min
}

/**
 * Interrompre. Opération de premier ordre (A7, PRD A7, CA-15), et non un cas particulier
 * de `pane.sendKeys` : la promouvoir en L1 ramènerait `enter` et les chiffres au lot 1.
 * Émet exactement KEY_TABLE.esc, une fois. Jamais Ctrl-C. Aucune authentification (A2).
 */
interface PaneInterrupt { t: 'pane.interrupt'; id: string; paneId: number; nonce: string } // L1

/** Message libre. Deux send-keys séparés, chacun sous garde d'état (C23, voir 2.4). */
interface PaneSendText {                                                 // L1 depuis C36
  t: 'pane.sendText'; id: string; paneId: number; nonce: string; text: string;
}
/** Touches de la barre. Type énuméré fermé, aucun texte libre, garde d'état sur `enter`
 *  et les chiffres quand un prompt parsé est en attente. */
interface PaneSendKeys {                                                 // L2
  t: 'pane.sendKeys'; id: string; paneId: number; keys: KeyName[];
}

interface SessionAttach {                                                // L1 depuis C36
  t: 'session.attach'; id: string; sessionId: string;
  afterSeq?: number;
  /** Le dernier turn en cache peut être MUTABLE (1 à 5 blocs, V6). Sans ces deux champs,
   *  une reconnexion laisse une réponse tronquée pour toujours, par exemple un `thinking`
   *  seul dont le `text` et le `tool_use` ne reviendront jamais. */
  lastTurnId?: string; lastTurnBlockCount?: number;
}
interface SessionDetach  { t: 'session.detach'; id: string; sessionId: string }
interface SessionHistory { t: 'session.history'; id: string; sessionId: string;
                           beforeSeq: number; limit: 100 }

interface TermAttach { t: 'term.attach'; id: string; paneId: number }     // L2
interface TermDetach { t: 'term.detach'; id: string; paneId: number }
interface TermInput  { t: 'term.input';  id: string; paneId: number; keys: KeyName[] }
// TermInput ne transporte PAS de string : uniquement des KeyName de la table fermée,
// et il passe par le meme emitKeys que pane.sendKeys, donc par la meme garde d'etat (C23).
// Le texte libre passe par pane.sendText, jamais par le terminal.

interface PushRegister {                                                 // L1
  t: 'push.register'; id: string; expoPushToken: string;
  prefs: { onlyValidations: boolean; quietHours: boolean };              // 4 réglages, C28
}
```

#### Serveur vers client

```ts
export type S2C =
  | HelloOk | Pong | Ack | ErrorMsg | DaemonStatus                       // L1
  | PanesSnapshot | PaneEvent | PromptMsg | ActionResult                 // L1
  | SessionSnapshot | SessionAppend | SessionClosed                      // L1
  | TermResync | TermScreen | TermGap | TermClosed;                      // L2

interface HelloOk {
  t: 'hello.ok'; reqId: string; protocol: 1;
  daemonVersion: string;
  kova: { status: 'up' | 'down'; pid: number | null;
          commands: Record<string, boolean> };       // sondage de V3
  link: { relay: string | null };                    // null = direct, sinon nom du DERP (A11)
  token?: string;                                    // renouvellement silencieux à J-15
  serverTime: string;
}

interface Pong { t: 'pong'; reqId: string; serverTime: string }
interface Ack  { t: 'ack';  reqId: string }

interface ErrorMsg {
  t: 'error'; reqId?: string;
  code: 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'PROTOCOL_VERSION' | 'BAD_REQUEST'
      | 'KOVA_DOWN' | 'PANE_NOT_FOUND' | 'SESSION_NOT_FOUND'
      | 'IPC_TIMEOUT' | 'IPC_UNSUPPORTED'
      | 'FORBIDDEN_ACTION' | 'FORBIDDEN_KEY' | 'TEXT_TOO_LONG'
      | 'PATH_DENIED' | 'RATE_LIMITED' | 'IO_ERROR' | 'NO_SPACE' | 'INTERNAL';
  message: string; retryable: boolean; retryAfterMs?: number;
}

interface DaemonStatus {
  t: 'daemon.status';
  kova: { status: 'up' | 'down' | 'reconnecting'; pid: number | null };
  link: { relay: string | null };                    // rafraîchi toutes les 30 s
  since: string;
}

interface PanesSnapshot {
  t: 'panes.snapshot'; appActive: boolean; focusPaneId: number | null;
  panes: Pane[]; tabs: Tab[]; etag: string;          // le client REMPLACE, il ne fusionne pas
}

type PaneEvent =
  | { t:'pane.event'; ev:'focus'; appActive: boolean; reason: string; pane: Pane | null }
  | { t:'pane.event'; ev:'pane-status';  paneId: number; awaiting: boolean;
      awaitingSince: string | null }
  | { t:'pane.event'; ev:'pane-working'; paneId: number; working: boolean }
  | { t:'pane.event'; ev:'pane-open';    pane: Pane }
  | { t:'pane.event'; ev:'pane-close';   paneId: number; window: number; tab: number };

/** Poussé sur front montant de awaiting, sur pane.peek, toutes les 2 s tant qu'un écran
 *  Question est ouvert (plafond 10 min), et sur retombée de awaiting. */
interface PromptMsg { t: 'prompt'; prompt: Prompt }                      // Prompt : union de 2.3

/** Réponse commune à pane.answer, pane.interrupt et pane.sendText. */
interface ActionResult {
  t: 'action.result'; reqId: string;
  applied: boolean;
  reason?: 'duplicate' | 'prompt_changed' | 'not_awaiting' | 'pane_gone'
         | 'became_awaiting'                                   // C23, voir 2.4
         | 'forbidden';
}

interface SessionSnapshot { t:'session.snapshot'; reqId: string; sessionId: string;
                            meta: SessionMeta; turns: Turn[]; hasMoreBefore: boolean }
interface SessionAppend   { t:'session.append';   sessionId: string; turns: Turn[];
                            replaceIds: string[] }
/** Le pane qui portait la session a disparu. L'écran chat est routé par sessionId,
 *  il ne peut pas dériver ce cas de pane-close sans table de correspondance. */
interface SessionClosed   { t:'session.closed'; sessionId: string }

interface TermResync { t:'term.resync'; paneId: number; cols: number; rows: number;
                       text: string; cursor: {row:number;col:number}; seq: number;
                       mode: 'raw' | 'polling'; simplified: boolean }
interface TermScreen { t:'term.screen'; paneId: number; cols: number; rows: number;
                       text: string; cursor: {row:number;col:number} }
interface TermGap    { t:'term.gap';    paneId: number; droppedBytes: number }
interface TermClosed { t:'term.closed'; paneId: number;
                       reason: 'pane-close' | 'kova-down' | 'io-error' }
```

#### Routes HTTP

```
--- Lot 1 ---------------------------------------------------------------------
GET    /health                       sans auth. { ok: true, protocol: 1 } et RIEN d'autre :
                                     ni version ni hostname avant authentification.
POST   /v1/pair/claim                sans Bearer. { pairingCode, deviceName }
                                       -> { deviceId, token, tsDns, port }
POST   /v1/ws/ticket                 ticket WS a usage unique, 30 s (repli d'en-tete)
GET    /v1/panes                     -> { panes, tabs, etag }
GET    /v1/prompt/{promptRef}        -> Prompt. Route de la Notification Service Extension.
                                     Voir "Reference de prompt" ci dessous.
POST   /v1/panes/:paneId/answer      { optionIndex, promptHash, awaitingSince, nonce }
                                       -> 200 { applied, reason? } | 409 PROMPT_CHANGED
POST   /v1/panes/:paneId/interrupt   { nonce } -> 200 { applied }
                                     Miroirs HTTP de pane.answer et pane.interrupt : depuis
                                     une action de notification, ouvrir un WS consommerait la
                                     moitie du budget de quelques secondes accorde par iOS.
POST   /v1/panes/:paneId/text        { text, nonce } -> 200 { applied, reason? }
GET    /v1/sessions/:sessionId/turns?beforeSeq&afterSeq&limit=100
DELETE /v1/pair/devices/:deviceId    revocation immediate, coupe les WS de l'appareil

--- Lot 2 ---------------------------------------------------------------------
GET    /v1/sessions/:sessionId/subagents
GET    /v1/sessions/:sessionId/subagents/:agentId/turns

--- Lot 3 ---------------------------------------------------------------------
GET    /v1/fs/list?path=&showHidden=    pagination 500 entrees (PRD C1)
GET    /v1/fs/read?path=                flux, Range accepte (reprise), aucun plafond (A4)
GET    /v1/fs/quickdests                cwd des panes + Bureau + Telechargements + recents
POST   /v1/fs/upload/init               { destDir, filename, size, sha256? }
PUT    /v1/fs/upload/:uploadId?offset=N corps binaire
POST   /v1/fs/upload/:uploadId/complete
GET    /v1/fs/upload/:uploadId          { receivedBytes }, reprise
DELETE /v1/fs/upload/:uploadId
```

**Référence de prompt, `promptRef` (C24).** La NSE tourne dans un processus séparé et ne doit
porter ni le jeton d'appareil complet ni l'identifiant de pane.

```ts
// A la creation d'un Prompt parse, le daemon frappe une reference opaque :
promptRef = randomBytes(16).toString('base64url');
promptRefs.set(promptRef, { paneId, promptHash, expiresAt: Date.now() + 600_000, used: false });
```

- Elle est **opaque** : elle ne révèle ni le `paneId`, ni le `cwd`, ni le nom du projet.
- Elle est **à usage unique** et expire en 10 minutes, comme le `ttl` du push.
- `GET /v1/prompt/{promptRef}` est authentifié par un **jeton court dédié à la NSE**, dérivé du
  secret maître, portée limitée à cette seule route, 30 jours, stocké dans le groupe de trousseau
  partagé. Il ne peut ni répondre, ni lire un fichier, ni ouvrir un WebSocket.
- Elle est **la seule** donnée liée au prompt qui transite par la charge utile du push. Ni la
  question, ni le détail, ni le `paneId` n'y figurent (A14).

Codes : `200`, `206`, `400`, `401`, `403`, `404`, `409`, `416`, `429`, `500`, `503`, `507`.
Le corps d'erreur est un `ErrorMsg`.

Limitation de débit par **`deviceId`**, jamais par IP : sur Tailscale relayé, plusieurs chemins
peuvent présenter la même adresse, et il n'existe qu'un utilisateur légitime.

```jsonc
{ "answer": "30/min", "interrupt": "30/min", "text": "30/min",
  "prompt": "60/min",                 // NSE plus sondage a 2 s d'un ecran ouvert
  "keys": "300/min",                  // frappe au terminal, lot 2
  "fsRead": "600/min", "fsBytes": "4 Go/h",
  "health": "60/min par IP",
  "authFail": "10 echecs / 5 min -> blocage du deviceId 15 min, IP en audit seulement" }
```
### 2.9 Cycle de vie, `launchd`, veille

**LaunchAgent utilisateur** (contrainte 6.5 : jamais root). Le daemon vérifie
`process.getuid() !== 0` au démarrage et refuse de démarrer en root.

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
    <string>/usr/local/bin/node</string>
    <string><home>/.kovalink/app/dist/main.js</string>
  </array>

  <key>WorkingDirectory</key><string><home>/.kovalink</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>KOVALINK_HOME</key><string><home>/.kovalink</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>RunAtLoad</key><true/>

  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/><key>Crashed</key><true/></dict>
  <key>ThrottleInterval</key><integer>10</integer>

  <!-- Session graphique : le trousseau doit être déverrouillé, et le daemon n'a aucun sens
       avant l'ouverture de session de Robin. -->
  <key>LimitLoadToSessionType</key><string>Aqua</string>

  <!-- Interactive : pas de bridage QoS, le streaming terminal doit rester fluide. -->
  <key>ProcessType</key><string>Interactive</string>

  <key>StandardOutPath</key><string><home>/.kovalink/logs/stdout.log</string>
  <key>StandardErrorPath</key><string><home>/.kovalink/logs/stderr.log</string>

  <key>SoftResourceLimits</key>
  <dict><key>NumberOfFiles</key><integer>4096</integer></dict>
</dict>
</plist>
```

Installation : `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.claap.kovalinkd.plist`.
Rechargement : `launchctl kickstart -k gui/$(id -u)/io.claap.kovalinkd`.
Désinstallation : `launchctl bootout gui/$(id -u)/io.claap.kovalinkd`.
Le script d'installation résout `command -v node` et écrit le chemin réel dans le plist plutôt
que de supposer `/usr/local/bin/node`.

**Journaux.** Le daemon écrit dans `~/.kovalink/logs/kovalinkd.log`, rotation à 8 Mo, 5 fichiers.
Ce n'est pas du confort : un `kova.log.1` de 757 Mo est présent sur la machine.

**Anti-veille (A13).** Le déclencheur est **l'agent qui travaille**, pas la présence d'un client.
Tout l'intérêt du produit est que l'agent continue téléphone rangé et app fermée.

```ts
// Assertion IOKit PreventUserIdleSystemSleep. `caffeinate -i` en pose exactement une,
// donc aucun module natif n'est nécessaire.
let proc: ChildProcess | null = null, armedAt = 0;
const CAP_MS = 4 * 3600_000;

function reconcileSleepAssertion() {
  const anyWorking = [...panes.values()].some(p => p.working);
  const expired = proc !== null && Date.now() - armedAt > CAP_MS;   // filet de sécurité A13
  if (anyWorking && !proc && cfg.preventSleep) {
    proc = spawn('/usr/bin/caffeinate', ['-i'], { stdio: 'ignore' });
    armedAt = Date.now();
  } else if ((!anyWorking || expired || !cfg.preventSleep) && proc) {
    proc.kill(); proc = null;
  }
}
```

`-i` et non `-s` : on empêche la veille par inactivité, on **ne contre pas la fermeture du
capot**, qui est un comportement attendu (batterie, chaleur dans un sac). Conséquence documentée
dans l'app : capot fermé sur batterie, la session est suspendue. Interrupteur exposé (A1).

**Réveil après veille.** Détection par **saut d'horloge** : un timer de 1 s compare l'écart au
temps attendu, au-delà de 5 s la machine a dormi. Les sockets TCP survivent rarement à une
veille, autant les considérer morts : invalidation de l'IPC et des tails, retour en
`DISCOVERING`, `panes.snapshot` et `term.resync` renvoyés à tous les clients.

### 2.10 Gros fichiers (lot 3)

**Aucun plafond par fichier (A4).** La seule limite est l'espace disque : `init` refuse en `507`
si `statfs` montre moins de `size + 1 Go` de libre. Ni le daemon ni l'app ne chargent jamais un
fichier entier en mémoire.

**Download.** `GET /v1/fs/read` en flux, `Accept-Ranges: bytes`, `Range` complet. La reprise d'un
téléchargement de 2 Go coupé au milieu est un `Range` de plus, rien d'autre.

**Upload, trois temps.** `init` puis `PUT` par morceaux de 8 Mo puis `complete`.

- Le `.part` s'écrit dans `<destDir>/.kovalink-upload-<id>.part`, donc sur le **même volume**, ce
  qui rend le `rename()` final atomique.
- Un `PUT` dont l'`offset` ne correspond pas répond `409` avec le `receivedBytes` réel : le client
  se recale, il ne recommence pas.
- Le manifeste est persisté dans `~/.kovalink/uploads/<id>.json`, donc la reprise survit à un
  redémarrage du daemon. Purge des `.part` abandonnés après 24 h.
- Collision de nom : suffixe `-2`, `-3` (PRD C4). Jamais d'écrasement silencieux.
- `resolveForWrite` est **rejoué sur le nom final** juste avant le `rename()` : le `.part` a
  été validé à l'`init`, mais la collision produit un nom différent, qui doit repasser la
  liste noire.
- `sha256` vérifié en streaming à `complete`, `422` en cas de divergence, sans publier le fichier.

**Avertissement cellulaire (A4).** Au-delà de **100 Mo** en données cellulaires, l'app affiche un
choix explicite : envoyer maintenant, ou différer jusqu'au Wi-Fi. Le transfert différé repart
automatiquement à la première connexion Wi-Fi.

---

## 3. L'app Expo

### 3.1 Structure

```
apps/mobile/
  app/                              expo-router
    _layout.tsx                     providers, gate d'appairage, gate de connexion
    pair.tsx                        scan du QR
    index.tsx                       Sessions : 3 sections, Ouvrir + Interrompre (A7)
    session/[id]/chat.tsx           Session : derniers turns + composer, lot 1 (C36)
    prompt/[promptRef].tsx          Barre de validation, filet du lot 1
    settings.tsx                    4 réglages (C17, C28)
    session/[id]/terminal.tsx       lot 2
    files/[...path].tsx             lot 3
  src/
    net/connection.ts  ws.ts  http.ts
    store/panes.ts  prompt.ts  connection.ts  prefs.ts
    db/cache.ts                     2 tables + 1 instantané JSON
    prompt/ValidationBar.tsx  OptionButton.tsx  RawScreen.tsx
    notifications/register.ts  quickAction.ts
    chat/TurnList.tsx  Bubble.tsx  ToolCall.tsx  Composer.tsx    lot 1
    terminal/  files/               lots 2 et 3
  targets/notification-service/     NSE, ajoutée par config plugin
    NotificationService.swift
  app.config.ts  eas.json
```

### 3.2 Bibliothèques

| Domaine | Choix | Rôle |
|---|---|---|
| Navigation | `expo-router` v6 | Deep links `kovalink://prompt/66` utilisés par les notifications |
| État | `zustand` | 4 stores plats. Redux serait de la sur-ingénierie pour un utilisateur |
| Données serveur | rien | Le WS est la source de vérité. React Query ajouterait une seconde source de vérité sur un flux poussé |
| Réseau | `fetch` et `WebSocket` **standards** | A12 : `tailscale cert` donne un certificat validé par la chaîne système. **Aucun module natif en v1** |
| Cache | `expo-sqlite` (2 tables) + 1 fichier JSON | `turns` et `outbox` seulement. L'état des panes est un instantané JSON, pas une table |
| Stockage sécurisé | `expo-secure-store` | `deviceId`, `token`, `tsDns`. `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, jamais iCloud. Groupe de trousseau partagé avec la NSE |
| Authentification locale | `expo-local-authentication` | Face ID sur Approuver dans l'app (A2) |
| Notifications | `expo-notifications` | Jeton, catégories, réponses |
| Tâches de fond | `expo-task-manager` | Action rapide au démarrage à froid |
| Scan QR | `expo-camera` (`CameraView`) | `expo-barcode-scanner` est déprécié |
| Réseau | `expo-network` | Type de connexion, avertissement cellulaire (A4) |
| Haptique | `expo-haptics` | Retour sur `awaiting`, utile téléphone en poche |
| Mises à jour | `expo-updates` | OTA |
| Listes | `@shopify/flash-list` v2 | lot 2, hauteurs très variables |
| Markdown | `react-native-markdown-display` | lot 2 |
| Terminal | `react-native-webview` + `@xterm/xterm` 5.5 | lot 2, voir 3.3 |
| Fichiers | `expo-document-picker`, `expo-image-picker`, `expo-file-system`, `expo-sharing` | lot 3 |
| Share extension | `expo-share-intent` | lot 3, voir 6.4 |

Le module natif Swift `kovalink-transport` est **supprimé** (A12), soit environ 550 lignes en
moins. Il pourra revenir au lot 3 si les transferts de fond `URLSession` le justifient, ce qui
est un besoin du bloc fichiers et non du chemin critique.

### 3.3 Terminal

**Le repli du lot 1 n'est pas xterm.js.** A6 règle 2 impose un état de repli quand le parseur
échoue : c'est un `<Text>` monospace affichant le `text` de `get-pane-content`, dans une
`ScrollView` horizontale (le pane fait 221 colonnes, V10). Une trentaine de lignes, pas huit
cents.

Le terminal complet arrive au lot 2 : **xterm.js dans une WebView**, jamais un rendu React
Native. Le flux est de l'ANSI brut avec positionnement absolu, écran alterné et synchronized
output DEC 2026 (V8) : réimplémenter un émulateur VT est un projet à part entière.

Asset unique, **zéro réseau** : `terminal.html` contient xterm.js, `addon-fit` et `addon-webgl`
inlinés au build. Aucun CDN, l'app doit fonctionner sur un réseau qui ne voit qu'un Mac.

```ts
// Pont descendant. Les octets arrivent en frames WS binaires, convertis en base64 une seule fois.
const pending: string[] = [];
let scheduled = false;
export function onTermData(b64: string) {
  pending.push(b64);
  if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }  // 1 injection par frame
}
function flush() {
  scheduled = false;
  if (!pending.length) return;
  webviewRef.current?.injectJavaScript(`window.__kl.write(${JSON.stringify(pending)});true;`);
  pending.length = 0;
}
```

```js
// terminal.html
window.__kl = {
  term: new Terminal({ fontSize: 12, fontFamily: 'Menlo, monospace', scrollback: 5000 }),
  write(chunks) {
    for (const b64 of chunks) {
      const bin = atob(b64), a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      this.term.write(a);   // xterm.js gère l'UTF-8 et l'ANSI coupés entre deux chunks
    }
  },
  resync(cols, rows, text, cur) {
    this.term.reset(); this.term.resize(cols, rows);
    this.term.write(text.split('\n').join('\r\n'));
    this.term.write('\x1b[' + (cur.row + 1) + ';' + (cur.col + 1) + 'H');
  }
};
```

Points structurants :

- On ne réassemble **jamais** les octets côté React Native. `term.write(Uint8Array)` gère les
  séquences coupées, c'est exactement pourquoi on lui passe les chunks tels quels.
- Sans la coalescence par frame, `injectJavaScript` est appelé des centaines de fois par seconde
  et le thread JS s'effondre.
- **La frappe ne passe pas par `onData` brut.** Le flux `onData` de xterm.js est traduit en
  `KeyName[]` par une table côté React Native, et tout ce qui n'y figure pas est jeté.
  `term.input` du protocole ne transporte que des `KeyName`. Le texte libre passe par le composer
  et `pane.sendText`, jamais par le terminal.
- **Barre d'accessoires** au-dessus du clavier (PRD B4) : `Esc`, `Tab`, `Ctrl`, les 4 flèches,
  `1` `2` `3`, `Entrée`, `/`, `@`, `Ctrl+C`. `Ctrl+C` demande une **confirmation par glissement**,
  comme le Stop. Le clavier iOS n'a aucune de ces touches.
- **`Adapter à mon écran`** (PRD B5) : action explicite qui envoie `resize-pane`, avec une action
  `Rétablir`. Par défaut on rend à la largeur réelle du pane Mac avec défilement horizontal : on
  ne casse pas l'affichage de Robin sans qu'il le demande.
- WebGL activé, repli canvas si le contexte est perdu (arrive en arrière-plan). WebView démontée
  au détachement pour libérer le scrollback.

### 3.4 État et cache hors ligne

Deux tables SQLite et un fichier JSON. Pas quatre tables : un utilisateur, un instantané.

```sql
CREATE TABLE turns (session_id TEXT, seq INTEGER, id TEXT, kind TEXT, ts TEXT, json TEXT,
                    PRIMARY KEY (session_id, seq));                    -- lot 2
CREATE TABLE outbox (nonce TEXT PRIMARY KEY, kind TEXT, pane_id INTEGER,
                     payload TEXT, created_at INTEGER, expires_at INTEGER,
                     attempts INTEGER DEFAULT 0);
-- snapshot.json : { panes, tabs, etag, fetchedAt, lastPrompts: { [paneId]: Prompt } }
```

**Expiration de l'outbox, imposée par le PRD 5.3 et par C1.** Une approbation rejouée
tardivement est le pire accident possible :

| `kind` | TTL | Au-delà |
|---|---|---|
| `answer` | **60 s** | **Jamais envoyée.** Notification locale : "Réponse abandonnée, la question a peut-être changé." |
| `message` | 15 min, file plafonnée à 5 | Confirmation explicite demandée avant envoi |

La purge tourne au démarrage de l'app et avant chaque vidange. Une `answer` porte de toute façon
son `promptHash` : même envoyée dans la fenêtre de 60 s, le daemon la refuse si l'écran a changé.
Les deux protections sont indépendantes et cumulatives.

Ce que Robin voit **sans réseau**, sans écran de chargement :

| Écran | Contenu |
|---|---|
| Sessions | Tous les panes du dernier instantané, **grisés**, avec "il y a 12 min". Aucun badge animé : un état périmé ne doit pas mentir. |
| Question | La dernière question connue, en lecture seule, bandeau "hors ligne, état figé". **Les boutons sont désactivés** : approuver en aveugle sur un état inconnu est exactement ce que le produit doit empêcher. |
| Chat (lot 2) | 200 derniers turns par session visitée, navigables. Résultats externalisés et sous-agents marqués "non téléchargé". |
| Composer (lot 2) | Actif, part dans l'outbox avec son TTL de 15 min. |
| Terminal (lot 2) | Dernier resync, lecture seule, bandeau "instantané figé". Saisie désactivée. |

Purge : 200 turns par session, 20 sessions les plus récentes, le reste supprimé au démarrage.

### 3.5 Connexion (A11)

**Un seul chemin : Tailscale.** L'écouteur LAN est supprimé. Tailscale établit **déjà** une
connexion directe de pair à pair quand les deux appareils sont sur le même réseau local, donc la
latence LAN est obtenue sans écrire une ligne de plus. Il n'y a ni course, ni bascule, ni
`Endpoints.lan`, ni route collante, ni `LAN_HEAD_START_MS`.

```ts
const BASE = `https://${tsDns}:8765`;      // reçu à l'appairage, stocké en Keychain
```

Ce qui remplace la bascule : un **indicateur direct ou relayé**. Le daemon exécute
`tailscale status --json` toutes les 30 s, retrouve le pair correspondant à l'adresse source du
client, et expose `link.relay` (`null` si direct, sinon le nom du DERP) dans `hello.ok` et
`daemon.status`. Robin comprend sa latence sans avoir à deviner.

**Reconnexion.** Ping applicatif toutes les 20 s, timeout 8 s, deux `pong` manqués consécutifs
déclenchent la reconnexion. Backoff `250, 500, 1000, 2000, 4000, 8000, 15000` ms, jitter 20 %,
remis à zéro sur `hello.ok`. **Pas de backoff** sur un changement de réseau détecté par
`expo-network` ni sur un retour au premier plan : ce sont des événements, pas des échecs.

Reprise, dans l'ordre : `hello` avec `resume.panesEtag` (si l'etag correspond, le serveur ne
renvoie pas la liste), `panes.subscribe`, `pane.peek` sur le pane affiché, puis au lot 2
`session.attach {afterSeq, lastTurnId, lastTurnBlockCount}` pour la **seule** session visible et
`term.attach` si l'onglet terminal est affiché. Vidange de l'outbox après purge des expirés.

L'app ne s'abonne jamais aux sessions non visibles. Une session attachée à la fois.

**Limite acceptée (A11).** Au démarrage à froid sans aucun accès Internet, Tailscale peut échouer
à s'authentifier. Cas marginal pour un usage mono-utilisateur, assumé et affiché dans l'app.

**IPv6.** Tailscale préfère souvent IPv6 sur un réseau mobile. Le daemon écoute sur son adresse
Tailscale IPv4 (`100.64.0.0/10`) **et** IPv6 (`fd7a:115c:a1e0::/48`), toujours par adresse
explicite, jamais `::` ni `0.0.0.0`.

---

## 4. Sécurité

### 4.1 Contrainte 1, bind exclusif

```ts
export function resolveBinds(): string[] {
  const addrs = ['127.0.0.1', '::1'];
  for (const list of Object.values(networkInterfaces()))
    for (const ni of list ?? []) {
      if (ni.internal) continue;
      if (ni.family === 'IPv4' && isTailscale4(ni.address)) addrs.push(ni.address);
      if (ni.family === 'IPv6' && isTailscale6(ni.address)) addrs.push(ni.address);
    }
  return [...new Set(addrs)];
}
const isTailscale4 = (a: string) => { const o = a.split('.').map(Number);
  return o[0] === 100 && o[1] >= 64 && o[1] <= 127; };                  // CGNAT
const isTailscale6 = (a: string) => a.toLowerCase().startsWith('fd7a:115c:a1e0');
```

Un `https.Server` par adresse, `server.listen(port, address)`. `0.0.0.0` et `::` n'apparaissent
nulle part dans le code, et un test unitaire le vérifie. **Aucun écouteur LAN** (A11), donc plus
aucune divergence avec la contrainte 6.1 : loopback et Tailscale, exactement.

L'adresse Tailscale n'existe qu'une fois Tailscale démarré. Le daemon **re-scanne les interfaces
toutes les 30 s** et ouvre ou ferme les écouteurs en conséquence. Sans cela, un daemon lancé au
login avant Tailscale resterait injoignable jusqu'au prochain redémarrage.

### 4.2 Contrainte 2, appairage et cycle de vie du jeton (C8)

**QR d'appairage.** Charge utile réduite au strict nécessaire : le certificat étant validé par la
chaîne système, il n'y a plus d'empreinte SPKI à transporter.

```
kovalink://pair#<base64url({ v:1, code, tsDns, port })>
```

`code` = 24 octets aléatoires en base64url, **usage unique, TTL 3 minutes** (C8). Affiché par
`kovalinkd pair` dans le terminal, donc hors bande.

**Effacement du QR.** À la consommation du code ou à son expiration, le daemon **efface le QR de
l'écran** (séquence d'effacement puis repositionnement). Motif : le terminal de Robin est un pane
Kova, donc tout ce qui s'y affiche atterrit dans `~/Library/Logs/Kova/pty-capture-*.raw`, un
fichier en **0644** lisible par tout compte local. Le TTL de 3 minutes limite le risque,
l'effacement le referme.

**Dérivation et vérification.**

```ts
// Secret maître dans le TROUSSEAU macOS, pas dans un fichier (C8).
// Motif aggravant : cinq sessions Claude Code tournent en permanence sous cet uid et
// peuvent lire n'importe quel fichier en clair.
function loadMasterSecret(): Buffer {
  try {
    return Buffer.from(execFileSync('/usr/bin/security',
      ['find-generic-password', '-s', 'io.claap.kovalinkd', '-a', 'master', '-w'],
      { encoding: 'utf8' }).trim(), 'base64');
  } catch {
    const s = randomBytes(32);
    execFileSync('/usr/bin/security', ['add-generic-password', '-s', 'io.claap.kovalinkd',
      '-a', 'master', '-w', s.toString('base64'), '-T', process.execPath, '-U']);
    return s;
  }
}

// Appairage : jeton recalculable, donc devices.json ne contient aucun matériel sensible.
const exp = Math.floor(Date.now() / 1000) + 90 * 86400;              // expiration 90 jours
const deviceId = randomBytes(9).toString('base64url');
const token = createHmac('sha256', master).update(`v1|${deviceId}|${exp}`).digest('base64url');
// transmis à l'appareil sous la forme <deviceId>.<exp>.<token>

// Vérification, à chaque requête HTTP et à l'upgrade WS :
const [id, expStr, presented] = bearer.split('.');
if (Number(expStr) * 1000 < Date.now()) throw err('TOKEN_EXPIRED');
const expected = createHmac('sha256', master).update(`v1|${id}|${expStr}`).digest();
if (!timingSafeEqual(Buffer.from(presented, 'base64url'), expected)) throw err('UNAUTHORIZED');
if (devices[id]?.revoked) throw err('UNAUTHORIZED');
```

- **Renouvellement silencieux** : à moins de 15 jours de l'expiration, `hello.ok` porte un
  nouveau jeton que l'app remplace en Keychain.
- **Révocation** immédiate depuis l'écran Réglages (`Révoquer et effacer`), qui coupe aussi les
  WS ouverts de l'appareil.
- **Rotation globale** en supprimant l'entrée du trousseau : tous les appareils sont déconnectés,
  réappairage requis.
- Comparaison **à temps constant** partout.

**Règle de rédaction des journaux (C8), non négociable.**

```ts
fastify({ logger: { redact: { paths: ['req.headers.authorization', 'req.headers.cookie',
                                      'req.query.ticket', '*.token', '*.pairingCode'],
                              remove: true } } });
```

Le jeton n'apparaît dans **aucun** log, **aucune** URL, **aucun** message d'erreur, et il ne
transite jamais par `Sec-WebSocket-Protocol` (qui est renvoyé tel quel dans la réponse de
handshake). Test unitaire du lot 4 : un cycle de connexion complet suivi d'un `grep` du fichier
de log, qui doit ne rien trouver.

Côté iPhone : `expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, groupe de trousseau partagé
avec la Notification Service Extension. Le jeton ne quitte jamais l'appareil, n'est pas
sauvegardé dans iCloud, et n'est pas restauré sur un nouvel iPhone.

### 4.3 Contrainte 3, journal d'audit

`~/.kovalink/audit/YYYY-MM-DD.jsonl`, mode 0600, une entrée par ligne, flush à chaque entrée.
Rotation quotidienne, **conservation 30 jours** (PRD 5.5), purge au démarrage.

```jsonc
{"ts":"2026-09-10T15:22:41.812Z","deviceId":"kQ8x-vT2","action":"fs.read",
 "path":"<home>/dev/x.env","bytes":184,"result":"ok"}
{"ts":"2026-09-10T15:22:55.004Z","deviceId":"kQ8x-vT2","action":"pane.answer",
 "paneId":66,"result":"ok","detail":"index=1 kind=approve"}
{"ts":"2026-09-10T15:23:02.771Z","deviceId":"kQ8x-vT2","action":"pane.answer",
 "paneId":66,"result":"denied","detail":"prompt_changed"}
```

- **Toute** lecture et **toute** écriture de fichier produit une entrée, refus et erreurs d'I/O
  compris, `fs.list` compris (il divulgue des noms).
- Le **contenu** n'est jamais journalisé : pour un fichier, chemin et taille seulement ; pour une
  réponse, l'index et la nature de l'option, **jamais le libellé** ; pour un message libre, la
  longueur seulement, jamais le texte, car Robin y tape parfois des secrets.
- Se lit sur le Mac avec `tail`. Aucune UI mobile, aucune route HTTP (C17).

### 4.4 Contrainte 3bis, liste noire (C5)

**La lecture reste totale sur tout le disque**, conformément au choix de Robin. **L'écriture est
refusée** sur une liste courte et explicite. Ces chemins ne sont pas "les fichiers de Robin", ce
sont les mécanismes de démarrage automatique et d'authentification de la machine. Les exclure ne
retire aucun usage réel et empêche un vol de jeton de se transformer en prise de contrôle
persistante.

```jsonc
// ~/.kovalink/config.json, déclaratif. Robin peut vider la liste s'il le décide.
{
  "denyWrite": [
    "~/Library/LaunchAgents", "~/Library/LaunchDaemons", "/Library/LaunchAgents",
    "/Library/LaunchDaemons", "/Library/StartupItems",
    "~/.kovalink",
    "~/.ssh", "~/.aws", "~/.gnupg",
    "~/.config/kova", "~/.claude",
    "~/.zshrc", "~/.zprofile", "~/.zshenv", "~/.bashrc", "~/.bash_profile", "~/.profile",
    "/etc", "~/Library/Application Support"
  ],
  "denyWriteRules": ["segment:.app", "segment:.git/hooks", "segment:node_modules",
                     "name:package.json", "mode:executable"],
  "denyRead": ["~/.kovalink", "~/Library/Logs/Kova"]
}
```

- `segment:.app` : tout chemin dont un segment se termine par `.app`.
- `mode:executable` : tout fichier existant dont le mode porte un bit `x`.
- `denyRead` contient `~/.kovalink` (secrets et audit : un jeton compromis ne doit pas pouvoir
  effacer ses traces) et `~/Library/Logs/Kova` (les `.raw` en 0644 contiennent l'historique des
  panes, y compris le QR d'appairage affiché avant son effacement).

- `name:package.json` : un `postinstall` s'exécuterait au prochain `npm install`.
- `segment:node_modules` : même raison, et aucun usage légitime depuis un téléphone.

Refus en `403 PATH_DENIED` avec entrée d'audit `result:"denied"`. Test unitaire au lot 3, une
assertion par entrée de la liste.

**Ce que cette liste est, et ce qu'elle n'est pas.** C'est une **réduction de surface**, pas une
frontière de sécurité. Elle ferme les chemins connus qui transforment un jeton volé en exécution
de code persistante. Elle ne prétend pas être exhaustive, et elle ne le sera jamais : la vraie
frontière reste le jeton, son expiration et sa révocation. Cette formulation est la seule qui ne
se périme pas quand un nouveau chemin d'exécution apparaît.

### 4.5 Contrainte 4, TLS (A12)

**Certificat `tailscale cert <machine>.<tailnet>.ts.net`** : Let's Encrypt, publiquement valide,
validé par la chaîne de confiance système d'iOS. Conséquences : plus d'épinglage SPKI, plus de
module natif Swift, `fetch` et `WebSocket` standards. C'est la simplification la plus rentable de
cette passe.

```ts
// Renouvellement : tâche quotidienne. tailscale cert réutilise sa clé, il n'y a rien à épingler.
if (daysUntilExpiry(certPath) < 21)
  execFileSync('/usr/bin/tailscale', ['cert', '--cert-file', certPath,
                                      '--key-file', keyPath, tsDns]);
```

`https.createServer({ key, cert, minVersion: 'TLSv1.2' })`. Aucun écouteur en clair,
`GET /health` compris.

**Repli documenté** si la fonction HTTPS du tailnet ne peut pas être activée : certificat
auto-signé épinglé. Dans ce cas la clé doit être **générée une seule fois** et réutilisée, sinon
le SPKI change à chaque réémission et l'épinglage casse chez tous les appareils appairés (C14) :

```ts
// selfsigned.generate() régénère la clé à chaque appel : inutilisable pour un SPKI stable.
const privateKey = existsSync(keyPath)
  ? readFileSync(keyPath, 'utf8')
  : (() => {
      const kp = generateKeyPairSync('rsa', { modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding:  { type: 'spki',  format: 'pem' } });
      writeFileSync(keyPath, kp.privateKey, { mode: 0o600 });
      return kp.privateKey;
    })();
// puis node-forge, qui accepte une clé fournie, pour n'émettre QUE le certificat.
```

Ce repli ramène le module natif Swift, il n'est donc pas le chemin principal.

### 4.6 Contrainte 5, jamais root

LaunchAgent en domaine `gui/<uid>`, refus de démarrer si `getuid() === 0`, port 8765 sans
privilège, aucun `sudo`, aucun helper privilégié, aucune installation dans `/Library`.

Les autorisations TCC (Bureau, Documents, Téléchargements) sont accordées à `node` au premier
refus. Limite connue et documentée : accorder l'accès complet au disque à `/usr/local/bin/node`
l'accorde à tout script Node. Dette identifiée au lot 4 : empaqueter le daemon dans un
`KovaLinkd.app` signé pour obtenir une identité TCC dédiée. Non bloquant au départ.

---

## 5. Notifications push

### 5.1 Chaîne complète

Le déclencheur est `pane-status.awaiting`. Il se lève **aussi bien** quand l'agent demande une
permission que quand il a fini son tour et attend l'instruction suivante. La chaîne est donc
identique dans les deux cas, seul le rendu à l'ouverture diffère (0.1).

```
L'agent s'arrete : il a fini son tour, ou il demande une permission
   |
   v Kova met a jour l'etat du pane
{"pane-status", pane_id:66, awaiting:true, awaiting_since:"..."}   (connexion subscribe)
   |
   v PromptParser (2.3) : get-pane-content -> Prompt{parsed|unparsable} + promptHash + promptRef
PushSender.onAwaiting()
   1. front montant seulement
   2. anti-rebond 3 s : si awaiting retombe avant, annulation
   3. suppression : client connecte ET ecran de cette session ouvert ET app au premier plan
   4. heures calmes 23h-7h, sauf si awaiting dure depuis plus de 10 min
   5. charge utile SANS AUCUN CONTENU, et sans paneId : seulement promptRef (A14, C24)
   |
   v @expo/server-sdk
POST https://exp.host/--/api/v2/push/send   -->  APNs  -->  iPhone
   |
   v Notification Service Extension (C4), AVANT affichage
   GET https://<tsDns>/v1/prompt/<promptRef>   (canal chiffre direct, jeton NSE dedie)
   |  parsed     -> corps reecrit : question, detail, liste numerotee des options
   |                categorie statique choisie selon le NOMBRE d'options (C25)
   |  unparsable
   |  ou echec   -> "Validation requise", categorie KL_OPEN : Ouvrir et Interrompre (C27)
   v
Banniere : "cc . link"
           "Autoriser Edit sur 02-design.md ?
            Modifie 42 lignes, supprime 3
            1 Oui   2 Oui, ne plus redemander   3 Non"
           [1] [3] [Interrompre]
```

Charge utile envoyée, vide de tout contenu sensible et de tout identifiant de pane :

```ts
await expo.sendPushNotificationsAsync([{
  to: device.expoPushToken,
  title: `${pane.title ?? 'claude'} . ${pane.projectName}`,   // JAMAIS l'ai-title, qui est
                                                              // genere depuis le contenu
  body: 'Validation requise',                                 // reecrit par la NSE
  sound: 'default', priority: 'high',
  categoryId: 'KL_OPEN',                                      // releve par la NSE si elle reussit
  mutableContent: true,                                       // indispensable pour la NSE
  ttl: 600,                                                   // au dela, l'info est perimee
  collapseId: `p-${promptRef.slice(0, 8)}`,
  badge: awaitingCount,
  data: { kind: 'awaiting', promptRef, issuedAt: Date.now(),
          deepLink: `kovalink://prompt/${promptRef}` },        // l'app resout la reference
}]);
```

**Notification Service Extension.** Cible ajoutée par config plugin (`@bacons/apple-targets`),
entitlement `keychain-access-groups` partagé avec l'app pour lire le jeton NSE et `tsDns`.

**Ce que la NSE peut faire, et ce qu'elle ne peut pas (C25).** Une extension **ne peut pas**
enregistrer de catégorie ni renommer les boutons d'une catégorie existante : ce n'est pas une
capacité documentée par Apple, et le document ne s'appuie pas dessus. Les catégories sont donc
**pré-enregistrées statiquement** par l'app, et les boutons portent les **chiffres**. La NSE
réécrit le **corps** de la bannière avec la question, le détail et la liste numérotée des
options : Robin lit ce que fait chaque chiffre avant d'appuyer dessus.

```swift
// targets/notification-service/NotificationService.swift
override func didReceive(_ req: UNNotificationRequest,
                         withContentHandler h: @escaping (UNNotificationContent) -> Void) {
  let c = req.content.mutableCopy() as! UNMutableNotificationContent
  guard let cfg = SharedKeychain.load(),
        let ref = c.userInfo["promptRef"] as? String else { return h(c) }   // reste KL_OPEN

  // Budget NSE : environ 30 s. On s'arrete bien avant.
  fetchPrompt(cfg, ref, timeout: 6) { p in
    guard let p = p, p.state == "parsed" else { return h(c) }   // C27 : KL_OPEN conserve

    // Corps : tout ce qui est hache, et rien d'autre (regle de 2.3).
    var body = p.question
    if !p.detail.isEmpty { body += "\n" + p.detail.joined(separator: "\n") }
    body += "\n" + p.options.map { "\($0.index) \($0.label)" }.joined(separator: "   ")
    c.body = body
    c.userInfo["promptHash"]    = p.promptHash
    c.userInfo["awaitingSince"] = p.awaitingSince
    c.userInfo["optionKinds"]   = p.options.map { $0.kind }     // pour le libelle d'audit

    // C30 : iOS n'affiche que 4 actions. Interrompre n'est JAMAIS retire.
    // Au dela de 4 options, aucune action rapide : ouverture forcee.
    c.categoryIdentifier = p.options.count <= 3 ? "KL_OPT\(p.options.count)" : "KL_OPEN"
    h(c)
  }
}
```

**Catégories statiques.** Quatre au total, enregistrées une fois au lancement de l'app :

| Catégorie | Quand | Actions, dans l'ordre |
|---|---|---|
| `KL_OPT2` | prompt parsé, 2 options | `1`, `2`, `Interrompre` |
| `KL_OPT3` | prompt parsé, 3 options | `1`, `2`, `3`, `Interrompre` (4 actions, la limite) |
| `KL_OPEN` | `unparsable`, échec de la NSE, ou **plus de 3 options** | `Ouvrir`, `Interrompre` |
| `KL_DONE` | l'agent a fini et ne demande rien | `Ouvrir`, `Interrompre` |

Règle de troncature (C30) : les options par ordre d'index croissant, puis `Interrompre`.
`Interrompre` n'est **jamais** retiré, c'est l'action sûre. Au-delà de 3 options, la liste ne tient
pas dans les 4 actions d'iOS sans sacrifier `Interrompre` : on bascule sur `KL_OPEN` et Robin
ouvre l'app, où la barre de validation affiche le gabarit C du design.

Il n'existe **aucune** action de saisie de texte libre depuis une bannière (C26). Un champ
`Répondre` sans authentification permettrait de taper `1` depuis un iPhone verrouillé, sans Face
ID, sans hash et sans relecture : il contournerait les trois garde-fous à la fois.

**Second déclencheur, `KL_DONE`.** `pane-working` passant à `false` sans `awaiting`, **seulement**
si le pane a travaillé plus de **60 s** (C29, valeur du PRD). Priorité `normal`, aucune action
d'approbation.

**Receipts.** Les tickets Expo sont relus 15 minutes après l'envoi par une tâche périodique.
`DeviceNotRegistered` supprime le jeton de `devices.json`. Sans cela on pousse indéfiniment vers
un appareil désinstallé. Trente lignes, c'est la seule complexité qu'impose le push Expo.

**Retrait automatique.** Quand `awaiting` retombe (Robin a répondu sur son Mac), le daemon envoie
un push silencieux qui retire la bannière via son `collapseId`, invalide le `promptRef`, et pousse
`prompt {state:'none'}` aux clients connectés.


### 5.2 Actions rapides et Face ID (A2, A10)

```ts
const OPEN: NotificationAction[] = [
  { identifier: 'open', buttonTitle: 'Ouvrir',
    options: { opensAppToForeground: true } },
  { identifier: 'interrupt', buttonTitle: 'Interrompre',
    options: { opensAppToForeground: false, isAuthenticationRequired: false } },   // A2
];

await Notifications.setNotificationCategoryAsync('KL_OPT2', [
  { identifier: 'opt1', buttonTitle: '1',
    options: { opensAppToForeground: false, isAuthenticationRequired: true } },    // A2
  { identifier: 'opt2', buttonTitle: '2',
    options: { opensAppToForeground: false, isAuthenticationRequired: true } },
  ...OPEN.slice(1),                                    // Interrompre, sans authentification
]);
// KL_OPT3 : opt1, opt2, opt3, interrupt.   KL_OPEN et KL_DONE : OPEN.
```

**Authentification asymétrique, sur le sens du risque (A2).** Toute action qui **répond** à un
prompt exige Face ID, quelle que soit l'option : le client ne sait pas, au moment où il enregistre
la catégorie, si l'option 2 est un refus ou un "ne plus redemander". Traiter tous les chiffres
comme engageants est la seule règle qui reste juste sans connaître le prompt. `Interrompre` et
`Ouvrir` ne demandent rien : interrompre est l'action sûre par défaut, et exiger Face ID dessus
ajouterait de la friction sur le geste défensif, ce qui pousserait à approuver par facilité.

**Traitement de la réponse.** iOS peut relancer un processus mort et n'accorde que quelques
secondes. La tâche est donc enregistrée avant tout rendu React.

```ts
// index.js, AVANT le rendu, pour couvrir le demarrage a froid
TaskManager.defineTask(NOTIF_RESPONSE_TASK, ({ data }) => handleQuickAction(data));
Notifications.registerTaskAsync(NOTIF_RESPONSE_TASK);

export async function handleQuickAction(resp: NotificationResponse) {
  const d = resp.notification.request.content.data as AwaitingData;
  const id = resp.actionIdentifier;

  if (id === 'open') return openApp(d.deepLink);

  if (id === 'interrupt') {
    // Aucun hash, aucune authentification : c'est l'action sure, elle doit toujours passer.
    return postWithOutbox('interrupt', { paneId: await resolveRef(d.promptRef),
                                         nonce: randomUUID(), expiresAt: Date.now() + 60_000 });
  }

  const optionIndex = Number(id.replace('opt', ''));
  if (!optionIndex || !d.promptHash) return openApp(d.deepLink);   // NSE en echec : on ouvre

  const job = { nonce: randomUUID(), promptRef: d.promptRef, optionIndex,
                promptHash: d.promptHash, awaitingSince: d.awaitingSince,
                expiresAt: Date.now() + 60_000 };                  // PRD 5.3

  await enqueueOutbox('answer', job);        // persistance AVANT toute I/O reseau
  try {
    // HTTP direct, pas de WebSocket : une poignee de main consommerait la moitie du budget.
    const body = await postAnswer(job, { timeoutMs: 3500 });
    await dequeueOutbox(job.nonce);
    if (body.applied) await Notifications.dismissNotificationAsync(resp.notification.request.identifier);
    else await localNotice(body.reason === 'prompt_changed'
      ? "La question a change, ta reponse n'a pas ete envoyee. Ouvre l'app."
      : 'Deja repondu.');
  } catch {
    await localNotice('Mac injoignable. Ta reponse sera abandonnee dans 60 s.');
    // L'outbox la purgera. Une approbation vieille de deux heures ne doit JAMAIS partir.
  }
}
```

Le `409 PROMPT_CHANGED` est le cas qui compte : Robin a répondu sur son Mac, puis appuie par
réflexe sur la bannière restée affichée. Le daemon relit l'écran, le hash ou l'`awaitingSince`
diffère, il refuse, et l'app le dit.

### 5.3 Écran Réglages, quatre entrées (C17, C28)

| Réglage | Défaut | Motif |
|---|---|---|
| Seulement les validations | non | Soupape anti-bruit, coupe `KL_DONE` et garde `KL_OPT*`. Évite que Robin coupe tout |
| Heures silencieuses (23h à 7h, plage non réglable) | oui | Comportement réellement différent la nuit |
| Empêcher le Mac de dormir | oui | Imposé par A1 |
| Révoquer et effacer | action | Bouton d'urgence si l'iPhone est perdu |

Le réglage `Extraits dans les notifications` est **supprimé** (C28). Il n'a plus d'objet : la
charge utile ne contient jamais de contenu, et la NSE récupère toujours la question sur le canal
chiffré direct. Le laisser à `off` aurait tué toutes les actions rapides, le laisser à `on`
n'aurait rien changé.

Il n'existe pas de `Muter` par balayage (C31) : couper silencieusement et définitivement la
notification qui justifie le produit est un piège. Les heures calmes couvrent le besoin.

Tout le reste est en dur : thème sombre (A9), main droite, code 13 pt, terminal 12 pt, outils
repliés, son actif. Chaque interrupteur exposé est une décision que le concepteur n'a pas prise.

## 6. Build et distribution

### 6.1 `app.config.ts`

```ts
export default {
  name: 'KovaLink', slug: 'kovalink', scheme: 'kovalink',
  version: '1.0.0', orientation: 'portrait', userInterfaceStyle: 'dark',   // A9
  runtimeVersion: { policy: 'fingerprint' },
  updates: { url: 'https://u.expo.dev/<projectId>' },
  ios: {
    bundleIdentifier: 'io.claap.kovalink',
    supportsTablet: false, buildNumber: '1',
    entitlements: {
      'aps-environment': 'production',
      'keychain-access-groups': ['$(AppIdentifierPrefix)io.claap.kovalink'],   // partagé NSE
      'com.apple.security.application-groups': ['group.io.claap.kovalink'],    // lot 3
    },
    infoPlist: {
      NSCameraUsageDescription: "Scanner le QR code d'appairage affiché sur ton Mac.",
      NSFaceIDUsageDescription: "Confirmer une approbation avec Face ID.",
      NSPhotoLibraryUsageDescription: "Envoyer des photos vers ton Mac.",
      UIBackgroundModes: ['remote-notification'],
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      // Pas de NSLocalNetworkUsageDescription : il n'y a plus d'écouteur LAN (A11).
    },
  },
  plugins: [
    'expo-router', 'expo-secure-store', 'expo-sqlite',
    ['expo-notifications', { icon: './assets/notif.png', color: '#0b0d10' }],
    ['expo-camera', { cameraPermission: "Scanner le QR d'appairage." }],
    'expo-local-authentication',
    ['@bacons/apple-targets', { targets: ['./targets/notification-service'] }],   // NSE, C4
    ['expo-build-properties', { ios: { deploymentTarget: '16.0' } }],
    // lot 3 seulement :
    // ['expo-share-intent', { iosAppGroupIdentifier: 'group.io.claap.kovalink' }],
  ],
};
```

### 6.2 `eas.json`

```jsonc
{
  "cli": { "version": ">= 24.0.0", "appVersionSource": "remote" },
  "build": {
    "base": { "ios": { "resourceClass": "m-medium" }, "node": "20.20.1" },
    "development": { "extends": "base", "developmentClient": true,
                     "distribution": "internal", "channel": "development" },
    "preview":     { "extends": "base", "distribution": "internal",
                     "ios": { "buildConfiguration": "Release" }, "channel": "preview" },
    "production":  { "extends": "base", "distribution": "store",
                     "autoIncrement": "buildNumber", "channel": "production" }
  },
  "submit": { "production": { "ios": { "appleId": "tech@claap.io",
                                       "ascAppId": "<après création de la fiche>",
                                       "appleTeamId": "<team id Claap>" } } }
}
```

**Xcode est absent de la machine** : `eas build --local` et `expo run:ios` sont impossibles. On
part donc sur des **builds EAS cloud**, qui gèrent aussi les certificats et la clé APNs. Le
développement quotidien se fait sur le client de développement installé une fois, avec
rechargement à chaud. Xcode ne devient utile qu'au lot 2 si la NSE ou la WebView demandent
beaucoup d'allers-retours natifs.

### 6.3 TestFlight et OTA

- `eas build -p ios --profile production` puis `eas submit`. Testeurs internes, aucun examen App
  Store, disponible en quelques minutes. Le profil `preview` sert de canal plus rapide.
- OTA via `expo-updates`, `runtimeVersion.policy = 'fingerprint'` : l'empreinte inclut la NSE et
  les config plugins, donc une OTA ne peut pas s'appliquer à un build natif incompatible. Une
  politique `appVersion` provoquerait des crashs au lancement.
- `checkAutomatically: ON_LOAD`, application au redémarrage suivant, jamais de rechargement forcé
  en pleine session.
- **Compatibilité.** Une OTA peut mettre à jour l'app sans le daemon. `hello.ok` porte `protocol`
  et `daemonVersion` : si l'app exige davantage, elle affiche la commande exacte de mise à jour du
  daemon à coller sur le Mac.

### 6.4 Share Extension (lot 3)

Config plugin **`expo-share-intent`**, App Group `group.io.claap.kovalink`.

Pourquoi celui-là plutôt que `expo-share-extension` : il crée l'extension, la configure, et
**transmet le partage à l'app principale** qui l'ouvre normalement. On réutilise donc le sélecteur
de destination et toute la logique d'upload avec reprise. Avec `expo-share-extension`, il faudrait
écrire une seconde interface React vivant dans le processus de l'extension, avec sa limite mémoire
de 120 Mo et sans accès au trousseau de l'app sans partage explicite. Beaucoup plus de travail
pour un confort marginal.

Le plugin met en place au `prebuild` : la cible `ShareExtension` et ses `NSExtensionActivationRule`
(fichiers, images, vidéos, texte, URL), l'App Group sur les deux cibles, et le rappel
`kovalink://`.

Côté app : `useShareIntentContext()` donne les chemins dans le conteneur partagé. **Le fichier est
copié hors du conteneur avant l'upload**, iOS le purge. Le sélecteur de destination est alimenté
par `GET /v1/fs/quickdests`, qui met **en tête le `cwd` du pane focalisé** : c'est littéralement
le "directement dans le bon dossier" demandé par Robin.

Sens inverse : `GET /v1/fs/read` puis `expo-sharing` pour la feuille de partage iOS.

---

## 7. Plan d'implémentation

Quatre lots. Chacun est démontrable iPhone en main.

**Chiffrage (C33).** Les estimations de la passe 2 étaient optimistes de 26 %, mesuré par le
panel. Celles-ci sont les totaux réels des tableaux, dépendances comprises, et le lot 1 absorbe
désormais le rendu du transcript (C36). Une estimation flatteuse ne rend service à personne.

### Lot 1, "l'agent a fini, je donne la suite", environ 2 600 lignes, 5 à 6 jours

**Livrable :** l'agent de Robin s'arrête, son iPhone vibre, il ouvre, il lit le dernier échange,
il tape la suite ou il interrompt, l'agent repart. Il n'a pas ouvert son Mac.

**Pourquoi cette cible et non la validation (0.1).** Robin travaille en `bypassPermissions` :
Claude Code ne lui demande jamais rien. Le déclencheur `pane-status.awaiting` se lève quand même,
puisqu'il signale aussi la fin d'un tour. Le chemin critique va donc de la notification au
**rendu du dernier échange** et au **composer**, pas à la barre de validation. Celle-ci reste dans
le lot 1, mais comme filet pour les cas où un prompt survient malgré tout (mode plan, question
explicite de l'agent), pas comme justification.

| Daemon | lignes |
|---|---|
| `KovaIpc` : découverte (avec `ps`), sonde, watchdog 45 s, reconnexion, union `PaneContent` | 300 |
| `subscribe` sur `pane-status`, `pane-working`, `pane-open`, `pane-close`, plus `list-panes` | 150 |
| **`TranscriptTailer` : tail incrémental, `carry`, `StringDecoder`, triple garde, regroupement par `requestId` ordonné par `apiBlockIndex`, blocs, aperçus d'outils** | 400 |
| `PromptParser`, `promptHash` (question + detail + options), `promptRef`, revérification | 250 |
| `KeyGate` : quatre opérations, `sanitizeFreeText`, gardes d'état, `emitInterrupt` | 180 |
| Fastify, TLS `tailscale cert`, jeton HMAC en trousseau, jeton NSE, QR effaçable, 11 routes, WS, audit | 400 |
| `PushSender` : `KL_OPT*`, `KL_OPEN`, `KL_DONE`, `collapseId`, retrait automatique, receipts | 180 |
| `launchd`, assertion anti-veille, rotation des logs | 100 |

| App | lignes |
|---|---|
| Appairage : scan QR, Keychain, groupe de trousseau partagé | 150 |
| Sessions : 3 sections, badge d'état, badge `permissionMode`, âge, `Ouvrir`, `Interrompre` (A7) | 220 |
| **Session : rendu des turns (bulles, outils repliés, markdown simple), `FlashList`** | 320 |
| Composer : champ multi-ligne, envoi optimiste, outbox à 15 min | 120 |
| Barre de validation : boutons générés depuis les options réelles, Face ID sur les chiffres | 200 |
| Repli monospace du pane visible quand `unparsable` (A6 règle 2) | 30 |
| Notification Service Extension | 120 |
| Catégories statiques, actions rapides, outbox `answer` à TTL 60 s | 150 |
| Instantané JSON hors ligne, cache SQLite 2 tables, écran Réglages à 4 entrées | 150 |

Total : **2 620 lignes**.

**Prérequis d'installation** (une demi-journée) :
1. Tailscale sur le Mac et l'iPhone, MagicDNS et certificats HTTPS activés dans le tailnet.
2. Accès au compte Apple Developer Claap, premier build EAS.
3. **Au moins un projet configuré en mode de permission par défaut** (V11), et **un échantillon
   de rendu réel de prompt capturé et versionné** comme fixture dans `fixtures/prompts/`. Sans
   cela le parseur ne peut être validé contre rien, et les critères 6 à 8 ci-dessous restent
   inexécutables.

#### Critères d'acceptation

Exécutables immédiatement, tous binaires :

1. Robin est en 4G hors de son réseau. Un agent finit son tour. Une bannière arrive en moins de
   5 s et porte le nom du projet.
2. Il ouvre la session : le dernier message utilisateur et la dernière réponse assistant
   s'affichent, **regroupés en une seule bulle** par `requestId`, appels d'outils repliés.
3. Il tape un message et l'envoie. Il apparaît dans le fil, puis est confirmé par son apparition
   dans le JSONL en moins de 3 s.
4. Il appuie sur `Interrompre` depuis la **liste**, sur un pane qui travaille. **Aucune
   authentification n'est demandée**, l'agent s'arrête, et le journal d'audit porte une entrée
   `pane.interrupt`.
5. Kova est redémarré (nouveau PID). Sans action de Robin, la liste redevient à jour en moins de
   15 s.
6. Une session en `bypassPermissions` affiche le badge "aucune validation ne te sera demandée".
7. Après un cycle de connexion complet, `grep -ri "Bearer" ~/.kovalink/logs/` ne renvoie
   **aucune** ligne.
8. Un `PUT` d'upload vers `~/Library/LaunchAgents/x.plist` répond `403 PATH_DENIED` et produit une
   entrée d'audit `result:"denied"`.
9. `POST /v1/panes/:id/answer` rejoué avec le même `nonce` répond `{applied:false,
   reason:"duplicate"}` et n'envoie rien au pane.
10. `pane.sendText` vers un pane dont `agent === null` répond `FORBIDDEN_ACTION`.

**Non exécutables en l'état (C37)**, tant que le prérequis 3 n'est pas satisfait. Ils ne sont
**pas** déclarés satisfaits, et le lot 1 n'est pas recetté sans eux.

11. Sur un prompt réel à 3 options, la bannière affiche la question, le détail et les trois
    libellés numérotés, et propose les boutons `1`, `2`, `3` et `Interrompre`.
12. Robin appuie sur un chiffre depuis l'écran verrouillé : **Face ID est demandé**, puis l'agent
    repart en moins de 3 s.
13. **Deux demandes `Bash` consécutives portant des commandes différentes produisent deux
    `promptHash` différents** (C20). Test : capturer les deux écrans, appeler `hashPrompt` sur
    chacun, assertion de différence.
14. Robin répond sur son Mac, puis appuie sur un chiffre dans la bannière restée affichée. L'app
    affiche "La question a changé" et **aucun octet n'est envoyé au pane** (entrée d'audit
    `result:"denied" detail:"prompt_changed"`).
15. Pendant que Robin envoie un message libre, l'agent bascule en `awaiting` entre les deux
    `send-keys`. Le `\r` **ne part pas**, la réponse est `became_awaiting`, et la question est
    poussée au client (C23).
16. Un prompt que le parseur ne comprend pas produit une bannière `KL_OPEN` **sans aucune action
    d'approbation**, et l'écran affiche le pane en monospace **sans aucun bouton**.

**Procédure pour rendre 11 à 16 exécutables**, une demi-heure : lancer `claude` dans un projet de
test sans `--dangerously-skip-permissions` et sans `permissionMode` en configuration, provoquer
une écriture de fichier, capturer `get-pane-content mode:visible` dans
`fixtures/prompts/edit-3opt.txt`, recommencer avec deux `Bash` de commandes différentes pour le
critère 13. Les fixtures sont versionnées et rejouées en test unitaire, sans machine ni Kova.

### Lot 2, terminal et rendu riche, environ 2 500 lignes, 5 jours

`PtyStreamer` complet (resync, `fstat` 20 ms, coalescence 16 ms, contre-pression, `term.gap`,
repli continu B3), xterm.js en WebView et son pont binaire, barre de touches avec `Ctrl+C` à
confirmation par glissement, `Adapter à mon écran` (`resize-pane`), `pane.sendKeys` et
`term.input` avec leur garde d'état, sous-agents chargés à la demande, rendu des diffs et
coloration syntaxique, pagination `session.history`, `new-tab` par index de projet récent
(PRD A8), et l'investigation d'une demi-heure sur la vraie clé de jointure de
`<sessionId>/tool-results/` (V12).

**Acceptation :** Robin bascule sur le terminal et y tape `Esc` puis une flèche. Il coupe le
réseau 10 minutes, revient, et le turn qui était en cours au moment de la coupure est **complet**,
pas tronqué à son bloc `thinking`.

### Lot 3, fichiers et partage, environ 1 600 lignes, 4 jours

`FileEngine` en lecture seule plus upload (liste noire d'écriture, `O_NOFOLLOW`, `execFile`
uniquement), navigation, aperçus, téléchargement en flux avec `Range`, upload en trois temps avec
reprise, `quickdests`, avertissement cellulaire au-delà de 100 Mo, Share Extension et App Group.

**Acceptation :** Robin télécharge un fichier de 2 Go, coupe le Wi-Fi au milieu, la reprise repart
au bon octet. Depuis Photos il partage vers KovaLink, choisit le dossier du pane focalisé, le
fichier arrive sur le Mac.

### Lot 4, durcissement et distribution, environ 550 lignes, 2 jours

Matrice de reconnexion complète (Kova redémarré, Mac endormi puis réveillé, changement de réseau,
jeton expiré, jeton révoqué, protocole incompatible, pane fermé pendant l'affichage), purge des
`.raw` orphelins vérifiée par `ps`, renouvellement du certificat, renouvellement silencieux du
jeton, tests unitaires de la liste noire et de la rédaction des journaux, build `production`,
TestFlight, premier `eas update`, empaquetage éventuel du daemon en `.app` signé pour TCC.

**Acceptation :** on débranche tout dans tous les ordres, l'app se rétablit toujours sans
réinstallation ni réappairage.

Dépendances : 1 précède tout. 2 et 3 sont parallélisables après 1. 4 dépend de tout.

| Lot | Lignes | Jours |
|---|---|---|
| 1, l'agent a fini, je donne la suite | 2 620 | 5 à 6 |
| 2, terminal et rendu riche | 2 500 | 5 |
| 3, fichiers et partage | 1 600 | 4 |
| 4, durcissement et distribution | 550 | 2 |
| **Total** | **environ 7 300** | **16 à 17, plus une demi-journée de prérequis** |

Pour mémoire, la passe 1 spécifiait environ 8 700 lignes réparties sur huit lots, dont un lot 1
sans valeur d'usage. Le périmètre fonctionnel est le même, la structure est meilleure, et le
chiffre affiché est enfin celui des tableaux qui le composent.
## 8. Pièges identifiés

### Le prompt de validation, le chemin critique

| Piège | Parade |
|---|---|
| Envoyer `\r` valide **l'option surlignée sur le Mac**, pas celle lue sur le téléphone. Curseur sur "Yes, and don't ask again" et un tap accorde une permission permanente. | Il n'existe aucun `approve` générique dans le système. Le client fournit un `optionIndex`, le serveur émet `${optionIndex}` suivi du retour chariot. La position du curseur du Mac n'entre nulle part dans la décision, et le marqueur de surlignage est retiré avant le calcul du hash. |
| L'agent enchaîne sur une autre question entre le chiffre et l'Entrée. | Un seul `send-keys` atomique pour une réponse, aucun délai. |
| **Deux demandes `Bash` consécutives ont la même question et les mêmes libellés d'options, donc le même hash si celui-ci ne couvre pas le détail.** L'approbation destinée à `ls` s'applique alors à `rm -rf`. C'est le cas le plus courant, pas un cas limite. | Le hash couvre **question + detail + options** (2.3). Le `detail`, ce sont les 5 lignes au dessus de la question : la commande, le chemin, le résumé du diff. C'est exactement ce qui distingue deux demandes de même nature. Critère d'acceptation 13 du lot 1. |
| Deux prompts strictement identiques au caractère près se succèdent : même hash, légitimement. | Second garde-fou indépendant : `pane.answer` reporte l'`awaitingSince` reçu, comparé à `pane.awaiting_since` avant émission. Il discrimine l'occurrence, là où le hash discrimine le contenu. Les deux sont cumulatifs. |
| `awaiting === true` seul ne détecte pas qu'une question a changé. | Relecture systématique du pane, re-parse, comparaison du hash à temps constant, refus `prompt_changed`. Jamais d'état mis en cache pour cette décision. |
| Robin déplace son curseur sur le Mac, ou redimensionne son pane : le hash change et toutes les réponses sont refusées. | Le marqueur de surlignage est capturé et jeté par `OPTION_RE`, les espaces sont normalisés, les filets de cadre sont retirés. Le tableau des exclusions de 2.3 justifie chacune. |
| Un champ affiché à Robin mais non haché, ou haché mais non affiché. | Règle unique : **tout ce qui est affiché pour décider entre dans le hash, et rien de ce qui n'y entre pas n'est affiché.** Le type `Prompt` porte exactement les trois champs hachés, la NSE n'affiche qu'eux. |
| Une approbation hors ligne rejouée deux heures plus tard atterrit sur une autre question. | TTL de **60 s** dans l'outbox (PRD 5.3), au-delà elle est abandonnée avec une notification locale. Le hash et l'`awaitingSince` la refuseraient de toute façon. |
| **Le second `send-keys` de `pane.sendText` est un `\r` nu.** Si l'agent bascule en `awaiting` entre les deux appels (une frame IPC, environ 16 ms, en usage normal et sans aucun attaquant), ce `\r` valide l'option surlignée d'une question que Robin n'a jamais vue. | `hasParsedPromptPending()` est réévalué **avant chaque** des deux appels. Si le second échoue, le `\r` ne part pas, la réponse est `became_awaiting`, et le `prompt` est poussé au client. Le texte déjà envoyé reste dans le composer du pane, visible et non validé. |
| `pane.sendKeys(['digit2','enter'])` ou `term.input(['enter'])` choisissent une option en contournant entièrement le `promptHash`. | `emitKeys` refuse `enter` et les chiffres quand un prompt **parsé** est en attente, avec `FORBIDDEN_KEY`. Quand le prompt est `unparsable`, tout passe : c'est le repli de A6, il doit rester complet. |
| "Toute écriture passe par ce module" est une garantie facile à écrire et fausse dès qu'un chemin est ajouté. | `KeyGate` est le seul appelant de `ipc.sendKeys`, vérifié par une règle de lint et un test qui compte les appelants. Le tableau de 2.4 énumère les quatre opérations et leur garde. |
| Le rendu TUI change avec une version de Claude Code, et **aucun échantillon réel n'existe sur la machine** puisque Robin est en `bypassPermissions`. | `unparsable` est le comportement **attendu** par défaut, pas un cas d'erreur : aucun bouton, repli monospace, bannière `KL_OPEN` sans action d'approbation. La grammaire vit dans un fichier unique testé contre des fixtures. Les critères qui en dépendent sont marqués non exécutables (section 7). |
| Trois options codées en dur alors que le prompt en a quatre. | Numérotation consécutive à partir de 1, au moins deux options, sinon `unparsable`. Aucune constante nulle part. |
| Une catégorie de notification renommée dynamiquement pour afficher les vrais libellés. | Capacité non documentée par Apple : abandonnée. Catégories **statiques**, boutons portant les chiffres, et la NSE réécrit le **corps** avec la liste numérotée. Robin lit ce que fait chaque chiffre. |
| iOS n'affiche que 4 actions et le prompt en a 5. | Troncature explicite : options par index croissant puis `Interrompre`, qui n'est **jamais** retiré. Au-delà de 3 options, aucune action rapide, bascule sur `KL_OPEN` et ouverture de l'app. |
| Un champ `Répondre` dans la bannière permet de taper `1` depuis un iPhone verrouillé. | Aucune saisie de texte libre depuis une notification. Elle contournerait Face ID, le hash et la relecture, les trois à la fois. |
| `approve_always` déclenché depuis une bannière. | Tous les boutons de chiffre exigent Face ID, et le corps affiche le libellé de chaque option. Robin lit "2 Oui, ne plus redemander" avant d'appuyer sur `2`, et doit s'authentifier. |
| **L'interruption disparaît en dégraissant le protocole.** C'est arrivé une fois : `dispatch-action` retiré et `pane.sendKeys` repoussé en lot 2 ont laissé le geste que A7 veut rendre le plus facile sans message, sans route et sans action. | `pane.interrupt` est un message **dédié**, en L1, avec sa route miroir, son action de notification dans toutes les catégories, et son entrée dans le tableau de lignes du lot 1. Le promouvoir via `pane.sendKeys` aurait ramené `enter` et les chiffres au lot 1 : c'est pourquoi il est séparé. |
| Robin approuve depuis la liste sans avoir lu l'énoncé. | Aucun bouton d'approbation sur l'écran Sessions (A7). Seuls `Ouvrir` et `Interrompre` y figurent. |
| **Le produit vise un écran que la configuration de Robin ne produit jamais** : toutes ses sessions tournent en `bypassPermissions` ou `auto`. | Prémisse corrigée (0.1) : le lot 1 vise "l'agent a fini, je donne la suite", le déclencheur `awaiting` étant le même. La barre de validation reste comme filet. Badge `permissionMode` dans la liste pour que Robin comprenne pourquoi une session est silencieuse. |
### Sécurité

| Piège | Parade |
|---|---|
| Un jeton volé écrit dans `~/Library/LaunchAgents/` ou `~/.ssh/authorized_keys` : la fuite de données devient une prise de contrôle persistante. | Liste noire **en écriture** déclarative (4.4), la lecture restant totale conformément au choix de Robin. Refus en `403` avec audit, un test unitaire par entrée. |
| `TermInput { data: string }` contourne la liste blanche que le document prétend appliquer. | `TermInput` ne transporte plus de string : uniquement des `KeyName` d'une table fermée, exactement comme `pane.sendKeys`. Un seul point d'entrée, une seule règle. |
| Une séquence OSC 52 dans un texte écrit le presse-papier du Mac ; OSC 0 réécrit le titre. | `sanitizeFreeText` supprime toute la plage C0 (qui contient ESC) et toute la plage C1 avant d'ajouter le bracketed paste. Aucune séquence OSC, DCS ou APC ne peut survivre. La preuve tient en une ligne. |
| Un message multi-ligne envoyé dans un pane qui est un shell exécute chaque ligne. | Bracketed paste obligatoire sur tout texte utilisateur. |
| `dispatch-action: string` présenté comme une "liste blanche stricte" donne accès à `close-pane-or-tab` et `paste`. | La commande est **retirée du protocole**. Les commandes de pane sont une union littérale fermée de quatre variantes. `close-pane`, `close-tab`, `split` et `merge-*` ne sont exposés nulle part. |
| Le jeton dans `Sec-WebSocket-Protocol` est renvoyé tel quel dans la réponse de handshake et atterrit dans tous les journaux d'accès. | En-tête `Authorization` uniquement, liste de rédaction du logger, et un test qui `grep` le fichier de log après un cycle complet. |
| Un `secret.bin` en clair est lisible par les cinq sessions Claude Code qui tournent sous cet uid. | Secret maître dans le trousseau macOS via `security`, jamais sur disque. |
| Un jeton permanent ne s'invalide jamais. | Expiration 90 jours encodée dans le jeton, renouvellement silencieux à J-15, révocation immédiate depuis les Réglages, rotation globale par suppression de l'entrée du trousseau. |
| `realpath()` échoue sur un chemin qui n'existe pas encore, donc le contrôle est inopérant sur **toutes** les écritures. | `realpath(dirname())` puis `join(basename())`, avec refus des `basename` valant `.`, `..` ou contenant un séparateur. |
| TOCTOU entre `realpath()` et `open()` : un lien symbolique substitué. | `O_NOFOLLOW` sur le dernier segment, puis comparaison de `fstat().ino` avec le `stat` de contrôle. |
| `osascript` pour la corbeille, `sips` pour les miniatures : injection par concaténation de chemin. | Ces routes sont supprimées (C18). Partout ailleurs, `execFile` avec un tableau d'arguments, jamais `exec`. Quatre binaires appelés au total, tous avec des arguments constants ou numériques. |
| Le QR d'appairage reste dans `pty-capture-*.raw`, fichier en 0644 lisible par tout compte local. | TTL 3 minutes, charge utile réduite à `code` et `tsDns`, effacement de l'écran à la consommation, et `~/Library/Logs/Kova` ajouté à la liste noire de **lecture**. |
| Bannissement par IP inopérant sur Tailscale relayé, où plusieurs chemins présentent la même adresse. | Limitation et blocage par `deviceId`. L'IP reste en audit, elle n'est jamais une clé de décision. |
| Un jeton volé exfiltre le disque à pleine vitesse et l'audit ne fait que le raconter après coup. | `fsRead: 600/min` et `fsBytes: 4 Go/h` par appareil. `/health` limité à 60/min par IP et réduit à `{ok, protocol}` : ni version ni hostname avant authentification. |

### IPC Kova

| Piège | Parade |
|---|---|
| Le socket change de nom à chaque redémarrage de Kova (PID). | Découverte par glob re-exécutée à chaque tentative de reconnexion. Jamais de mémorisation du chemin, jamais de lecture de `KOVA_SOCKET`. |
| `/tmp` est accessible en écriture à tous : un socket piégé peut y être posé. | Vérification de `st.uid === getuid()` et du mode `0600` avant la sonde. |
| Un socket orphelin accepte parfois la connexion. | Sonde active `list-tabs` avant de passer en `READY`, candidats triés par mtime décroissant. |
| **Les PID sont recyclés.** `kill(488, 0)` réussit parce que 488 est `sociallayerd` : un `.raw` orphelin ne serait jamais purgé, et un faux socket pourrait être retenu. | `ps -p <pid> -o comm=` comparé au chemin de l'exécutable Kova, appliqué **à la fois** dans `discoverSocket()` et dans la purge des `.raw`. |
| `get-pane-content` sur un pane fermé renvoie **`ok:true`** avec `{"error":"not found"}` et sans `cols`, `rows`, `text`. Entre `pane-close` et un resync en vol, `term.resize(undefined)` casse xterm.js. | Union discriminée `PaneContent` imposée au niveau du client IPC, `isPaneError()` obligatoire avant toute lecture. Le parseur de prompt et le streamer ont la même garde. Cas ajouté à la matrice du lot 4. |
| Le protocole JSON-lines n'a **aucun identifiant de corrélation**. | Interdiction de pipeliner : une requête en vol sur la connexion de commandes, file FIFO, connexion séparée pour `subscribe`. |
| Un socket Unix à moitié mort ne remonte jamais d'erreur. | Watchdog de 45 s réarmé sur chaque ligne, `ping` compris. |
| `error` est une chaîne libre sans code machine, alors que le protocole client attend des codes. | Table de correspondance explicite en 2.2. |
| Aucune commande de version ou de capacités n'existe. | Sondage de chaque commande attendue une fois au démarrage, résultat exposé dans `hello.ok.kova.commands`. |
| `panes:"all"` coûte 20 Ko pour 4 panes et croît linéairement. | Interrogation par identifiant explicite uniquement, jamais `"all"`. |
| `mode:"scrollback"` renvoie 0 octet sur un pane Claude Code (écran alterné). | Interdit comme source d'historique (A15). Documenté ici pour que personne n'y perde une journée. |

### Transcripts et terminal

| Piège | Parade |
|---|---|
| Une réponse assistant est éclatée sur **1 à 5 lignes** de même `requestId`. Un code qui suppose "2 ou 3" se trompe sur 5 groupes sur 24. | Regroupement par `requestId`, **ordre par `apiBlockIndex`**. Aucune borne supposée, ni dans le code ni dans les tests. |
| `usage` est répété à l'identique sur chaque ligne du groupe. Une somme donnerait un compteur multiplié. | Prendre la dernière valeur, ne jamais additionner (A16). |
| Ligne de 132 746 octets écrite en plusieurs `write` : un parse au fil de l'eau tombe sur du JSON tronqué. | `carry` de ligne partielle, consommée seulement après son saut de ligne, plus un `StringDecoder` persistant (et non `buf.toString`, qui produit un `U+FFFD` sur une frontière de caractère). |
| Fichier réécrit **en place** puis regrossi : même inode, taille supérieure, les deux gardes classiques passent et le client reçoit des turns incohérents. `/clear` produit exactement ce motif. | Troisième signal : empreinte des 64 premiers octets revalidée à chaque changement. Toute divergence déclenche `reopen()` plus un `session.snapshot` complet. |
| `openTail` élargit sa fenêtre jusqu'à lire le fichier entier sur une session à turns longs. | Plafond dur à 2 Mo, on sert moins de turns et on pagine. |
| Une reconnexion sur un turn encore **mutable** laisse une réponse tronquée pour toujours (un `thinking` seul). | `session.attach` porte `lastTurnId` et `lastTurnBlockCount` ; le serveur renvoie ce turn dans `replaceIds` si son nombre de blocs a changé. Le client persiste l'`id` du dernier turn, pas seulement son `seq`. |
| `queue-operation` rendu en bulle utilisateur, sur l'hypothèse qu'il porte des messages de Robin. | **Faux** : 20 occurrences mesurées, 11 blocs XML `<task-notification>` et 9 `content: null`, zéro message de Robin. Le rendre injecterait du XML de service dans le fil. Ignoré comme les autres métadonnées (C22). |
| Les gros résultats d'outils vivent dans `tool-results/<id>.txt`, et **rien dans le JSONL ne les référence** (V12). Le marqueur `Full output saved to:` supposé en passe 2 n'existe pas dans les données : cinq occurrences trouvées, toutes des citations de la revue elle même. | Aucune route ne promet ce contenu. Le bloc porte `retrievable: false` et l'app affiche "non récupérable, voir sur le Mac". Une demi-heure d'investigation sur la vraie clé de jointure est portée au lot 2. Spécifier une route sur un mécanisme supposé aurait produit un bouton mort. |
| 12 types de lignes réels, une énumération qui se prétend exhaustive vieillit mal. | Tout type inconnu est ignoré silencieusement, jamais une erreur. Le tableau porte la mention explicite qu'il n'est pas exhaustif. |
| Le `.raw` grossit de **145,2 Ko/min** : 4,3 Mo après 30 minutes de déconnexion. Le rejouer est absurde. | Resynchronisation, budget de rejeu de 256 Ko maximum, et **zéro rejeu** si le fichier a grossi davantage. |
| Après un resync, l'écran est en texte brut sans couleur. Sur un pane **au repos**, aucun redessin n'arrive et il le reste indéfiniment. | Indicateur "rendu simplifié" affiché tant qu'aucun octet brut n'est arrivé depuis le resync. |
| FSEvents sur `~/Library/Logs/Kova/` : 58 fichiers `.raw`, le watcher se réveille en permanence et sa latence n'est pas bornée sous les 250 ms d'écho clavier. | Boucle `fstat` à 20 ms sur les **descripteurs attachés uniquement** : déterministe, bornée, gratuite quand rien ne bouge. `chokidar` reste pour le JSONL, où 80 ms sont sans conséquence. |
| Un client sur 4G lente prend du retard, `bufferedAmount` gonfle. | Au-delà de 2 Mo : arrêt de lecture, saut en fin de fichier, `term.gap` puis `term.resync`. |
| Le pane fait **221 colonnes**, illisible sur 6 pouces. | Rendu à la largeur réelle avec défilement horizontal, plus l'action explicite `Adapter à mon écran` avec `Rétablir` (PRD B5). On ne casse jamais l'affichage du Mac sans demande explicite. |
| `Ctrl+C` supprimé alors que le PRD B4 le classe P0. | Rétabli dans `KEY_TABLE`, avec la confirmation par glissement prévue. Un P0 ne se supprime pas dans un document d'architecture. |

### Plateforme

| Piège | Parade |
|---|---|
| **Tailscale n'est pas installé** sur la machine et tout le produit en dépend. | Prérequis explicite du lot 1. Au démarrage, si aucune adresse Tailscale n'est trouvée, avertissement clair et le daemon ne sert qu'en loopback. |
| Le daemon démarre au login avant Tailscale, l'écouteur n'est jamais ouvert. | Re-scan des interfaces toutes les 30 s, ouverture et fermeture dynamiques des écouteurs. |
| Sur un réseau mobile IPv6 seul, Tailscale préfère souvent IPv6, ignoré par un filtre IPv4. | Écoute sur l'adresse Tailscale IPv4 **et** IPv6, toujours par adresse explicite, jamais `::`. |
| iOS n'accorde que quelques secondes à une action de notification en arrière-plan ; ouvrir un WebSocket consommerait la moitié du budget. | Route HTTP dédiée `POST /v1/panes/:id/answer`, timeout 3,5 s, persistance dans l'outbox **avant** toute I/O réseau. |
| Le jeton Expo change (réinstallation, restauration) et le daemon pousse dans le vide. | Renvoi à chaque `hello` s'il diffère, plus relecture des receipts à 15 minutes et suppression sur `DeviceNotRegistered`. |
| L'`ai-title` est généré par un modèle à partir du contenu : le mettre dans une bannière viole A14. | Le titre de la notification est `pane.title` plus le nom du projet. Écrit explicitement pour que personne n'"améliore" la bannière au lot 2. |
| Le Mac s'endort pendant qu'un agent travaille. | Assertion `PreventUserIdleSystemSleep` (`caffeinate -i`) armée sur `working: true` d'au moins un pane, indépendamment de tout client, plafond 4 h, interrupteur exposé. On ne contre pas la fermeture du capot, qui est un comportement attendu. |
| Les sockets ne survivent pas à une veille et l'app semble cassée au réveil. | Détection par saut d'horloge (écart supérieur à 5 s), invalidation, resync complet, bandeau explicite côté app. |
| **Xcode absent** : aucun build local possible. | Builds EAS cloud dès le lot 1, client de développement installé une fois, itération JavaScript en rechargement à chaud. |
| Une OTA met à jour l'app sans le daemon, le protocole diverge. | `runtimeVersion` en `fingerprint`, `hello.ok` porte `protocol` et `daemonVersion`, l'app affiche la commande exacte de mise à jour. |
| La NSE est limitée à environ 30 s et n'a pas accès au trousseau de l'app par défaut. | Budget de 6 s sur la récupération, entitlement `keychain-access-groups` partagé, et repli silencieux vers la bannière opaque sans action rapide. |
| Une Share Extension est limitée à 120 Mo et iOS purge le conteneur de l'App Group. | `expo-share-intent` : l'extension dépose le fichier et ouvre l'app, toute la logique reste dans le processus principal. Le fichier est copié hors du conteneur avant l'upload. |
| Accorder l'accès complet au disque à `/usr/local/bin/node` l'accorde à tout script Node. | Dette explicite du lot 4 : empaqueter le daemon en `KovaLinkd.app` signé pour une identité TCC dédiée. Non bloquant au départ. |
