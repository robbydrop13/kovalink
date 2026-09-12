# KovaLink, PRD v1 (passe 3)

| | |
|---|---|
| Statut | Corrigé après passe 2 du panel. Conforme à `05-arbitrages.md` (A1 à A16), `07-corrections.md` (C1 à C19) et `08-corrections-passe2.md` (C20 à C37) |
| Auteur | Senior PM, équipe KovaLink |
| Sources de vérité | `00-context.md` pour les faits techniques, `05-arbitrages.md` et `08-corrections-passe2.md` pour les décisions |
| Cible | iPhone de Robin, iOS 17+, TestFlight interne, bundle `io.claap.kovalink` |
| Dépend de | Kova 1.11.0, Claude Code, Tailscale, daemon KovaLink sur le Mac |

**Le produit en une phrase :** une notification me dit que l'agent a fini et attend, je lis son dernier message sur mon téléphone, je lui donne la suite. Sans ouvrir mon Mac.

### Le changement de prémisse (C36, validé par Robin)

Le relecteur technique a mesuré que **toutes les sessions de Robin tournent en `bypassPermissions` ou `auto`** (5 projets vérifiés, la barre d'état du pane cible affiche `⏵⏵ bypass permissions on`). En bypass, Claude Code ne demande jamais de permission. Le scénario dominant de la passe 2, "j'approuve une validation", est donc rare en pratique.

**Le moment dominant réel est : l'agent a fini son tour, il attend l'instruction suivante.**

Ce basculement coûte peu, et c'est le point à retenir :

| Élément | Cas "l'agent a fini" | Cas "l'agent demande une permission" |
|---|---|---|
| Événement IPC déclencheur | `pane-status.awaiting` passe à `true` | `pane-status.awaiting` passe à `true` |
| Chaîne daemon, push, NSE, bannière | Identique | Identique |
| Ce que la NSE récupère sur le canal direct | Fin de tour : dernier message de l'assistant | Prompt : question, détail, options |
| Rendu à l'ouverture | Dernier échange plus composer | Dernier échange plus barre de validation |

**Seul le rendu diffère.** La barre de validation reste dans le lot 1, mais elle n'en est plus la justification : elle sert quand un prompt survient malgré le bypass (mode plan, question explicite de l'agent, projet basculé en mode par défaut).

### Ce qui change par rapport à la passe 2

| Réf | Changement |
|---|---|
| C36 | Hiérarchie des scénarios réécrite. Le rendu du dernier échange depuis le JSONL **remonte du lot 2 au lot 1** et devient le chemin critique. |
| C37 | Les critères qui dépendent d'un prompt réel sont marqués **NON EXÉCUTABLE EN L'ÉTAT**, avec la procédure pour les rendre exécutables. Aucun n'est déclaré satisfait. |
| C20 | Le `prompt_hash` couvre désormais **le bloc de détail** (commande, chemin, diff), pas seulement la question et les libellés. Deux `Bash` consécutifs produisaient le même hash. Second garde-fou : report de `awaiting_since`. |
| C21, C32 | L'interruption est rétablie comme opération de premier ordre du lot 1 : message dédié, depuis la liste (pane qui travaille **et** pane en attente), depuis la session, depuis la notification. |
| C23 | Aucun retour chariot ne part sans vérification d'état. L'envoi de texte libre est **refusé** quand un prompt parsé est ouvert. |
| C24, C25, C27 | Route de récupération opaque à usage unique, catégories de notification **pré-enregistrées statiquement**, boutons portant les chiffres, corps réécrit par la NSE, repli nommé `KL_AWAITING_BLIND`. |
| C26 | Toute saisie de texte depuis une notification est **supprimée** : elle permettait d'envoyer `1` puis Entrée à un prompt, sans Face ID, sans hash, sans relecture. |
| C28 | Le réglage `Extraits dans les notifications` est supprimé. Réglages : 5 vers **4**. |
| C22 | `queue-operation` ignoré et jamais rendu (mesure : 20 entrées, 11 blobs XML, 9 `null`, 0 message de Robin). |
| C33 | Estimations honnêtes : lot 1 environ **3 200 lignes** après absorption du rendu du dernier échange, total environ 7 000. |

---

## 1. Problème et utilisateur

### 1.1 Utilisateur

Un seul : Robin Bonduelle, CEO de Claap. Pas de persona secondaire, pas de compte, pas de partage.

Observé sur sa machine :

| Fait mesuré | Valeur | Conséquence produit |
|---|---|---|
| Mode de permission de toutes ses sessions | `bypassPermissions` ou `auto` sur les 5 projets vérifiés | Les prompts sont rares. Le produit se conçoit autour de la fin de tour, pas de l'approbation. |
| Panes ouverts en parallèle | 5 onglets, 1 pane chacun, tous avec un `agent_session` Claude | La liste tient dans un écran, pas de recherche en v1 |
| Projets récents | 17 | Liste de suggestions, pas une grille |
| Sessions Claude indexées dans `claude_history.json` | 62 | Base de la reprise de session fermée |
| Transcript de la session en cours | 122 lignes, 548 Ko, mis à jour en continu | Rendu du dernier échange sans indexation lourde |
| Blocs par `requestId` | de 1 à 5, `apiBlockIndex` consécutif depuis 0 | Regroupement obligatoire, tri par `apiBlockIndex` et non par horodatage |
| Croissance d'une capture PTY active | 145,2 Ko/min | Le rejeu du terminal doit être borné |
| Instances Kova mortes ayant laissé des captures | 4 PID sur 5, 1,1 Go de logs | Purge nécessaire, et `kill(pid,0)` est un test faux (le PID 488 est aujourd'hui `sociallayerd`) |

### 1.2 Les 5 moments où il a besoin de KovaLink

| # | Moment | Ce qui se passe aujourd'hui | Coût réel | Ce que KovaLink change |
|---|---|---|---|---|
| M1 | Il quitte le bureau, un agent tourne | L'agent finit 10 min plus tard et attend l'instruction suivante. Personne ne la donne. | 30 min à 3 h de temps mort par occurrence, plusieurs fois par jour | Push dès la fin du tour, lecture du dernier message, instruction suivante envoyée en 30 s |
| M2 | Il est dans les transports | Une main, réseau instable ou nul | Sessions perdues, contexte refroidi | Lecture du dernier état hors ligne, envoi dès que le réseau revient |
| M3 | Un agent part de travers | Il ne peut rien faire avant de rentrer | Tokens brûlés, code à jeter | Interruption en 5 s, depuis la liste, sans authentification |
| M4 | Il veut relancer une session | Ouvrir Kova, retrouver le projet, retaper `claude --resume <uuid>` | 2 à 5 min de friction | 2 taps depuis un projet récent ou une session fermée |
| M5 | Il veut envoyer une photo ou un PDF dans un dossier projet | AirDrop vers le bureau puis déplacement manuel | 5 taps plus un `mv` | Partager depuis n'importe quelle app iOS, choisir le dossier |

Le cas "valider une action risquée" existe toujours, mais il est devenu **secondaire** : il ne se produit qu'en mode plan, sur une question explicite de l'agent, ou sur un projet volontairement laissé en mode de permission par défaut.

### 1.3 Objectif mesurable de la v1

| Indicateur | Cible à 1 mois d'usage |
|---|---|
| Délai médian entre le front montant de `awaiting` et la réponse de Robin, quand il est loin du Mac | < 5 min (aujourd'hui : souvent > 30 min) |
| Instructions envoyées depuis le téléphone par semaine | > 10 |
| Part des ouvertures qui aboutissent à un message envoyé | > 50 % |
| Part des bannières dont le contenu a bien été récupéré par la NSE | > 95 % |
| Taux d'échec de la NSE (`nse_failed`), vu de l'autre côté | < 5 % |
| Sessions relancées depuis le téléphone par semaine | > 2 |
| Interruptions déclenchées depuis le téléphone par semaine | > 1 |

### 1.4 Non-objectifs de conception

- Ce n'est pas un IDE mobile. On ne code pas depuis l'iPhone.
- Ce n'est pas un Kova complet. Ni grille de panes, ni splits, ni multi-fenêtres.
- Ce n'est pas un outil d'équipe.

---

## 2. Scénarios d'usage, classés par fréquence réelle

Fréquences estimées après le changement de prémisse, à instrumenter et corriger après 2 semaines d'usage.

| Rang | Scénario | Part des ouvertures | Durée cible | Bloc | Lot |
|---|---|---|---|---|---|
| S1 | L'agent a fini, je lui donne la suite | ~45 % | 30 s | A | 1 |
| S2 | Je vérifie où en est un agent qui travaille | ~25 % | 20 s | A | 1 |
| S3 | J'interromps un agent parti de travers | ~10 % | 5 s | A | 1 |
| S4 | Je débloque un prompt de validation | ~8 % | 15 s | A | 1 |
| S5 | Je lance une nouvelle session sur un projet récent | ~5 % | 20 s | A | 2 |
| S6 | Je reprends une session fermée | ~3 % | 30 s | A | 2 |
| S7 | J'envoie une photo ou un PDF vers un dossier projet | ~3 % | 15 s | C | 3 |
| S8 | Je récupère un fichier du Mac | ~1 % | 30 s | C | 3 |
| S9 | Je bascule sur le terminal complet | < 1 % | variable | B | 2 |

### S1. L'agent a fini, je lui donne la suite (le scénario qui définit le produit et le lot 1)

1. Sur le Mac, Claude termine son tour et attend. Kova émet `pane-status` avec `awaiting: true`, `awaiting_since: <ts>`.
2. Le daemon, abonné en permanence, détecte le **front montant** (`false` vers `true`). Il lit le pane avec `get-pane-content` en `mode: "visible"` et tente le parsing d'un bloc d'options. Aucun bloc trouvé, ce qui est le cas normal en bypass : il qualifie l'événement en **fin de tour** et prépare un résumé depuis le JSONL (dernier bloc `text` de l'assistant, nombre d'outils appelés, durée du tour). Il range le tout sous une référence opaque `prompt_ref`, à usage unique.
3. Le daemon émet un APNs en moins de 500 ms. **La charge utile ne contient aucun texte** : `project`, `pane_id`, `event`, `prompt_ref`, `mutable-content: 1`.
4. La Notification Service Extension intercepte la notification, appelle `GET /v1/prompt/{prompt_ref}` sur le canal chiffré direct, reçoit `kind: "turn_end"`, réécrit le corps, et sélectionne la catégorie `KL_TURN_END`.
5. Bannière : titre `Link attend ta réponse`, corps `J'ai corrigé les 3 tests qui échouaient et relancé la suite. Tout passe.`, sous-titre `4 min 12 s, 11 outils`.
6. Robin tape la bannière. L'app s'ouvre sur la session, positionnée sur le **dernier échange** : son dernier message, la réponse de l'assistant regroupée par `requestId`, les appels d'outils repliés.
7. Il lit, puis dicte l'instruction suivante dans le composer (touche micro du clavier iOS).
8. Le daemon assainit le texte, l'envoie en bracketed paste, puis envoie l'Entrée dans un second appel, **après avoir vérifié que le pane n'est pas en attente avec un prompt parsé** (C23).
9. Le message repasse en noir dès qu'il apparaît dans le JSONL. L'agent repart. Total : 30 s.

### S2. Je vérifie où en est un agent qui travaille

1. Robin ouvre l'app. La liste s'affiche depuis le cache local en moins de 200 ms, puis se rafraîchit.
2. Tri : `awaiting` en haut, puis `working`, puis `idle`. Chaque ligne : titre de l'onglet, projet, pastille d'état, âge du dernier événement, et un badge `bypass` sur les sessions qui ne demanderont jamais de validation.
3. Il ouvre une session `working`. Le dernier échange s'affiche, avec l'appel d'outil en cours en tête.
4. Il ferme. Aucune action envoyée.

### S3. J'interromps un agent parti de travers

1. Depuis la **liste**, sur une ligne `TRAVAILLE` comme sur une ligne `EN ATTENTE`, ou depuis la session ouverte, ou depuis la bannière de notification.
2. Un seul tap sur `Interrompre`. **Aucun Face ID, aucune confirmation** (A2, A7) : c'est le geste sûr, son pire cas est un agent bloqué.
3. Message dédié `pane.interrupt {pane_id}`, qui passe par le point d'entrée unique de filtrage, et émet le caractère d'échappement `0x1b` par le type énuméré de touches.
4. `working: false` en moins de 2 s.

### S4. Je débloque un prompt de validation (secondaire depuis le bypass, mais le chemin le plus dangereux)

1. Un prompt survient : mode plan, question explicite de l'agent, ou projet en mode de permission par défaut. `pane-status.awaiting` passe à `true`, exactement comme en S1.
2. Le daemon parse le bloc d'options. Il calcule `prompt_hash` sur la **charge décisionnelle complète** : question, lignes de détail, options dans l'ordre.
3. La NSE reçoit `kind: "prompt"` et réécrit le corps : la question tronquée à 120 caractères, puis le détail, puis la liste numérotée des options. Elle sélectionne la catégorie pré-enregistrée correspondant au nombre d'options.
4. Les boutons de la bannière **portent les chiffres** (`1`, `2`, `3`), plus `Interrompre`. Les libellés d'action sont figés à l'enregistrement de la catégorie par l'app : c'est le corps de la bannière, réécrit par la NSE, qui dit ce que fait chaque chiffre.
5. Robin lit, tape `1`. Face ID est demandé : l'approbation engage le disque entier (A2).
6. L'app envoie `{action:"answer", pane_id, option_index, prompt_hash, awaiting_since, nonce}`. Jamais d'intention `approve`, jamais un libellé.
7. Le daemon relit le pane, recalcule le hash **et** compare `awaiting_since`. Divergence : `stale_prompt`, rien n'est envoyé.
8. Sinon : **un seul** `send-keys` atomique, `"1\r"`. La position du curseur sur le Mac n'entre jamais dans la décision.

**Chemins d'échec, spécifiés parce qu'ils arriveront :**

| Échec | Comportement |
|---|---|
| La NSE échoue ou dépasse 4 s | Catégorie `KL_AWAITING_BLIND` : bannière `Validation requise`, **aucune action d'option**, seulement `Interrompre` et `Ouvrir`, ouverture forcée de l'app |
| Le parsing des options échoue | Aucun bouton d'option nulle part. Dans l'app : seul bouton plein `Ouvrir le terminal`. C'est le comportement **attendu** en l'absence d'échantillon réel de prompt (C37), pas un cas d'erreur |
| Plus de 3 options | Aucune action rapide d'option, `Interrompre` et `Ouvrir` seuls, le corps affiche quand même la question et la liste complète |
| Le hash ou `awaiting_since` a changé | Rien n'est envoyé. `La question a changé sur le Mac`, la nouvelle question remplace l'ancienne, la barre se ré-arme |
| Le pane a été fermé | `get-pane-content` renvoie `ok: true` avec `{"error":"not found","id":N}`. `Cette session n'existe plus`, rien n'est envoyé |
| Robin est hors ligne au tap | La réponse n'est mise en file que 60 s, puis abandonnée avec un message explicite |

### S5. Je lance une nouvelle session sur un projet récent (lot 2)

1. Onglet `Sessions`, bouton `+`, puis `Nouvelle session`. Pas de split, exclu en section 6.
2. Liste des 17 projets de `recent_projects.json`, triés par `last_opened`, chemin abrégé.
3. `{"cmd":"new-tab","cwd":"<path>","command":"claude"}` renvoie `{tab_id, pane_id}`.
4. Écran `Démarrage de Claude, {n} s`, poll `list-panes` toutes les 500 ms.
5. Ouverture dès l'apparition de l'`agent_session_id`. Au delà de 20 s, repli monospace avec bandeau, jamais un écran figé.

### S6. Je reprends une session fermée (lot 2, spécifiée en 3.4)

### S7. J'envoie une photo ou un PDF vers un dossier projet (lot 3)

1. `Partager` puis `KovaLink` depuis n'importe quelle app.
2. Destinations : les 3 dernières utilisées, puis les projets récents de Kova, puis `Parcourir tout le Mac`.
3. Au delà de 100 Mo en données cellulaires : choix explicite `Envoyer maintenant` ou `Attendre le Wi-Fi` (A4). Aucun plafond de taille.
4. Transfert en flux, découpé, reprise après coupure, poursuivi en tâche de fond.
5. Collision : suffixe `nom-2.ext`, jamais d'écrasement, jamais de bouton `Remplacer`.
6. Destination sur la liste noire d'écriture : refus avant transfert, motif et chemin affichés.

### S8. Je récupère un fichier du Mac (lot 3)

Navigation depuis `~` ou depuis un projet récent, aperçu au tap, `Enregistrer` ouvre la feuille de partage iOS. Sélection multiple jusqu'à 20 fichiers.

### S9. Je bascule sur le terminal complet (lot 2)

Onglet `Terminal` à côté de la session. Rendu xterm.js alimenté par le `.raw`, par resynchronisation. Sert quand l'agent n'est pas Claude, quand le parsing a échoué, ou quand une TUI tierce occupe le pane.

---

## 3. Périmètre fonctionnel

### 3.0 Lots et prérequis (C36, C33)

**Rien n'est supprimé du projet.** Robin a demandé les trois blocs, ils sont ordonnés.

| Lot | Contenu | Volume estimé | Critère de sortie |
|---|---|---|---|
| **Lot 1, la boucle de travail** | Appairage (QR, Tailscale, `tailscale cert`). Liste des sessions avec état live et badge de mode de permission. Notification sur front montant de `awaiting`. Ouverture d'une session avec **rendu du dernier échange** depuis le JSONL. Composer d'envoi de message. Interruption depuis la liste, la session et la notification. Barre de validation défensive. Repli monospace. `Ouvrir sur le Mac`. | ~3 200 lignes (2 600 établies avant l'absorption du rendu du dernier échange, plus environ 600 pour ce rendu) | Robin lit le dernier message d'un agent et lui envoie la suite depuis son téléphone, sans ouvrir son Mac. |
| **Lot 2, l'historique et le terminal** | Transcript complet et paginé, sous-agents, terminal xterm.js, nouvelle session, reprise de session fermée, notifications N3 et N4. | ~2 400 lignes | Robin suit et pilote une session entière depuis le téléphone. |
| **Lot 3, les fichiers** | Bloc C entier : navigation, aperçu, téléchargement, upload, Share Extension, journal d'audit. | ~1 400 lignes | Robin envoie une photo dans un dossier projet en 15 s. |

Total estimé : environ **7 000 lignes**. Ces chiffres remplacent les estimations de la passe 2, qui étaient flatteuses.

**Prérequis de recette du lot 1 (C37), à faire avant de déclarer quoi que ce soit satisfait :**

| # | Prérequis | Pourquoi |
|---|---|---|
| 1 | Au moins un projet basculé en **mode de permission par défaut** | Aucune session de Robin ne produit de prompt aujourd'hui. Sans ce basculement, les critères qui portent sur le parsing sont inexécutables. |
| 2 | Un **échantillon réel de rendu de prompt** capturé et versionné comme fixture du parseur | Le parseur lit un rendu TUI. C'est le module le plus fragile du produit, et il n'a aucun échantillon aujourd'hui : la recherche de `Do you want` et de `No, and tell Claude` dans les 58 fichiers `.raw` renvoie zéro rendu réel. |
| 3 | Une seconde fixture avec **deux prompts `Bash` consécutifs de commandes différentes** | C'est le scénario du défaut C20. Sans elle, on ne peut pas prouver que le hash les distingue. |

Tant que ces trois prérequis ne sont pas remplis, le parseur est écrit **défensif par défaut** (A6) : l'état `unparsable` est le comportement attendu, pas un cas d'erreur.

### 3.1 Bloc A, Sessions

| ID | Fonction | Comportement attendu | Source technique | Lot |
|---|---|---|---|---|
| A1 | Liste des sessions | Groupées par onglet Kova, une ligne par pane. Titre d'onglet, titre de session (`ai-title`, sinon `pane.title`), projet, état, âge. Tri : `awaiting`, `working`, `idle`. Chaque ligne porte `Ouvrir` et `Interrompre`. **Aucun bouton d'approbation dans la liste** (A7). Aucun `Muter` (C31). | `list-tabs`, `list-panes`, `subscribe` | 1 |
| A2 | État live et mode de permission | 3 états exclusifs, `awaiting` l'emporte sur `working`. Poussé par événement, jamais par polling côté iPhone. Une session en `bypassPermissions` ou `auto` porte un badge `bypass` et l'explication `aucune validation ne te sera demandée`, sans quoi Robin ne comprendrait pas pourquoi ces sessions sont silencieuses. | `pane-status`, `pane-working`, `pane-open`, `pane-close`, `permissionMode` du JSONL | 1 |
| A3 | Ouverture d'une session, dernier échange | Chemin critique du lot 1. Affiche le dernier message utilisateur et la dernière réponse de l'assistant regroupée par `requestId`, appels d'outils repliés. Si `agent != "claude"` ou transcript absent : bandeau `Vue chat indisponible pour cet agent` et bouton vers le repli monospace (A5), jamais un écran vide. | `.jsonl`, voir 3.3 | 1 |
| A4 | Transcript complet | Pagination inverse, historique, sous-agents, diffs. | `.jsonl` | 2 |
| A5 | Composer | Texte libre multi-ligne, assaini, bracketed paste, Entrée dans un second appel gardé par une vérification d'état (C23). Confirmation par apparition dans le `.jsonl`. | `send-keys` | 1 |
| A6 | Barre de validation | Voir 3.2. Conservée, mais elle n'est plus la justification du lot 1. | `pane-status`, `get-pane-content`, `send-keys` | 1 |
| A7 | Interruption | Opération de premier ordre. Message dédié `pane.interrupt {pane_id}`. Disponible depuis la liste (pane `working` **et** pane `awaiting`), depuis la session, depuis la notification, y compris `KL_AWAITING_BLIND`. Aucune authentification, aucune confirmation. Passe par le point d'entrée unique de filtrage. | `send-keys` (`0x1b`) | 1 |
| A8 | Ouvrir sur le Mac | Met le pane au premier plan côté Mac. Utilise `focus-pane`, jamais `dispatch-action` (C7 : aucune action dispatchée en v1). | `focus-pane` | 1 |
| A9 | Nouvelle session sur projet récent | État `Démarrage` visible, repli à 20 s. | `recent_projects.json`, `new-tab` | 2 |
| A10 | Reprise d'une session fermée | Voir 3.4. | `claude_history.json`, `new-tab` | 2 |

### 3.2 Prompt de permission, contrat normatif (A6, C1, C20, C23)

Fait établi : le prompt de permission de Claude Code n'apparaît **pas** dans le transcript JSONL. La source de vérité de l'état interactif est le contenu visible du pane. Le rendu se construit sur deux sources jointes : le JSONL pour la conversation, `get-pane-content` pour la question en cours.

**Détection et parsing**

| Règle | Détail |
|---|---|
| Déclenchement | Le **front montant** de `pane-status.awaiting`. Jamais de boucle de sondage permanente (A6.4). |
| Lecture | `mode: "visible"`. `mode: "scrollback"` est **interdit** : il renvoie zéro octet sur un pane Claude Code, qui occupe l'écran alterné (A15). |
| Options | Lignes des 30 dernières non vides qui matchent `^\s*[>❯]?\s*(\d+)\.\s+(.+?)\s*$`, numérotées consécutivement à partir de 1. Nombre **variable**, jamais 3 en dur. |
| Question | Première ligne non vide au dessus de l'option 1. |
| Détail | Jusqu'à 5 lignes au dessus de la question (commande, chemin de fichier, résumé de diff). |
| Absence d'échantillon réel | Le parseur n'a **aucune fixture** aujourd'hui (C37). Il est écrit défensif : au moindre doute, il déclare `unparsable`. |
| Échec de parsing | État de premier ordre : **aucun bouton d'option nulle part**, bandeau `Question détectée, options illisibles`, seul bouton plein `Ouvrir le terminal`. On ne devine jamais un bouton. |
| Position des boutons | Dérivée de l'`index`, jamais d'une heuristique sur le libellé. La teinte peut suivre une heuristique, la position jamais. |

**Le `prompt_hash`, canon exact (C20)**

Règle qui gouverne tout le reste : **tout ce qui est affiché à Robin pour qu'il décide entre dans le hash, et rien de ce qui n'y est pas ne doit lui être affiché.**

| Entre dans le hash | Pourquoi |
|---|---|
| Un préfixe de version (`v1`) | Permet de faire évoluer le canon sans collision silencieuse |
| La question, normalisée NFC et espaces compressés | C'est l'énoncé |
| **Les lignes de détail, dans l'ordre** | C'est ce qui identifie l'action : la commande shell, le nom du fichier, le résumé du diff. Deux demandes `Bash` consécutives partagent la même question et les mêmes libellés : sans le détail, elles produisent le même hash, et l'approbation destinée à la première s'applique à la seconde. C'était le défaut le plus grave de la passe 2. |
| Les options, `index` et libellé, dans l'ordre | Ce sont les choix offerts |

| Exclu du hash | Pourquoi |
|---|---|
| Le marqueur de surlignage (`>`, `❯`) | Il suit le curseur du Mac, qui n'entre jamais dans la décision. L'inclure ferait échouer une réponse légitime dès que Robin bouge sa souris. |
| Les séquences ANSI de couleur | Purement décoratives, elles ne portent aucune information de décision. |
| La position du curseur, les dimensions du pane | Idem, et elles changent au moindre redimensionnement. |
| Les horodatages et les compteurs de jetons de la barre d'état | Ils changent en permanence, ils invalideraient le hash à chaque seconde. |

**Second garde-fou :** la requête reporte `awaiting_since`, comparé à `pane.awaiting_since` avant émission. Il discrimine deux prompts successifs même à texte strictement identique, dès lors que `awaiting` est retombé entre les deux.

**Requête de réponse, schéma imposé**

```
{ "action": "answer",
  "pane_id": 66,
  "option_index": 1,          // le rang affiché, jamais un libellé, jamais "approve"
  "prompt_hash": "<sha256 du canon ci dessus>",
  "awaiting_since": "<ts repris du pane>",
  "nonce": "<uuid, idempotence>" }
```

**Règles d'émission, non négociables**

1. Le daemon relit le pane, recalcule `prompt_hash` **et** compare `awaiting_since` juste avant d'émettre. Divergence : `stale_prompt`, aucune touche envoyée.
2. Il émet le chiffre **et** l'Entrée dans **un seul `send-keys` atomique** (`"1\r"`). Aucun envoi différé.
3. **Jamais un retour chariot seul.** Un `\r` seul valide la ligne surlignée sur le Mac, pas l'option lue sur le téléphone.
4. `awaiting === true` n'est pas une garde suffisante : il reste vrai quand Claude enchaîne sur une autre question.
5. **Aucun retour chariot ne part sans vérification d'état** (C23). Il n'existe que deux chemins d'écriture, et le point d'entrée de filtrage porte la règle :

| Chemin | Garde |
|---|---|
| Réponse à un prompt | `prompt_hash` et `awaiting_since` revérifiés |
| Envoi de texte libre | Le pane ne doit pas être en `awaiting` avec un prompt parsé. Sinon l'envoi est **refusé** avec un message explicite, et Robin est renvoyé vers la barre de validation. Face ID ne serait pas un substitut : la question est de savoir ce que le `\r` va valider, pas qui appuie. |

6. Toute entrée terminale passe par ce point unique : caractères de contrôle supprimés hors `\n` et `\t`, touches spéciales par type énuméré fermé, séquences OSC interdites (en particulier OSC 52), bracketed paste sur tout texte utilisateur (C6).

### 3.3 Rendu du transcript (lot 1 pour le dernier échange, lot 2 pour le reste)

| Type d'entrée | Rendu |
|---|---|
| `user` avec `message.content` texte | Bulle utilisateur |
| `user` portant un bloc `tool_result` | Rattaché au `tool_use` via `tool_use_id`, plié, liseré rouge si `is_error: true` |
| `assistant`, bloc `text` | Bulle assistant, markdown rendu |
| `assistant`, bloc `thinking` | Ligne pliée `Réflexion` |
| `assistant`, bloc `tool_use` | Puce `<outil> : <résumé d'une ligne>`, dépliable |
| `attachment` | Masqué (31 entrées sur 122 dans la session observée) |
| `ai-title` | Titre de session, jamais affiché dans le fil |
| `queue-operation` | **Ignoré, jamais rendu** (C22). Mesure sur la session de référence : 20 entrées, 11 blocs XML `<task-notification>`, 9 avec `content: null`, **zéro message de Robin**. Les rendre injecterait du XML de service dans le fil. |
| `last-prompt`, `mode`, `permission-mode`, `atis-latch`, `bridge-session`, `file-history-snapshot`, `system` | Ignorés. `permission-mode` est lu, mais pour alimenter le badge de A2, pas pour être affiché dans le fil. |
| Type inconnu | **Ignoré silencieusement**, jamais une erreur bloquante. |

Règles de reconstruction :
- Regroupement obligatoire par `requestId`. Distribution réelle mesurée : **de 1 à 5 blocs**, `apiBlockIndex` consécutif depuis 0. Aucune hypothèse sur le nombre.
- Tri par **`apiBlockIndex`**, pas par `timestamp` : plusieurs lignes sont écrites dans la même milliseconde, un tri par horodatage n'est pas déterministe.
- Le champ `usage` est répété à l'identique sur chaque ligne d'un même `requestId` : il ne doit **jamais** être sommé.
- Sous-agents (`<sessionId>/subagents/agent-*.jsonl`) joints par `toolUseId`, rendus en bloc pliable dans la bulle de l'outil parent. Lot 2.
- Lot 1 : dernier échange seulement. Lot 2 : pagination inverse par blocs de 100.
- **Aucune écriture dans le `.jsonl`, jamais.**
- Résultat d'outil externalisé : le fil affiche ce que contient le JSONL, tronqué le cas échéant. Il n'existe **aucun mécanisme de liaison** vers les fichiers de `tool-results/` (C34) : vérifié, le JSONL ne les référence ni par nom, ni par marqueur, ni par champ.

### 3.4 Reprise de session fermée, spécification complète (lot 2, A10)

**Entrée dans la fonction**

| Élément | Spécification |
|---|---|
| Emplacement | Quatrième section de l'écran Sessions, `FERMÉES · 62`, **repliée par défaut** |
| Source | `claude_history.json`, clé = chemin du `.jsonl`. Champs : `id`, `title`, `last_active`, `cwd` déduit du chemin |
| Ligne | Titre (ou `Sans titre`), projet, date relative |
| Tri | `last_active` décroissant. Pas de recherche en v1 |
| Exclusion | Une session dont l'`id` correspond à un pane vivant n'apparaît pas |

**Écran de session fermée**

| Élément | Spécification |
|---|---|
| Bandeau permanent | `Lecture seule, session fermée` |
| Contenu | Transcript rendu selon 3.3, en lecture seule |
| Composer | Masqué, pas seulement désactivé |
| Bouton primaire | `Reprendre sur le Mac`, pleine largeur, 60 pt |
| Effet | `new-tab` avec le `cwd` et `claude --resume <id>`. **Aucun processus lancé à la simple ouverture de l'écran.** |
| État intermédiaire | `Reprise en cours, {n} s`, bouton désactivé, poll toutes les 500 ms |
| Succès | Dès qu'un pane porte l'`agent_session_id` repris : bandeau retiré, composer affiché, sans rechargement |
| Échec à 20 s | `La reprise n'a pas abouti`, bouton `Ouvrir le terminal`, bouton `Reprendre` réactivé |
| Transcript absent | Ligne grisée non ouvrable, mention `Transcript introuvable`. `Reprendre sur le Mac` reste disponible |

### 3.5 Bloc B, Terminal

| ID | Fonction | Comportement attendu | Lot |
|---|---|---|---|
| B1 | Repli monospace | Vue brute du contenu visible du pane, sans émulation. Repli obligatoire de A5 et A6. | 1 |
| B2 | Terminal complet | xterm.js alimenté par le `.raw`. Le daemon ouvre, se positionne à la fin, streame, et **ne charge jamais le fichier entier** (757 Mo observés sur un ancien log). | 2 |
| B3 | Resynchronisation, pas rejeu | Le `.raw` est un flux de redessin à positionnement absolu, pas un journal append-only. On rejoue depuis un point sûr et l'émulateur converge (A15). Budget de rejeu : **2 Mo**, valeur unique pour les trois documents (C35). Au delà (145,2 Ko/min mesuré, soit 4,3 Mo pour 30 min hors ligne), l'écran est vidé et repart du contenu visible courant. | 2 |
| B4 | Repli si capture absente | `.raw` inexistant, ou sans croissance depuis 10 s alors que `working=true` : bascule sur `get-pane-content` à 1 Hz, avec un indicateur `mode dégradé`. | 2 |
| B5 | Barre de touches spéciales | `Esc`, `Tab`, `Ctrl`, les 4 flèches, `1` `2` `3`, `Entrée`, `/`, `@`, `Ctrl+C`. Toutes par le type énuméré, jamais en texte libre. `Ctrl+C` demande un glissement. | 2 |
| B6 | Ajustement de la taille | **Le pane du Mac n'est jamais redimensionné depuis le téléphone.** Rendu à la largeur réelle du pane, zoom pincé, défilement horizontal, `Fit` purement client. `resize-pane` n'est pas utilisée en v1. | 2 |
| B7 | Rotation et clavier | En paysage, pleine largeur. L'ouverture du clavier ne re-flow pas le buffer. | 2 |

### 3.6 Bloc C, Fichiers (lot 3)

| ID | Fonction | Comportement attendu |
|---|---|---|
| C1 | Navigation | Racine par défaut `~`, **lecture sur tout le disque** conformément au choix de Robin. Raccourcis : projets récents, `Bureau`, `Téléchargements`, `Documents`, `/`. Cachés masqués par défaut. Pagination par 500. Pas de recherche récursive. |
| C2 | Aperçu | Images (HEIC, PNG, JPG, GIF, WebP), PDF multi-pages, texte et code colorés, markdown. Texte au delà de 10 Mo : 200 premiers Ko avec mention. Format non pris en charge : métadonnées et `Enregistrer`. |
| C3 | Téléchargement | Feuille de partage iOS. Sélection multiple jusqu'à 20, transfert séquentiel, progression, annulation. |
| C4 | Upload | `Envoyer ici`, depuis Photos ou Fichiers. Collision : `nom-2.ext`. **Jamais de bouton `Remplacer`.** |
| C5 | Share Extension | Voir S7. Fonctionne Kova fermé. |
| C6 | Liste noire d'écriture | **Lecture totale.** Écriture refusée sur : `~/Library/LaunchAgents`, `~/Library/LaunchDaemons`, `/Library/Launch*`, le plist et le répertoire du daemon, `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/kova`, `~/.claude`, `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `~/.profile`, `/etc`, tout `.app` et tout exécutable. Ce ne sont pas des fichiers de travail, ce sont les mécanismes de démarrage et d'authentification de la machine. Liste dans un fichier de configuration que Robin peut vider. Le refus affiche le motif et le chemin. |
| C7 | Journal d'audit | Écran `Activité`, onglet `Fichiers` (horodatage, chemin, sens, taille, origine) et onglet `Diagnostic` (`parse_failed`, `nse_failed`, âge de la dernière notification livrée, volume du jour). Lecture seule, 30 jours. |
| C8 | Actions exclues | Voir section 6. Aucune route de renommage, déplacement, suppression, création de dossier ou `reveal` ne doit exister côté daemon. |

### 3.7 Réglages, exactement 4 (C17, C28)

Le réglage `Extraits dans les notifications` est **supprimé** : la NSE récupère toujours le contenu sur le canal chiffré direct, donc la charge utile n'a jamais besoin de contenu sensible. Le réglage n'avait plus d'objet, et sa sémantique divergeait entre les trois documents au point de pouvoir tuer S1 dès l'installation.

| Réglage | Valeur par défaut | Pourquoi il existe |
|---|---|---|
| Validations seulement | **Désactivé** | Coupe N2, N3 et N4 d'un tap le jour où le produit devient bruyant (R9). Activé par défaut, il éteindrait la notification de fin de tour, qui est le coeur du produit. |
| Heures calmes, 23h à 7h | Activé | Imposé par la vie réelle |
| Empêcher la veille du Mac quand un agent travaille | Activé | Imposé par A1, qui exige un interrupteur |
| Révoquer l'appairage | Action | Sécurité, effet immédiat |

Sous ces réglages s'affiche un bloc `Activité` en lecture seule (5 lignes de diagnostic), qui n'est pas une entrée interactive.

Tout le reste est en dur : pas de canal OTA, pas de tailles de police séparées, pas de forçage de route, pas de `Main gauche`, pas de `Muter` par projet (C31 : couper silencieusement et sans retour la notification qui justifie le produit est un piège, et les heures calmes plus `Validations seulement` couvrent déjà le besoin).

---

## 4. Notifications push

### 4.1 Déclencheurs

| ID | Déclencheur | Événement IPC exact | Condition supplémentaire | Lot |
|---|---|---|---|---|
| N1 | L'agent attend ma réponse | **Front montant** de `pane-status.awaiting` (`false` vers `true`) | Aucune. Couvre les deux cas, fin de tour et prompt de permission : c'est le même événement, seul le rendu diffère. | 1 |
| N2 | L'agent a terminé sans passer en attente | `pane-working` avec `working: false` | Le pane était `working: true` depuis **plus de 60 s**, et `awaiting` vaut `false`. **Ce seuil de 60 s est la valeur opposable, déclarée ici et nulle part ailleurs** (C29). Si `awaiting` est monté, N1 prime et N2 est supprimée. | 1 |
| N3 | L'agent s'est arrêté anormalement | `pane-close` pour un pane qui était `working: true` | Non déclenché si la fermeture suit une action initiée depuis l'app | 2 |
| N4 | Mac de nouveau joignable alors qu'une action attend | Reconnexion du daemon | Seulement s'il reste une action en file côté iPhone | 2 |

`pane-open` et `focus` ne déclenchent jamais de notification. Toute catégorie absente de cette table est absente du produit.

### 4.2 Charge utile et récupération du contenu (A14, C4, C24, C25)

**Ce qui transite par Expo et APNs, et rien d'autre :**

```
{ "project": "Link", "pane_id": 66, "event": "awaiting",
  "prompt_ref": "<référence opaque, à usage unique, sans identifiant de pane>",
  "aps": { "mutable-content": 1, "alert": { "title": "Link", "body": "Validation requise" } } }
```

**Ce que fait la Notification Service Extension, avant affichage :**

| Étape | Détail |
|---|---|
| 1 | `GET /v1/prompt/{prompt_ref}` sur le canal chiffré direct, avec un **jeton court dédié à la NSE**, qui n'ouvre aucune autre route |
| 2 | La référence est **opaque et à usage unique** : un second appel renvoie 404. Elle ne fuite pas l'identifiant de pane. |
| 3 | La réponse porte `kind: "turn_end"` ou `kind: "prompt"` |
| 4 | La NSE réécrit **le corps** de la bannière et choisit une catégorie **pré-enregistrée**. Elle n'enregistre jamais de catégorie : cette capacité n'est pas documentée par Apple, et si elle échoue la bannière apparaît sans aucune action (C25). |
| 5 | Budget : **4 s**. iOS n'en accorde pas davantage. |

**Catégories, vocabulaire unique pour les trois documents**

| Identifiant | Quand | Actions |
|---|---|---|
| `KL_TURN_END` | `kind: "turn_end"` | `Interrompre`, `Ouvrir` |
| `KL_AWAITING_2`, `KL_AWAITING_3` | `kind: "prompt"` avec 2 ou 3 options | Boutons portant les **chiffres**, plus `Interrompre` |
| `KL_AWAITING_BLIND` | NSE en échec ou expirée, parsing impossible, ou plus de 3 options | `Interrompre`, `Ouvrir`, et rien d'autre |
| `KL_DONE` | N2 | `Ouvrir` |
| `KL_CLOSED`, `KL_RECONNECT` | N3, N4 | `Ouvrir` |

Toutes sont enregistrées **statiquement au lancement de l'app**. Les libellés d'action sont donc figés : ce sont des chiffres. C'est le **corps** réécrit par la NSE qui dit ce que fait chaque chiffre, et c'est ce que Robin lit.

**Contenu final affiché, après réécriture :**

| Cas | Titre | Corps | Sous-titre |
|---|---|---|---|
| N1, fin de tour | `{onglet} attend ta réponse` | Dernier bloc `text` de l'assistant, 140 premiers caractères | Durée du tour et nombre d'outils (`4 min 12 s, 11 outils`) |
| N1, prompt | `{onglet} attend ta validation` | Question tronquée à 120 caractères, puis le détail, puis la liste numérotée des options | Nom de l'outil concerné si détecté |
| N1, repli aveugle | `{onglet}` | `Validation requise` | Nom du projet |
| N2 | `{onglet} a terminé` | Dernier bloc `text` de l'assistant, 140 caractères | Durée de la tâche |
| N3 | `{onglet} s'est fermé` | `La session a été fermée alors qu'un agent travaillait.` | Nom du projet |
| N4 | `Mac de nouveau joignable` | `{n} action(s) en attente d'envoi.` | |

**Si la NSE échoue ou expire :** catégorie `KL_AWAITING_BLIND`, **aucune action d'option**, seulement `Interrompre` et `Ouvrir`, et l'app doit être ouverte pour décider. On n'approuve jamais une question qu'on n'a pas affichée.

### 4.3 Actions rapides et troncature (A2, A10, C26, C30)

| Catégorie | Actions, dans l'ordre de déclaration | Face ID |
|---|---|---|
| `KL_AWAITING_{n}` | Les chiffres des options par index croissant, puis `Interrompre` | **Oui** sur toute option qui autorise une action, non sur une option de refus |
| `KL_AWAITING_BLIND`, `KL_TURN_END` | `Interrompre`, `Ouvrir` | Non |
| `KL_DONE`, `KL_CLOSED`, `KL_RECONNECT` | `Ouvrir` | Non |
| Notification agrégée | `Ouvrir` uniquement, déroule sur la liste filtrée `awaiting` | Non |

**Aucune action de notification n'ouvre de champ de saisie** (C26). Une saisie libre depuis l'écran verrouillé permettait de taper `1` puis Entrée et d'approuver l'option 1 sans Face ID, sans `prompt_hash` et sans relecture du pane : elle contournait les trois garde-fous à la fois.

**Règle de troncature, iOS n'affiche que 4 actions :**

1. Ordre de déclaration : options par index croissant, puis `Interrompre`.
2. `Interrompre` et l'option de **refus** (le dernier index) ne sont **jamais** retirés.
3. Si le total dépasse 4, on retire les options intermédiaires en partant de l'avant-dernière. Jamais la première, jamais la dernière.
4. Au delà de **3 options** dans le prompt : **aucune action rapide d'option**, la bannière retombe sur `KL_AWAITING_BLIND`, et le corps affiche quand même la question et la liste complète.
5. Toute option non exposée reste lisible dans le corps. `Ouvrir` n'occupe jamais un emplacement : taper la bannière ouvre l'app.

Justification de l'asymétrie Face ID, à ne pas réinterpréter : approuver engage le disque entier, refuser et interrompre sont les gestes sûrs. Exiger Face ID sur le geste défensif pousse à approuver par facilité. Le pire cas d'un refus non authentifié est un agent bloqué.

### 4.4 Règles anti-bruit et concurrence

| Règle | Détail |
|---|---|
| Front montant seulement | Une notification par transition `false` vers `true` de `awaiting`. Un `awaiting` qui reste vrai ne renotifie pas. |
| Une notification vivante par pane | `thread-id` = `pane_id`, `apns-collapse-id` identique. La nouvelle remplace la précédente. |
| Robin est devant son Mac | Si le dernier `focus` indique `app_active: true` **et** que le pane concerné est focalisé, N1 et N2 sont suspendues 60 s. Passé ce délai sans changement d'état, la notification part quand même. |
| App au premier plan | Bandeau in-app, aucune notification système. |
| Session déjà à l'écran | Aucune notification pour cette session. |
| Retrait automatique | Une notification N1 est retirée dès que `awaiting` repasse à `false`, quelle que soit l'origine de la réponse. |
| Heures calmes, 23h à 7h | Seul N1 sonne. N2, N3 et N4 en mode passif. |
| Plafond | 20 par heure. Au delà, agrégation en `{n} agents attendent`, qui ne porte que `Ouvrir`. |
| Deux attentes simultanées | La question à l'écran **n'est jamais remplacée** par celle d'un autre pane. Une bannière interne annonce le second, le compteur de la section `EN ATTENTE` s'incrémente. |

---

## 5. Exigences non fonctionnelles chiffrées

### 5.1 Latence

Il n'y a pas d'écouteur LAN séparé (A11) : Tailscale établit lui même une connexion **directe** sur le même réseau, **relayée** sinon.

| Mesure | Direct | Relayé | Plafond acceptable |
|---|---|---|---|
| Ouverture de l'app jusqu'à liste affichée (cache local) | < 200 ms | < 200 ms | 400 ms |
| Liste rafraîchie et fiable | p50 < 500 ms, p95 < 1 s | p50 < 1 s, p95 < 2,5 s | 4 s |
| Récupération du contenu par la NSE | p95 < 1,5 s | p95 < 3 s | 4 s, au delà repli aveugle |
| Ouverture d'une session jusqu'au dernier échange affiché | p50 < 600 ms, p95 < 1,5 s | p50 < 1 s, p95 < 2,5 s | 3 s |
| Nouveau message visible dans la session, app ouverte | p50 < 300 ms, p95 < 1 s | p50 < 800 ms, p95 < 2 s | 3 s |
| Émission de l'APNs après l'événement IPC | < 500 ms | < 500 ms | 1 s |
| Tap sur une réponse rapide jusqu'à `send-keys` émis | p95 < 1,5 s | p95 < 2,5 s | 5 s, au delà on annule et on affiche l'erreur |
| Tap sur `Interrompre` jusqu'à `working: false` | p95 < 1,5 s | p95 < 2,5 s | 2 s |
| Frappe au clavier jusqu'à écho dans le terminal | p95 < 250 ms | p95 < 600 ms | 1 s |
| Ouverture d'un dossier de 5 000 entrées | < 1 s | < 1,5 s | 3 s |

La livraison finale par APNs reste hors de notre contrôle. Objectif suivi, non contractuel : notification reçue en moins de 10 s dans 95 % des cas.

### 5.2 Fichiers (A4)

| Paramètre | Valeur v1 |
|---|---|
| Taille maximale par fichier | **Aucun plafond.** La limite est l'espace disque. |
| Mode de transfert | Flux dans les deux sens. Aucun fichier entier en mémoire, ni daemon, ni app. |
| Découpage | Morceaux de 4 Mo, reprise au dernier morceau confirmé |
| Données cellulaires | Au delà de 100 Mo, choix explicite `Envoyer maintenant` ou `Attendre le Wi-Fi` |
| Débit cible en direct | > 20 Mo/s |
| Transferts simultanés | 1 actif, les autres en file |
| Sélection multiple | 20 fichiers |
| Aperçu texte | intégral jusqu'à 10 Mo, puis 200 premiers Ko |
| Intégrité | SHA-256 des deux côtés, rejoué si divergence |
| Collision de nom | `nom-2.ext`, jamais d'écrasement |
| Fichier de 0 octet | accepté |
| Chemin en liste noire | refus avant transfert, motif et chemin affichés |

### 5.3 Hors ligne

| Situation | Comportement |
|---|---|
| iPhone sans réseau | Bandeau `Hors ligne`. Cache local consultable (liste, dernier échange des sessions ouvertes). |
| iPhone en réseau, daemon injoignable | Bandeau **distinct** : `Mac endormi ou éteint, dernier état à {heure}`. |
| Message texte écrit hors ligne | En file, `En attente`, envoyé à la reconnexion si moins de 15 min, sinon confirmation. File limitée à 5. |
| Réponse à une validation hors ligne | **Jamais en file au delà de 60 s.** Ensuite : abandon et message explicite. L'état d'un prompt est trop volatile pour être rejoué. |
| Interruption hors ligne | Mise en file 5 min : contrairement à une approbation, interrompre tard reste sûr. |
| Coupure pendant un transfert | Reprise au dernier morceau confirmé, 3 tentatives, backoff 2 s, 8 s, 30 s, puis abandon et suppression du partiel. |
| Retour du réseau | Reconnexion en moins de 3 s, resynchronisation de la liste et de la session ouverte. |

### 5.4 Mac endormi, Kova fermé, pane disparu

| Situation | Détection | Comportement |
|---|---|---|
| Un agent travaille, le Mac risque de s'endormir | Au moins un pane `working: true` | Assertion IOKit `PreventUserIdleSystemSleep`, relâchée dès le dernier arrêt, **plafond 4 h** (A13). Déclenchée par l'agent qui travaille, jamais par la présence d'un client. Interrupteur dans les Réglages (A1). |
| Capot fermé sur batterie | Daemon injoignable | On ne contre pas la fermeture du capot (batterie, chaleur dans un sac). L'app affiche `Mac endormi ou éteint, dernier état à {heure}`. |
| Kova fermé, Mac allumé | Le socket `/tmp/kova-*.sock` n'existe plus | `Kova n'est pas lancé`, **sans chemin de socket technique**, bouton `Lancer Kova`, mention `Les fichiers restent accessibles`. Le Bloc C ne dépend pas de Kova. |
| Kova relancé | Le PID change, donc le chemin du socket | Redécouverte par glob toutes les 5 s, réabonnement, réattachement des `pane_id` et des `.raw`. Aucune action de Robin. |
| Pane fermé pendant l'affichage | `get-pane-content` renvoie `ok: true` avec `{"error":"not found","id":N}`, sans `cols` ni `rows` | `Cette session n'existe plus`, retour à la liste, aucune commande émise, aucun rendu avec des dimensions indéfinies. |
| Captures `.raw` orphelines | 4 PID morts sur 5, 1,1 Go | Purge par croisement avec les sockets **vivants** et la date de modification. `kill(pid, 0)` interdit : les PID sont réutilisés. |
| Daemon planté | Absence de réponse | Relance par `launchd` (`KeepAlive`), sous l'utilisateur de Robin, jamais en root. |
| Reconnexion | | Backoff 1 s, 2 s, 4 s, plafond 30 s. |

### 5.5 Ressources, sécurité opérationnelle

| Contrainte | Valeur |
|---|---|
| Batterie iPhone | Aucun polling en tâche de fond, tout passe par APNs |
| Mémoire du daemon | < 150 Mo en régime établi, y compris pendant un transfert de plusieurs Go |
| Mémoire de l'app | < 150 Mo, idem |
| CPU du daemon au repos | < 1 % |
| Jeton principal | Trousseau macOS côté Mac, jamais en clair (des agents de code tournent sur cette machine et peuvent lire un fichier). En tête `Authorization`, jamais `Sec-WebSocket-Protocol`. Expiration, rotation, révocation immédiate. N'apparaît dans aucun journal, aucune URL, aucun message d'erreur. |
| Jeton de la NSE | Distinct, court, limité à `GET /v1/prompt/{ref}`. Aucun accès aux fichiers ni aux commandes. |
| Appairage | QR affiché sur le Mac, **expire après 5 minutes** (`PAIRING_TTL_MS`, décidé en passe de corrections) et disparaît de l'écran |
| TLS | Let's Encrypt via `tailscale cert` sur le nom MagicDNS (A12). Pas d'épinglage SPKI, pas de module natif Swift au lot 1. Renouvellement sans régénération de clé. |
| Journal d'audit | Une ligne par accès fichier, rotation à 50 Mo, conservation 30 jours |
| Mise à jour | OTA via EAS pour tout changement JavaScript |
| Compatibilité Kova | Version d'IPC vérifiée au démarrage. Commande manquante : écran `Kova incompatible`, jamais un échec silencieux. |

---

## 6. Hors périmètre explicite en v1

| Écarté | Pourquoi |
|---|---|
| **Renommer, déplacer, supprimer, dupliquer un fichier, créer un dossier, `reveal`** | Décision ferme et sans exception. Un balayage accidentel en poche est irréparable, pour un bloc qui pèse 4 % des ouvertures. Conséquence opposable : **aucune route `mkdir`, `move`, `copy`, `delete` ou `reveal` côté daemon**, aucun balayage autre que `Partager`, aucun bouton `Remplacer`. |
| Écriture sur les chemins de démarrage et d'authentification | Liste noire de 3.6. Ce ne sont pas des fichiers de travail. |
| **Saisie de texte depuis une notification** | Elle permettait d'approuver un prompt en tapant `1`, sans Face ID, sans hash, sans relecture (C26). |
| **`Muter` un projet** | Couper silencieusement et sans retour la notification qui justifie le produit est un piège (C31). `Validations seulement` et les heures calmes couvrent le besoin. |
| Enregistrement dynamique de catégories de notification par la NSE | Capacité non documentée par Apple. Si elle échoue, la bannière apparaît sans aucune action, silencieusement, sur le seul écran qui compte (C25). |
| Édition de fichiers texte depuis l'iPhone | On ne code pas au doigt. Toute modification passe par l'agent. |
| Redimensionner un pane du Mac depuis le téléphone | Casserait l'affichage côté bureau pour un bénéfice nul : un `Fit` local suffit. |
| Grille de panes (split, swap, merge, reparent, détacher), multi-fenêtres | Gestes de bureau. `session.json` n'a qu'une fenêtre. |
| `dispatch-action` | Donne accès à `close-pane-or-tab` et `paste`. Aucune action dispatchée en v1. |
| Récupération du résultat complet d'un outil externalisé | Le JSONL ne référence pas les fichiers de `tool-results/`, ni par nom, ni par marqueur, ni par champ (vérifié). Spécifier une route qui promet un contenu inaccessible serait mentir (C34). |
| Recherche plein texte dans les transcripts, recherche récursive sur le disque | 62 sessions, 5 panes actifs. |
| Vue diff, revue de code, actions git | Autre produit. |
| Rendu chat pour les agents non-Claude | Format de transcript différent et non vérifié. Bascule silencieuse et explicable vers le terminal (A5). |
| Dictée maison, forme d'onde, `expo-speech-recognition` | La touche micro du clavier iOS fait déjà tout. |
| Réglage `Main gauche` | Le seul réglage capable de provoquer une erreur coûteuse. |
| Mode clair | v1 sombre uniquement (A9). Les tokens existent, ils ne sont pas câblés. |
| Live Activity, widget, raccourci Siri, Apple Watch | Pas sur le chemin de S1. Candidats v1.1. |
| Relais cloud, tunnel tiers, écouteur LAN séparé | Tailscale fournit déjà la connexion directe (A11). |
| Comptes, multi-utilisateur, partage | Un seul utilisateur. |
| Layout iPad dédié, publication App Store | Mode compatibilité, TestFlight interne. |

---

## 7. Critères d'acceptation

Règle appliquée : **un critère qu'un tiers ne peut pas exécuter sans interpréter n'est pas un critère.** Chaque ligne indique la mise en situation, l'action et un résultat observable binaire. Les latences se lisent dans les journaux horodatés.

**Marquage NON EXÉCUTABLE (C37).** Les critères marqués `[NE]` dépendent d'un rendu réel de prompt de permission. Aucune session de la machine n'en produit aujourd'hui (toutes en `bypassPermissions` ou `auto`, vérifié sur 5 projets, zéro rendu réel dans les 58 fichiers `.raw`). **Ils ne doivent pas être déclarés satisfaits.** Procédure pour les rendre exécutables, à faire avant la recette du lot 1 :

1. Basculer un projet de test en mode de permission par défaut (`shift+tab` dans le pane, jusqu'à sortir de `bypass permissions on`).
2. Déclencher une action nécessitant une permission (`Edit` sur un fichier, puis `Bash`).
3. Capturer le rendu réel avec `get-pane-content` en `mode: "visible"` et le versionner comme fixture du parseur.
4. Répéter avec **deux `Bash` consécutifs de commandes différentes**, pour la fixture du défaut C20.
5. Rejouer les critères `[NE]` contre ces fixtures, puis sur appareil.

### Lot 1, la boucle de travail

**Appairage**

- [ ] CA-01 Le QR affiché sur le Mac appaire l'iPhone, et la liste des sessions s'affiche à l'issue.
- [ ] CA-02 Le QR disparaît de l'écran du Mac au bout de 5 minutes, et un appairage tenté après ce délai échoue.
- [ ] CA-03 Le jeton principal est trouvé par `security find-generic-password` et introuvable par `grep -r` sur le répertoire du daemon.

**Liste et état live**

- [ ] CA-04 Kova ouvert avec 5 panes : la liste affiche 5 lignes, dont les `pane_id` correspondent un à un à ceux de `{"cmd":"list-panes"}`.
- [ ] CA-05 Provoquer un `awaiting` sur le pane placé en dernier : il occupe la première position au bout de 2 s, sans que l'écran ait été touché.
- [ ] CA-06 Un pane dont l'événement porte `awaiting: true` et `working: true` affiche `Attend ta réponse`, pas `Travaille`.
- [ ] CA-07 Une session dont le dernier `permissionMode` du JSONL vaut `bypassPermissions` porte un badge `bypass` et le texte `aucune validation ne te sera demandée`.
- [ ] CA-08 La ligne d'une session en attente porte `Ouvrir` et `Interrompre`, et **zéro** bouton portant le texte d'une option de prompt.
- [ ] CA-09 `Interrompre` est présent et actionnable sur une ligne de la section `TRAVAILLE`, et sur une ligne de la section `EN ATTENTE`.
- [ ] CA-10 Aucune ligne de la liste n'expose d'action `Muter`, ni par balayage, ni par appui long.
- [ ] CA-11 `Ouvrir sur le Mac` met le pane concerné au premier plan sur le Mac, et le journal montre `focus-pane` et aucune commande `dispatch-action`.

**Notification**

- [ ] CA-12 Sur 20 déclenchements, l'écart entre la réception de `pane-status` et l'émission de l'APNs, tous deux dans le journal du daemon, est inférieur à 500 ms au 95e centile.
- [ ] CA-13 Une notification est émise sur la transition de `awaiting` de `false` à `true`, et une seule. Un `awaiting` qui reste vrai pendant 5 min n'en produit aucune autre.
- [ ] CA-14 Deux fronts montants successifs sur le même pane laissent une seule notification dans le centre de notifications.
- [ ] CA-15 La charge utile APNs capturée sur l'appareil contient exactement les clés `project`, `pane_id`, `event`, `prompt_ref` et `aps`, et **aucune** chaîne présente dans le dernier message de l'assistant ou dans la question.
- [ ] CA-16 La charge utile porte `mutable-content: 1`.
- [ ] CA-17 Fin de tour : après passage de la NSE, le corps de la bannière est identique aux 140 premiers caractères du dernier bloc `text` de l'assistant dans le `.jsonl`.
- [ ] CA-18 `[NE]` Prompt : après passage de la NSE, le corps contient les 120 premiers caractères de la ligne de question, puis les lignes de détail, puis la liste numérotée des options.
- [ ] CA-19 La NSE abandonne au bout de 4 s au maximum, mesuré dans son journal, et la notification est affichée dans tous les cas.
- [ ] CA-20 Daemon arrêté juste après l'émission : la bannière porte la catégorie `KL_AWAITING_BLIND`, et le menu d'appui long ne contient que `Interrompre` et `Ouvrir`, aucune action d'option.
- [ ] CA-21 `GET /v1/prompt/{ref}` appelé deux fois avec la même référence : le second appel reçoit 404.
- [ ] CA-22 La valeur de `prompt_ref` ne contient pas l'identifiant de pane (inspection de la chaîne).
- [ ] CA-23 Le jeton de la NSE, utilisé sur une route de fichiers ou de commande, reçoit 403.
- [ ] CA-24 Les catégories `KL_TURN_END`, `KL_AWAITING_2`, `KL_AWAITING_3`, `KL_AWAITING_BLIND` et `KL_DONE` sont enregistrées au lancement de l'app, et la NSE n'appelle jamais `setNotificationCategories`.
- [ ] CA-25 Sur une installation neuve, sans toucher aux réglages, une fin de tour affiche le dernier message de l'assistant dans la bannière.
- [ ] CA-26 `[NE]` Prompt à 2 options : 2 boutons de chiffre plus `Interrompre`. Prompt à 3 options : 3 boutons de chiffre plus `Interrompre`. Jamais plus de 4 actions.
- [ ] CA-27 `[NE]` Prompt à 4 options ou plus : **aucun bouton de chiffre**, la bannière retombe sur `KL_AWAITING_BLIND` avec `Interrompre` et `Ouvrir` seuls, et la liste complète des options reste lisible dans le corps. Motif : 4 options plus `Interrompre` demanderaient 5 actions pour un budget iOS de 4, et une catégorie pré-enregistrée statiquement ne sait pas quel index porte le refus, donc elle risquerait de retirer précisément le geste sûr.
- [ ] CA-28 `[NE]` Prompt à 5 options : aucune action d'option, catégorie `KL_AWAITING_BLIND`, et le corps affiche quand même la question et les 5 options.
- [ ] CA-29 Aucune action de notification, sur aucune catégorie, n'ouvre de champ de saisie de texte.
- [ ] CA-30 Le seuil de N2 est 60 s : une tâche de 55 s ne produit aucune notification, une tâche de 70 s en produit une.
- [ ] CA-31 Kova au premier plan sur le Mac avec le pane concerné focalisé : aucune notification pendant 60 s, puis une notification si l'état n'a pas changé.
- [ ] CA-32 Après 21 notifications dans l'heure, la 22e est agrégée et son menu ne contient que `Ouvrir`.
- [ ] CA-33 Répondre sur le Mac retire la notification correspondante de l'iPhone sans action de l'utilisateur.

**Rendu du dernier échange**

- [ ] CA-34 Ouvrir une session affiche le dernier message utilisateur et la dernière réponse de l'assistant, sans laisser l'écran vide plus de 1 s.
- [ ] CA-35 Un `requestId` portant 5 lignes `assistant` s'affiche comme un seul message ; un `requestId` d'une seule ligne aussi. Aucun nombre de blocs n'est codé en dur.
- [ ] CA-36 Les blocs d'un même `requestId` sont ordonnés par `apiBlockIndex` croissant. Test de non-régression : deux lignes de même `timestamp` restent dans l'ordre des `apiBlockIndex`.
- [ ] CA-37 Le total de jetons affiché pour un `requestId` de 5 lignes est égal à la valeur `usage` d'une seule ligne, pas à leur somme.
- [ ] CA-38 Les appels d'outils sont repliés avec le nom de l'outil et un résumé d'une ligne ; les déplier affiche le résultat.
- [ ] CA-39 Un `tool_result` avec `is_error: true` porte un marqueur d'erreur et est rattaché au `tool_use` de même `tool_use_id`.
- [ ] CA-40 Aucune entrée `attachment` n'apparaît dans le fil (session de référence : 31 sur 122 lignes, 0 visible).
- [ ] CA-41 Aucune ligne `queue-operation` n'est rendue (session de référence : 20 entrées, 11 blocs `<task-notification>`, 9 avec `content: null`). Aucun XML n'apparaît dans le fil.
- [ ] CA-42 Une ligne portant un `type` inventé (`"type":"zzz"`) n'affiche rien et le reste du fil s'affiche entièrement, sans erreur dans le journal.
- [ ] CA-43 Un pane dont `agent` vaut autre chose que `claude` affiche `Vue chat indisponible pour cet agent` et le bouton vers le repli monospace.
- [ ] CA-44 Transcript absent : le repli monospace affiche le contenu visible du pane, sans écran vide.

**Composer**

- [ ] CA-45 Un message de 3 lignes envoyé depuis l'iPhone arrive en un seul message : le transcript contient un unique message utilisateur de 3 lignes.
- [ ] CA-46 Le journal montre l'envoi du texte puis l'Entrée en deux commandes séparées, et le texte est encadré en bracketed paste.
- [ ] CA-47 Un message reste `En cours d'envoi` tant qu'aucune ligne correspondante n'existe dans le `.jsonl`, puis passe à `Envoyé`.
- [ ] CA-48 Sans confirmation après 20 s, le bandeau `Non confirmé` apparaît avec un bouton `Voir le terminal`.
- [ ] CA-49 `[NE]` Avec un prompt parsé ouvert sur le pane, l'envoi de texte libre est **refusé** avec un message explicite, et le journal ne contient aucun `send-keys` pour cet envoi.
- [ ] CA-50 Sur 50 envois de toute nature, le journal ne contient **aucune** commande `send-keys` dont le texte est un retour chariot seul.
- [ ] CA-51 Un envoi contenant une séquence OSC 52 est filtré : la commande atteignant Kova ne la contient pas.
- [ ] CA-52 Les caractères de contrôle autres que `\n` et `\t` sont retirés du texte libre (test avec `0x07` et `0x1b` insérés dans le message).

**Interruption**

- [ ] CA-53 Depuis la liste, sur un pane `working` : aucun Face ID, aucune confirmation, `working: false` en moins de 2 s.
- [ ] CA-54 Depuis la liste, sur un pane `awaiting` : même résultat.
- [ ] CA-55 Depuis la session ouverte : même résultat.
- [ ] CA-56 Depuis la notification, y compris une bannière `KL_AWAITING_BLIND` : même résultat.
- [ ] CA-57 Le message émis est `pane.interrupt {pane_id}` et il passe par le point d'entrée unique de filtrage (vérifiable dans le journal).

**Barre de validation**

- [ ] CA-58 `[NE]` Prompt à 3 options : 3 boutons dans l'app, libellés identiques à ceux du pane, ordonnés par index.
- [ ] CA-59 `[NE]` Prompt non parsable : le seul bouton plein est `Ouvrir le terminal`, et aucune option numérotée n'est proposée, sur aucune surface.
- [ ] CA-60 La requête de réponse contient `pane_id`, `option_index`, `prompt_hash`, `awaiting_since` et `nonce`, et ne contient ni champ `intent` ni libellé d'option.
- [ ] CA-61 Pour une réponse, le journal montre **exactement une** commande `send-keys`, dont le texte est le chiffre suivi du retour chariot.
- [ ] CA-62 `[NE]` **Éliminatoire.** Deux demandes `Bash` consécutives portant des commandes différentes produisent deux `prompt_hash` différents (test sur la fixture du prérequis 3).
- [ ] CA-63 Test unitaire sur fixture : modifier une seule ligne de détail change le `prompt_hash` ; déplacer le marqueur de surlignage ne le change pas.
- [ ] CA-64 `[NE]` Un `awaiting_since` différent fait refuser la réponse même quand le `prompt_hash` est identique.
- [ ] CA-65 `[NE]` Modifier la question sur le Mac entre l'affichage et le tap : le daemon renvoie `stale_prompt`, aucun `send-keys`, et l'app affiche `La question a changé sur le Mac` avec la nouvelle question.
- [ ] CA-66 `[NE]` Curseur positionné sur l'option 2 côté Mac, tap sur l'option 1 : le texte émis est `1\r` et c'est l'option 1 qui s'applique.
- [ ] CA-67 `[NE]` Taper une option d'approbation déclenche Face ID ; Face ID refusé, le journal du daemon ne contient aucune requête `answer` pour ce pane.
- [ ] CA-68 `[NE]` Taper une option de refus ne déclenche aucun Face ID et la requête part immédiatement.
- [ ] CA-69 Fermer le pane entre l'affichage et le tap : l'app affiche `Cette session n'existe plus`, aucun `send-keys` n'est émis, et l'app ne se ferme pas.
- [ ] CA-70 Deux panes passent en `awaiting` à 3 s d'intervalle : la question affichée reste celle du premier, une bannière annonce le second, et le compteur affiche 2.
- [ ] CA-71 Mode avion, réponse tapée, réseau rétabli après 90 s : aucune requête n'atteint le daemon et l'app affiche le message d'abandon.
- [ ] CA-72 Mode avion, `Interrompre` tapé, réseau rétabli après 90 s : l'interruption **est** envoyée (file de 5 min).
- [ ] CA-73 Kova quitté puis relancé (PID différent) : la liste redevient à jour en moins de 10 s sans action, et le journal montre le nouveau chemin de socket.
- [ ] CA-74 Les Réglages contiennent exactement **4 entrées interactives**, plus le bloc `Activité` en lecture seule, et aucune entrée `Extraits dans les notifications`.

### Lot 2, l'historique et le terminal

- [ ] CA-75 Remonter dans le fil charge 100 messages supplémentaires, dans l'ordre, sans doublon.
- [ ] CA-76 Un fichier `subagents/agent-*.jsonl` est rendu comme bloc pliable dans la bulle de l'outil dont le `toolUseId` correspond, jamais comme message de premier niveau.
- [ ] CA-77 L'app et le daemon n'émettent jamais `get-pane-content` avec `mode: "scrollback"` : recherche dans le code source, 0 occurrence.
- [ ] CA-78 Le terminal affiche correctement, contre une capture de référence prise sur le Mac : les 16 couleurs ANSI, une couleur 256, le gras, un effacement de ligne (`ESC[2K`), une réécriture par retour chariot, la barre de progression de Claude Code, et le curseur. 7 vérifications binaires.
- [ ] CA-79 Ouvrir le terminal d'un pane dont le `.raw` fait 200 Ko prend moins de 1,5 s, et la mémoire du daemon augmente de moins de 5 Mo.
- [ ] CA-80 Déconnexion de 30 min (croissance attendue d'environ 4,3 Mo) : le rejeu est plafonné à 2 Mo, au delà l'écran est vidé et repart du contenu visible, et l'affichage final correspond à celui du Mac.
- [ ] CA-81 `.raw` supprimé pendant l'affichage : bascule en mode dégradé avec l'indicateur visible, sans écran vide.
- [ ] CA-82 La barre de touches émet les valeurs attendues pour `Esc`, `Tab`, les 4 flèches, `Entrée` et les chiffres 1 à 3, toutes via le type énuméré.
- [ ] CA-83 `Ctrl+C` n'est envoyé qu'après un glissement de confirmation.
- [ ] CA-84 Le journal ne contient aucune commande `resize-pane` après une session complète, et le `Fit` de l'app ne modifie pas les `cols` du pane côté Mac.
- [ ] CA-85 En paysage, la position de lecture est conservée et le buffer n'est pas re-flowé.
- [ ] CA-86 La section `FERMÉES` affiche le nombre d'entrées de `claude_history.json` moins celles correspondant à un pane vivant, et elle est repliée à l'ouverture de l'écran.
- [ ] CA-87 Ouvrir une session fermée n'ajoute aucun processus : `ps` montre le même nombre de processus `claude` avant et après.
- [ ] CA-88 L'écran de session fermée affiche `Lecture seule, session fermée` et ne comporte aucun champ de saisie.
- [ ] CA-89 `Reprendre sur le Mac` crée un onglet dont le `cwd` est celui de la session et dont la commande est `claude --resume <id>`.
- [ ] CA-90 Pendant la reprise, l'écran affiche `Reprise en cours` avec un compteur et le bouton est désactivé.
- [ ] CA-91 Dès qu'un pane porte l'`agent_session_id` repris, le bandeau disparaît et le composer apparaît, sans rechargement manuel.
- [ ] CA-92 Reprise mise en échec volontairement : au bout de 20 s, `La reprise n'a pas abouti` s'affiche et le bouton redevient actif.
- [ ] CA-93 Création d'une session sur un projet récent : `Démarrage de Claude` avec compteur, puis ouverture dès l'`agent_session_id`.
- [ ] CA-94 Sans `agent_session_id` en 20 s, l'app bascule sur le repli monospace avec un bandeau, sans chargement infini.
- [ ] CA-95 N3 : fermer un pane qui travaillait produit une notification `s'est fermé` ; une fermeture initiée depuis l'app n'en produit aucune.

### Lot 3, les fichiers

- [ ] CA-96 Navigation de `~` à `/usr/local`, et ouverture d'un dossier de plus de 5 000 entrées en moins de 1 s.
- [ ] CA-97 Un dossier sans droit de lecture affiche `Accès refusé` et la navigation reste utilisable.
- [ ] CA-98 L'aperçu s'affiche pour un HEIC, un PDF de 50 pages, un `.ts` coloré et un `.md`.
- [ ] CA-99 Un fichier texte de 40 Mo affiche ses 200 premiers Ko et la mention de troncature.
- [ ] CA-100 Un fichier de 0 octet s'affiche et se télécharge sans erreur.
- [ ] CA-101 Transfert d'un fichier de 1,2 Go dans les deux sens : il aboutit, les SHA-256 sont identiques, et ni le daemon ni l'app ne dépassent 150 Mo de mémoire résidente.
- [ ] CA-102 Aucun refus lié à la taille n'existe : un fichier de 3 Go démarre son transfert.
- [ ] CA-103 En données cellulaires, un fichier de 150 Mo déclenche le choix `Envoyer maintenant` ou `Attendre le Wi-Fi` ; un fichier de 50 Mo ne le déclenche pas.
- [ ] CA-104 Depuis Photos, `Partager` puis `KovaLink` liste d'abord les 3 dernières destinations, puis les projets de `recent_projects.json`.
- [ ] CA-105 La Share Extension aboutit alors que Kova est quitté.
- [ ] CA-106 Envoyer un fichier dont le nom existe déjà crée `nom-2.ext`, l'original conserve son empreinte, et aucun bouton `Remplacer` n'est proposé.
- [ ] CA-107 Réseau coupé à 50 % d'un upload puis rétabli : le transfert reprend, et le total d'octets envoyés reste inférieur à 1,6 fois la taille du fichier.
- [ ] CA-108 Annuler un upload : aucun fichier partiel ne subsiste dans le dossier de destination.
- [ ] CA-109 Tentative d'envoi vers `~/.ssh` : refus avant tout transfert, chemin et motif affichés.
- [ ] CA-110 Les appels `mkdir`, `move`, `copy`, `delete` et `reveal` renvoient 404, et aucune de ces routes n'apparaît dans le code source du daemon.
- [ ] CA-111 Un balayage vers la gauche sur une ligne de fichier n'expose que `Partager`.
- [ ] CA-112 L'écran `Activité` contient une ligne par lecture et par écriture, et un onglet `Diagnostic` affichant `parse_failed`, `nse_failed` et le volume de notifications du jour.

### Transverses : sécurité, réseau, disponibilité

- [ ] CA-113 Sur le réseau du bureau, l'indicateur affiche `Direct`. En 4G, il affiche `Direct` ou `Relayé`, et jamais `LAN`.
- [ ] CA-114 `lsof -i -P` ne montre le daemon en écoute que sur l'adresse `100.x.x.x` et sur la loopback, jamais sur `0.0.0.0`.
- [ ] CA-115 Une requête sans en tête `Authorization` valide reçoit 401, et l'événement apparaît dans le journal.
- [ ] CA-116 Le jeton n'apparaît dans aucune ligne du journal du daemon ni de l'app : recherche sur sa valeur, 0 occurrence.
- [ ] CA-117 Le jeton n'est jamais transmis via `Sec-WebSocket-Protocol` : capture de la poignée de main, en tête absent.
- [ ] CA-118 `Révoquer l'appairage` : la requête suivante de l'iPhone reçoit 401, sans redémarrage du daemon.
- [ ] CA-119 Le certificat présenté est émis par Let's Encrypt sur le nom MagicDNS, et l'app se connecte sans code d'épinglage.
- [ ] CA-120 Mode avion : l'app affiche `Hors ligne` et le cache en lecture seule, sans écran d'erreur.
- [ ] CA-121 iPhone connecté et daemon arrêté : l'app affiche `Mac endormi ou éteint, dernier état à {heure}`, libellé distinct de celui du mode avion.
- [ ] CA-122 Un message texte écrit hors ligne part automatiquement à la reconnexion si moins de 15 min se sont écoulées, et demande confirmation au delà.
- [ ] CA-123 Kova quitté : les écrans Sessions et Terminal affichent `Kova n'est pas lancé` sans chemin de socket, le bouton `Lancer Kova` ouvre l'application, et l'onglet Fichiers reste utilisable.
- [ ] CA-124 Un agent qui travaille fait apparaître une assertion `PreventUserIdleSystemSleep` dans `pmset -g assertions` ; elle disparaît dans les 30 s suivant l'arrêt du dernier agent.
- [ ] CA-125 Un agent qui travaille depuis plus de 4 h ne maintient plus d'assertion.
- [ ] CA-126 Interrupteur `Empêcher la veille` désactivé : aucune assertion n'est posée même avec un agent en `working: true`.
- [ ] CA-127 Après un `kill` du daemon, il est de nouveau joignable en moins de 30 s sans intervention.
- [ ] CA-128 `ps -o user` sur le daemon renvoie l'utilisateur de Robin, pas `root`.
- [ ] CA-129 Une capture `.raw` appartenant à un PID mort dont le numéro a été réutilisé est purgée, et une capture liée à un socket Kova vivant ne l'est pas.
- [ ] CA-130 À 2h du matin, une notification N2 n'émet aucun son et n'allume pas l'écran, tandis qu'une N1 le fait.

### Traçabilité

| Lot | Critères | Éliminatoires | Non exécutables en l'état |
|---|---|---|---|
| Lot 1 | CA-01 à CA-74 | CA-15, CA-20, CA-29, CA-50, CA-61, CA-62 | CA-18, CA-26, CA-27, CA-28, CA-49, CA-58, CA-59, CA-62, CA-64 à CA-68 |
| Lot 2 | CA-75 à CA-95 | CA-77, CA-80 | aucun |
| Lot 3 | CA-96 à CA-112 | CA-109, CA-110 | aucun |
| Transverses | CA-113 à CA-130 | CA-114, CA-116, CA-117 | aucun |

**14 critères sur 130 sont non exécutables tant que les prérequis de 3.0 ne sont pas remplis.** Ils portent tous sur le parsing d'un prompt réel. Aucun d'eux ne doit être coché avant la capture des fixtures.

---

## 8. Risques et parades

| # | Risque | Prob. | Impact | Parade | Détection |
|---|---|---|---|---|---|
| R1 | Le parseur de prompts n'a **aucun échantillon réel** et ne peut pas être validé | Certaine | Le chemin S4, le plus dangereux, est écrit à l'aveugle | Parseur défensif par défaut : `unparsable` est le comportement attendu, pas une erreur. 14 critères marqués non exécutables. Prérequis de recette : basculer un projet en mode par défaut et capturer des fixtures. | Compteur `parse_failed` dans Diagnostic |
| R2 | Deux prompts consécutifs de même nature produisent le même hash | Moyenne | Critique : approbation appliquée à la mauvaise demande | Le hash couvre le **détail** (commande, chemin, diff), plus le report de `awaiting_since`. | CA-62, CA-63, CA-64 |
| R3 | Un retour chariot part sans vérification d'état et valide la ligne surlignée | Moyenne | Critique | Point d'entrée unique portant la règle : soit `prompt_hash` revérifié, soit envoi de texte refusé si un prompt parsé est ouvert. Aucun `\r` nu. | CA-49, CA-50 |
| R4 | La bannière fait décider sur un contenu jamais affiché | Élevée sans parade | Critique | NSE qui récupère le contenu sur le canal direct, catégories pré-enregistrées, corps réécrit. Échec : `KL_AWAITING_BLIND`, aucune action d'option. | CA-17, CA-20, indicateur `nse_failed` |
| R5 | Une porte dérobée contourne Face ID et le hash | Moyenne | Critique | Toute saisie de texte depuis une notification est supprimée. | CA-29 |
| R6 | Le produit ne notifie jamais parce que tout est en bypass et Robin ne comprend pas | Élevée | Le produit paraît cassé | Badge `bypass` et explication dans la liste. La notification de fin de tour, elle, fonctionne en bypass : c'est le déclencheur principal. | CA-07, indicateur d'ouvertures |
| R7 | Le chemin du socket contient le PID de Kova | Certaine | Perte de connexion silencieuse | Redécouverte par glob toutes les 5 s, réabonnement. | Absence de `ping` pendant 60 s, CA-73 |
| R8 | Les `.raw` grossissent sans limite (145,2 Ko/min, 757 Mo observés) | Certaine | Daemon saturé | Lecture en flux depuis la fin. Rejeu plafonné à 2 Mo. Purge par croisement avec les sockets vivants, jamais `kill(pid,0)`. | Mémoire du daemon, CA-129 |
| R9 | Le produit devient bruyant et Robin coupe les notifications | Moyenne | Mort du produit | Front montant seulement, une notification vivante par pane, suspension quand il est devant son Mac, heures calmes, plafond horaire, et `Validations seulement` en un tap. Pas de `Muter` silencieux. | Volume par jour dans Diagnostic |
| R10 | Un jeton volé devient une prise de contrôle permanente du Mac | Faible | Critique | Lecture totale conservée, écriture refusée sur la liste noire. Jeton au trousseau, rotation, révocation. Jeton de la NSE cantonné à une seule route. | CA-109, CA-110, CA-118 |
| R11 | APNs non délivré ou retardé | Moyenne | La boucle rate en silence | La liste dans l'app reste la vérité. Âge de la dernière notification livrée dans Diagnostic. Un `awaiting` non résolu depuis 10 min déclenche une seconde notification. | Accusé de réception applicatif |
| R12 | Injection par le canal terminal (OSC 52, caractères de contrôle) | Moyenne | Écriture du presse papier, exécution non voulue | Point d'entrée unique et filtré, touches par type énuméré, bracketed paste. | CA-51, CA-52 |
| R13 | Kova 1.12 change son API IPC | Moyenne | L'app casse d'un coup | Vérification de version au démarrage, écran `Kova incompatible`, commandes isolées dans un module unique. Kova est open source, on suit le dépôt. | Échec des lectures au démarrage |
| R14 | Le Mac s'endort, capot fermé | Élevée | Frustration | Assertion pendant qu'un agent travaille, plafond 4 h. On ne contre pas le capot fermé, on l'annonce. | CA-124, CA-125 |
| R15 | Le lot 3 coûte plus cher que le lot 1 pour 4 % des ouvertures | Moyenne | Retard sur la valeur | Trois lots, chacun démontrable seul. Rien n'est retiré. La Share Extension ne dépend pas de l'IPC. | Suivi de charge par lot |
| R16 | La build TestFlight expire au bout de 90 jours | Certaine | Robin sans app | Rappel calendrier, build EAS mensuelle, correctifs en OTA. | Date d'expiration dans les Réglages |

---

## 9. Conformité aux arbitrages et aux ordres de correction

| Réf | Décision | Où ce document l'applique |
|---|---|---|
| A1 | Assertion anti-veille, interrupteur exposé | 5.4, 3.7, CA-124, CA-126 |
| A2, A10 | Face ID sur Approuver uniquement | 4.3, S4 étape 5, S3, CA-67, CA-68, CA-53 à CA-56 |
| A3 | Ordre A puis B puis C | 3.0, colonne Lot des tableaux 3.1, 3.5, 3.6 |
| A4 | Aucun plafond de fichier, flux, avertissement cellulaire à 100 Mo | 5.2, S7, CA-101 à CA-103 |
| A5 | Rendu chat réservé à `claude`, repli explicable | 3.1 ligne A3, section 6, CA-43 |
| A6 | Parseur défensif, `prompt_hash` revérifié | 3.2 en entier, CA-59 à CA-66 |
| A7 | Pas d'approbation depuis la liste, interruption oui | 3.1 lignes A1 et A7, S3, CA-08, CA-09 |
| A8 | État `non parsable` de premier ordre | 3.2, CA-59 |
| A9 | v1 sombre uniquement | Section 6 |
| A11 | Pas d'écouteur LAN, indicateur direct ou relayé | 5.1, section 6, CA-113 |
| A12 | `tailscale cert`, pas d'épinglage, pas de module natif au lot 1 | 5.5, CA-119 |
| A13 | Assertion sur `working: true`, plafond 4 h | 5.4, CA-124, CA-125 |
| A14 | Aucun extrait dans la charge utile | 4.2, CA-15, CA-16 |
| A15 | `scrollback` interdit, resynchronisation, purge des orphelins | 3.2, 3.5 ligne B3, 5.4, CA-77, CA-80, CA-129 |
| A16 | `requestId`, `usage` jamais sommé, sous-agents par `toolUseId` | 3.3, CA-35 à CA-37, CA-76 |
| C20 | Le hash couvre le détail, plus `awaiting_since` | 3.2, table des entrées et des exclusions, CA-62 à CA-64 |
| C21, C32 | Interruption de premier ordre au lot 1, depuis la liste | 3.1 ligne A7, S3, CA-09, CA-53 à CA-57 |
| C22 | `queue-operation` ignoré, jamais rendu | 3.3, CA-41 |
| C23 | Aucun retour chariot sans vérification d'état | 3.2 règle 5, CA-49, CA-50 |
| C24 | Route opaque à usage unique, jeton dédié à la NSE | 4.2, CA-21, CA-22, CA-23 |
| C25 | Catégories pré-enregistrées, boutons portant les chiffres | 4.2, 4.3, section 6, CA-24, CA-26 |
| C26 | Aucune saisie de texte depuis une notification | 4.3, section 6, CA-29 |
| C27 | Repli `KL_AWAITING_BLIND` sans action d'approbation | 4.2, 4.3, CA-20 |
| C28 | Réglage `Extraits` supprimé, 5 vers 4 | 3.7, CA-74 |
| C29 | Seuil N2 à 60 s, déclaré opposable une seule fois | 4.1 ligne N2, CA-30 |
| C30 | Règle de troncature des actions | 4.3, CA-26 à CA-28 |
| C31 | `Muter` supprimé | 3.1 ligne A1, 3.7, section 6, CA-10 |
| C33 | Estimations honnêtes | 3.0 |
| C34 | Mécanisme `tool-results/` retiré | 3.3, section 6 |
| C35 | Budget de rejeu unique de 2 Mo | 3.5 ligne B3, CA-80 |
| C36 | Nouveau lot 1, rendu du dernier échange sur le chemin critique | Bandeau de tête, section 2, 3.0, 3.1 ligne A3, CA-34 à CA-44 |
| C37 | Critères de parsing marqués non exécutables, procédure fournie | Tête de section 7, prérequis 3.0, table de traçabilité |
