# Cmd+J sur l'iPhone : faire le tour des sessions

> Auteur : Senior Product Designer, équipe KovaLink. Sources : `02-design.md` (principes
> P1 à P5, tokens), `13-chat-lisibilite.md`, l'état réel de `app/app/index.tsx`,
> `app/app/panes.tsx`, `app/app/session/[paneId].tsx` et `app/src/features/sessions/*`.
> Libellés d'interface en anglais (décision de Robin), icônes Feather uniquement.

## 0. Le brief, et ce que Kova fait vraiment

Demande de Robin : « intégrer la fonctionnalité Cmd+J que l'on a sur desktop. Un bouton
sûrement pour passer d'affilée sur chaque session l'une après l'autre directement et voir son
état. »

Définition exacte de Cmd+J dans Kova : **saute au prochain pane non lu, à travers onglets et
fenêtres, et retombe sur une session Claude inactive quand rien n'est non lu.** Cmd+Shift+J
ouvre le sélecteur de panes filtré sur les non lus.

Le moment d'usage, celui qui commande tout ici : Robin a lancé quatre ou cinq agents sur
autant de projets, il pose son Mac, il reprend son téléphone vingt minutes plus tard, en
marchant, une main. Il veut **faire le tour** : pour chaque session où quelque chose s'est
passé, lire le dernier échange, donner la suite si besoin, passer à la suivante, sans
repasser par la liste. Le tour dure une à trois minutes et se fait plusieurs fois par jour.

### 0.1 Ce que l'app sait, mesuré dans le code

| Donnée | Où | Ce que ça vaut pour « non lu » |
|---|---|---|
| `pane.working`, `pane.awaiting`, `pane.awaiting_since` | `usePanes` | l'état vif |
| `pane.awaiting_seen` | `usePanes`, champ Kova | Kova l'a vu au premier plan sur le Mac. Sur la machine de Robin, `awaiting` ne se lève jamais (mesure dans `daemon/src/turnEnd.ts`), donc ce champ vaut `false` en pratique |
| `Prompt` par pane : `turn_end` (`endedAt`, `summary`, `promptRef`), `parsed` / `unparsable` (`awaitingSince`, `promptRef`), `none` | `usePrompts.byPane` | **l'événement à lire**, avec une référence unique par événement (`PromptRefs.mint`, 16 octets aléatoires). C'est la clé de lecture idéale : deux fins de tour du même pane ont deux `promptRef` différents |
| `setVisiblePane(paneId)` puis `ping.foregroundPaneId` | `net/connection.ts` | le pane que Robin regarde, envoyé au daemon à chaque ping (TTL 60 s) |
| `focus-pane` à l'ouverture (réglage `Follow on Mac`, actif par défaut) | `features/sessions/openOnMac.ts` | le Mac bascule sur le pane : Kova le tient pour vu de son côté |
| `paletteEntries(groups, '')` | `features/sessions/tabGroups.ts` | l'ordre exact du sélecteur de Kova : fenêtre, onglet, pane. C'est l'ordre de Cmd+J |

**Un trou à combler, quel que soit le parcours retenu.** Le `prompt` de fin de tour est
diffusé en direct (`hub.pushPrompt`) et jamais rejoué : `pane.peek` relit l'écran (donc
`parsed` / `unparsable` / `none`) mais ne connaît pas les fins de tour, et `usePrompts` vit en
mémoire. Une app lancée à froid ne sait donc pas quels tours se sont terminés pendant qu'elle
était fermée, précisément le cas du tour du propriétaire. Le daemon doit garder le dernier
`Prompt` non `none` par pane et le rejouer après `panes.snapshot` (section 6.5). Sans cela,
aucune des trois options ne fonctionne au premier lancement.

### 0.2 Ce qui compte comme « non lu » sur l'iPhone

> **Révisé le 16 septembre 2026. Kova est la source de vérité.** La règle d'origine (le
> téléphone recalculait « non lu » à partir des seuls `Prompt` du daemon) est **caduque**,
> et l'écart volontaire avec Kova qu'elle décrivait n'en est plus un. Ce choix rendait
> invisibles sur l'iPhone les cloches, les commandes shell terminées, les panes sans agent,
> les tours de moins de 60 s et les Cmd+U : le bouton Next du téléphone ne comptait pas la
> même chose que la pastille Next du Mac. C'est exactement le symptôme rapporté, « le bouton
> Next marche sur le Mac, pas sur le téléphone ».

Un pane est **non lu** quand `pane.unread` vaut `true`. C'est le bit que Kova calcule pour
lui même (`PaneFlags::is_unread`, `kova/src/window/sidebar.rs`) et qui pilote déjà Cmd+J, la
pastille Next et Cmd+U sur le Mac : marque manuelle, ou quelque chose de neuf depuis que le
pane a été regardé (question, fin de tour, cloche, completion, drapeau du hook). Kova
l'expose dans `list-panes`, le daemon le recopie tel quel dans `Pane`.

Conséquences, dans l'ordre où elles tranchent :

- Le pane sous les yeux sur le Mac n'est jamais non lu : Kova le tient pour vu. « Follow on
  Mac » (ouvrir un pane sur l'iPhone le focalise sur le Mac) suffit donc à éteindre la
  pastille des deux côtés pour une fin de tour ou une question.
- La marque de lecture est **locale au téléphone**, persistée (`kv`), et vient PAR DESSUS le
  bit de Kova, en recouvrement optimiste : la pastille s'efface dès que Robin a lu le pane,
  sans attendre les 5 s du sondage. Elle compare des références, jamais des horloges : le
  `promptRef` quand il y en a un, sinon un jeton fixe (une cloche n'a pas de `promptRef`).
  Dès que Kova annonce le pane lu, la marque est purgée, donc un NOUVEAU signal sur le même
  pane redevient non lu.
- Un pane **minimisé** ne fait pas partie de l'anneau, comme `collect_unread` sur le Mac.
- Un pane fermé quitte la liste et sa marque de lecture est purgée.
- `awaiting_seen` n'exclut pas du non lu : une question vue sur le Mac et pas répondue reste
  dans le tour. Il sert seulement à l'ordre (section 0.3).
- **Repli** : un Kova assez ancien pour ne pas envoyer `unread` laisse le champ absent, et
  l'app retombe alors sur la règle d'origine (un `Prompt` lisible non marqué, pane `working`
  exclu). Absent n'est pas `false` : `false` veut dire « Kova affirme que ce pane est lu ».

### 0.3 L'ordre du tour (l'anneau)

Ordre de Kova, à travers onglets et fenêtres, à partir du pane courant, en bouclant :
`paletteEntries(groupByTab(panes, tabs), '')`. Deux niveaux, parce que P2 dit que la
question de l'agent gagne toujours :

1. les panes `awaiting` non vus (`awaiting_seen: false`), dans l'ordre de Kova ;
2. tous les autres non lus, dans l'ordre de Kova.

Repli quand rien n'est non lu, exactement celui de Kova : la **prochaine session Claude
inactive** (`agent === 'claude'`, ni `working`, ni `awaiting`, pas non lue) dans le même
ordre. Puis rien : le geste disparaît, il ne tourne pas à vide.

L'anneau est recalculé à chaque geste « suivant », jamais figé au départ du tour : un pane
qui finit pendant le tour y entre, un pane fermé en sort, un pane relu n'y revient pas.

---

## 1. Option A : le bouton `Next unread` dans l'écran de session

L'écran de session reste l'écran de session. Un bouton flottant, dans la zone du pouce,
saute au prochain non lu. Exactement Cmd+J : un geste, un saut, l'écran cible normal.

```
+---------------------------------------------+
| < Sessions      [Chat|Term]        (o)  ... | 44pt nav bar
+---------------------------------------------+
| * Link · cc              ~/.../tools/link   | 28pt identité (point couleur onglet)
+---------------------------------------------+
| |  Done 3 min ago                           | 32pt AgentStatus (existant)
+---------------------------------------------+
|                                             |
|              +----------------------------+ |
|              | Ecris la spec Cmd+J        | | bulle utilisateur
|              +----------------------------+ |
|                                             |
| J'ai lu 02-design.md et le code de l'écran  | texte assistant pleine largeur
| Sessions. Trois options, une reco.          |
|                                             |
|   Read   docs/02-design.md            done  | lignes d'action compactes
|   Write  docs/16-cmd-j-mobile.md      done  |
|                                             |
|                    +----------------------+ |
|                    | >> Next unread   (3) | | 44pt, pill, bg.overlay, thumb zone
|                    +----------------------+ | 12pt au dessus du composer
+---------------------------------------------+
|  [ Message Link · cc...          ]   [ ^ ]  | 52pt composer
+---------------------------------------------+
|                                        34pt |
+---------------------------------------------+
```

`>>` figure l'icône Feather `skip-forward`. `(3)` est le nombre d'autres panes non lus.

| | |
|---|---|
| **Geste d'entrée** | N'importe quel chemin vers une session : notification de fin de tour, ligne de la liste, palette. Dès qu'il reste d'autres non lus, le bouton est là. Depuis la liste Sessions, un troisième bouton de la barre basse, `Next unread (3)`, ouvre le premier de l'anneau |
| **Geste « suivant »** | Tap sur le bouton. `router.replace('/session/{id}?focus=last')`, glissement latéral, haptique `impactAsync(Light)`. Jamais un balayage : l'horizontal est déjà pris par Chat / Term et par les blocs de code, et un balayage se fait en poche |
| **Ce qui compte comme lu** | Le pane est affiché au premier plan, avec un transcript rendu (cache compris), pendant **1 200 ms** ; ou Robin agit dessus (envoi, réponse, interruption), immédiatement |
| **Sortie** | Il n'y a pas de mode à quitter. Quand il ne reste rien, le bouton devient `All caught up` 1 600 ms puis `Next idle` (repli de Kova) ou disparaît. `< Sessions` reste toujours là |

**Forces.** C'est littéralement Cmd+J, donc le modèle mental du Mac. Il réutilise l'écran
central tel quel : composer à trois régimes, barre de validation, bandeau d'état, brouillons
par pane. Une session attachée à la fois, comme le store `useSession` l'impose. Le tour
commence de n'importe où, y compris depuis la notification qui a fait sortir le téléphone de
la poche, et n'a pas de fin à gérer.

**Faiblesses.** Le bouton ajoute un élément flottant à un écran qui en a déjà un (le
« retour en bas » du design 4.2). Le saut remonte l'écran entier, ce qui coûte un rendu de
transcript à chaque pas (le cache CA-120 le rend instantané pour les dix dernières sessions).
Aucune vue d'ensemble avant de partir : Robin découvre l'anneau en le parcourant.

**Risque d'erreur (répondre au mauvais pane).** Faible, et c'est l'argument principal. Le
bouton est masqué dès que le clavier est ouvert ou qu'un brouillon existe pour ce pane : on ne
peut pas sauter en pleine rédaction, et on ne peut pas taper en plein saut. Le bandeau
d'identité (point de couleur, onglet, titre) est le même que dans la liste et dans Kova. Le
placeholder du composer nomme le pane. Le glissement latéral et l'haptique disent qu'on a
changé de lieu. Les brouillons sont déjà par pane (`useDrafts`).

**Coût.** 350 à 420 lignes, tests compris (détail section 6.9).

---

## 2. Option B : le mode `Review`, un pager plein écran

Un mode dédié, à la façon des stories : une carte par pane non lu, balayage horizontal pour
passer à la suivante, segments de progression en haut.

```
+---------------------------------------------+
|  ===  ===  ---  ---  ---            [ x ]   | 44pt segments (2 sur 5 lus), Close
+---------------------------------------------+
| * Notes · claude                Waiting     | 36pt identité + état, fond awaitingBg
+---------------------------------------------+
|                                             |
|  Dernier échange                            |
|                                             |
|              +----------------------------+ |
|              | Nettoie les notes de la    | |
|              | semaine                    | |
|              +----------------------------+ |
|                                             |
| J'ai regroupé 14 notes en 3 fichiers. Je    |
| vais modifier notes/2026-09.md, tu          |
| confirmes ?                                 |
|                                             |
|                                             |
|     <  swipe  >                  2 of 5     | 20pt, footnote, text.tertiary
+=============================================+
|  [ 1 Yes ]   [ 2 Yes, always ]   [ 3 No ]   | barre de validation (existante)
+---------------------------------------------+
|  [ Message Notes · claude...     ]   [ ^ ]  | 52pt composer
+---------------------------------------------+
|                                        34pt |
+---------------------------------------------+
```

| | |
|---|---|
| **Geste d'entrée** | Bouton `Review (5)` dans la barre basse de Sessions, ou la carte de résumé en tête de liste |
| **Geste « suivant »** | Balayage horizontal sur la zone de contenu, ou tap sur la moitié droite de la barre de progression. Retour en arrière par balayage inverse |
| **Ce qui compte comme lu** | La carte a été affichée (page courante) 1 200 ms, ou Robin a agi |
| **Sortie** | `Close` (Feather `x`) en haut à droite, ou balayage vers le bas, ou la dernière page « All caught up » avec un bouton `Done` de 60 pt |

**Forces.** C'est le parcours le plus « tour du propriétaire » : Robin voit où il en est (2
sur 5), le geste est rythmé, la carte ne montre que le dernier échange donc rien ne distrait.
La barre de validation et le composer existants s'y intègrent tels quels.

**Faiblesses.** Lourd et contraire à l'architecture : `useSession` n'attache qu'une session
à la fois, le pager en demande au moins trois montées (précédente, courante, suivante) ou un
second rendu de transcript alimenté par `fetchTurns` en HTTP, c'est à dire une deuxième
implémentation du fil. Le balayage horizontal entre en conflit avec le balayage Chat / Term
(design 3.4) et avec le défilement horizontal des blocs de code (4.2). Un mode, c'est un
état de plus à quitter, un bouton `Close` en haut hors zone du pouce (P1), et un écran que
la notification ne sait pas ouvrir. Le retour en arrière, séduisant, recrée le problème du
pane relu qui rentre dans l'anneau.

**Risque d'erreur.** **Le plus élevé des trois**, et c'est éliminatoire. Un balayage
horizontal involontaire pendant qu'on relit, et le composer est sur un autre pane sans
qu'aucun geste explicite l'ait dit ; le clavier ouvert, un balayage sur le champ est ambigu.
Deux cartes de projets différents se ressemblent trait pour trait, seule la ligne
d'identité change. Interdire le balayage clavier ouvert réduit le risque mais retire le
geste principal au moment où il servirait.

**Coût.** 700 à 900 lignes : pager, rendu de carte, prélecture des transcripts, gestion des
conflits de gestes, page de fin, nouvelle route. Plus le refactor ou la duplication du fil.

---

## 3. Option C : la palette `Unread` avec `Start review`

Le Cmd+Shift+J de Kova : la palette de panes existante (`ui/Palette`), filtrée sur les non
lus, avec un bouton primaire de 60 pt qui lance le tour.

```
+---------------------------------------------+
|  Unread                              Close  | feuille modale (comme /panes)
+---------------------------------------------+
|  [ (Q) Search unread...                  ]  | 44pt
+---------------------------------------------+
|  * Notes  claude                  Waiting   | ligne palette, badge status.awaiting
|    Je vais modifier notes/2026-09.md, tu... | résumé (turn_end.summary)
|  * Link  cc                    Done 3 min   |
|    Trois options, une reco. J'ai écrit...   |
|  * Admin  claude               Done 12 min  |
|    Le mail est prêt dans le brouillon...    |
|                                             |
|                                             |
|                                             |
+---------------------------------------------+
|  [ >> Start review                       ]  | 60pt primaire, zone du pouce
+---------------------------------------------+
|                                        34pt |
+---------------------------------------------+
```

| | |
|---|---|
| **Geste d'entrée** | Bouton `Unread (3)` dans la barre basse de Sessions ; appui long sur le bouton `Next unread` de l'option A (section 6.3) |
| **Geste « suivant »** | La palette ne chaîne pas elle même : un tap sur une ligne ouvre ce pane ; `Start review` ouvre le premier de l'anneau et le chaînage repose sur l'option A |
| **Ce qui compte comme lu** | Identique à A. La palette ne marque rien : lire un résumé de 140 caractères n'est pas lire |
| **Sortie** | Balayage vers le bas ou `Close`, comme `/panes` |

**Forces.** Vue d'ensemble avant de partir : Robin voit en une seconde ce qui attend et ce
qui a fini, avec le résumé du dernier message, et peut aller droit à celui qui l'inquiète.
Composant existant, coût minimal. C'est le seul des trois parcours qui rend « voir son
état » sans ouvrir la session.

**Faiblesses.** Seule, elle ne fait pas le tour : sans A elle renvoie à la liste entre
chaque session, ce qui est exactement ce que Robin ne veut plus. Le résumé tronqué invite à
« lire » sans ouvrir, ce que P3 interdit de reconnaître comme lu ; il faut le dire dans le
design, pas le laisser deviner.

**Risque d'erreur.** Nul par elle même : on n'y répond pas. Le risque est celui de l'écran
qu'elle ouvre.

**Coût.** 140 à 180 lignes, en réutilisant `Palette`, `paneBadge`, `tabTint` et le module
`unread.ts` de l'option A.

---

## 4. Comparaison

| | A `Next unread` | B `Review` pager | C palette `Unread` |
|---|---|---|---|
| Fidélité à Cmd+J | exacte | interprétation | c'est Cmd+Shift+J |
| Une main, en marchant | oui, un tap dans la zone du pouce | balayage, `Close` en haut | oui |
| Risque de répondre au mauvais pane | faible, saut explicite et bouton masqué clavier ouvert | **élevé**, balayage involontaire | nul |
| Démarre depuis une notification | oui | non | non |
| Voir l'état sans ouvrir | non | partiellement | oui |
| Compatible avec une session attachée à la fois | oui | non | oui |
| Coût | 350 à 420 l. | 700 à 900 l. | 140 à 180 l. |

---

## 5. Recommandation

**L'option A, `Next unread`, en lot unique**, avec C comme suite naturelle à coût marginal.

1. C'est Cmd+J tel que Kova le définit, un saut explicite vers le prochain non lu avec le
   repli sur une session inactive, donc le même modèle mental sur les deux appareils.
2. Elle rend le tour possible depuis là où Robin arrive vraiment, la notification, sans mode
   à ouvrir ni à fermer, et sans repasser par la liste.
3. C'est la seule option où l'on ne peut ni sauter en écrivant ni écrire en sautant : le
   pire cas, répondre au mauvais pane, est structurellement empêché, pas seulement signalé.
4. Elle ne touche ni au fil, ni au composer, ni à la barre de validation, ni au modèle
   « une session attachée » ; tout ce qui a été durci en passes 2 et 3 reste intact.
5. Elle coûte un module pur testable, un petit store, un composant et trois branchements ;
   la palette C se greffe ensuite sur le même module en un après midi.

---

## 6. Spécification de l'option A, implémentable

### 6.1 Composant `NextPill`

Fichier attendu : `app/src/features/sessions/NextPill.tsx`.

| Propriété | Valeur |
|---|---|
| Position | flottant, ancré en bas à droite de la zone de contenu, 16 pt du bord droit, **12 pt au dessus du composer** (ou de la barre de validation quand elle est montée). Dans les 220 pt du pouce (P1) |
| Taille | hauteur 44 pt, largeur au contenu, minimum 140 pt, `radius.full` |
| Fond et contour | `bg.overlay`, contour 1 pt `border.strong`, `shadow.bar` |
| Contenu, état `next` | icône `skip-forward` 16 pt `accent.primary`, libellé `Next unread` en calloutStrong `text.primary`, badge numérique en caption sur pastille `accent.primary` / `text.onFill`, 20 pt de haut |
| Contenu, état `caughtUp` | icône `check-circle` 16 pt `status.success`, libellé `All caught up` en calloutStrong `status.success`, sans badge |
| Contenu, état `idle` | icône `skip-forward` 16 pt `text.secondary`, libellé `Next idle` en calloutStrong `text.secondary`, badge en `bg.pressed` / `text.secondary` |
| Pressé | fond `bg.pressed`, `spring.press` sur l'échelle (1,00 vers 0,97) |
| Accessibilité | `accessibilityRole="button"`, label `Next unread session, 3 left`, hint `Opens Notes, claude` (la destination, calculée au rendu) |

Relation avec le bouton « retour en bas » du design 4.2 (44 pt, chevron bas, même coin) :
quand les deux sont visibles, le bouton de retour en bas se place **au dessus** du
`NextPill`, séparé de 8 pt. Le saut est l'action la plus fréquente, il garde la place la
plus basse.

### 6.2 États du bouton et transitions

```
                     otherUnread > 0
   hidden  ───────────────────────────────►  next (badge = otherUnread)
     ▲                                          │
     │ otherUnread = 0 et idleOthers = 0        │ otherUnread tombe à 0
     │ (après le flash)                         │ pendant que l'écran est ouvert
     │                                          ▼
     │                                     caughtUp (1 600 ms, notify Success)
     │                                          │
     └──────────────── idleOthers = 0 ◄─────────┤
                                                │ idleOthers > 0
                                                ▼
                                          idle (badge = idleOthers)
```

- `otherUnread` : non lus **hors pane courant** (section 0.2). Le pane courant est en cours
  de lecture, il n'est jamais compté.
- `idleOthers` : sessions Claude inactives hors pane courant (section 0.3).
- À l'ouverture d'un écran où `otherUnread = 0` dès le départ, aucun flash `caughtUp` :
  le bouton est en `idle` ou `hidden` d'emblée. Le flash ne salue qu'une fin de tour vécue.
- **Masqué quoi qu'il en soit** quand : le clavier est ouvert ; le brouillon de ce pane est
  non vide ; la barre de validation est en `authenticating` ou `sending` ; le pane est
  fermé (`session.status === 'closed'`) ; le sélecteur de pièces jointes est ouvert. Le
  masquage est un fondu `motion.fast`, jamais un décalage de mise en page.
- Le badge change en direct (un pane finit son tour pendant la lecture) avec un fondu
  croisé de 160 ms sur le chiffre. Jamais d'animation d'attention : le bouton ne pulse pas.

### 6.3 Le tap

1. Recalcul de l'anneau à l'instant du tap (section 0.3), à partir du pane courant. Cible :
   premier élément. Si l'anneau est vide (le pane cible a fermé entre le rendu et le tap) :
   toast `Nothing left to read` et le bouton se remet à jour.
2. Haptique `impactAsync(Light)`.
3. `router.replace(paneHref(target) + '?focus=last')`. **Replace, jamais push** : règle des
   liens profonds (design 3.3), Robin ne doit pas empiler cinq écrans de session pendant un
   tour. Pour un pane `awaiting`, `?focus=awaiting`. Un pane sans agent s'ouvre sur `Term`
   (`paneHref` le fait déjà).
4. Animation `slide_from_right` en `motion.base` ; fondu si `prefers-reduced-motion`.
5. Sur l'écran d'arrivée, **garde de saisie de 400 ms** : le bouton d'envoi du composer et
   les options de la barre de validation ignorent les taps (la barre a déjà sa fenêtre
   d'armement, 4.3.4 ; le composer en gagne une, alignée). Le champ, lui, reste tappable :
   ouvrir le clavier n'envoie rien.
6. Le bandeau d'identité (28 pt) reçoit un fond `accent.subtleBg` qui s'éteint en 320 ms.
   C'est le seul signal visuel d'arrivée, et il est sur la ligne qui dit **où** on est.

Appui long sur le bouton (500 ms, haptique `Medium`) : ouvre la palette `Unread` de
l'option C quand elle existera. En lot A seul, l'appui long ne fait rien.

### 6.4 Ce qui marque un pane comme lu, et quand

Store attendu : `app/src/store/reads.ts`, `readMark: Record<number, string>` (paneId vers
`promptRef`), persisté dans `kv` sous `reads.byPane`, hydraté au démarrage avec les autres
stores.

| Déclencheur | Marquage |
|---|---|
| L'écran de session du pane est au premier plan (`setVisiblePane(paneId)` posé), l'app est active, et **quelque chose est affiché** : `session.status === 'ready'` (Mac ou cache), ou vue `Term` avec un écran reçu. Compteur de **1 200 ms** continu | `readMark[paneId] = prompt.promptRef` |
| Robin agit sur le pane : `onSend` accepté (parti ou mis en file), `onAnswer` en phase `sending`, `interrupt` | immédiat, même sans attendre les 1 200 ms |
| Un nouveau `promptRef` arrive sur le pane affiché | le compteur repart pour la nouvelle référence. Robin regarde, le daemon supprime déjà le push (`isWatching`), et 1 200 ms plus tard c'est lu |
| Le compteur est interrompu (retour à la liste, app en arrière plan, saut) avant 1 200 ms | rien. Le pane reste non lu, il reviendra dans l'anneau |
| `pane-close` | `readMark[paneId]` purgé. Idem pour tout pane absent d'un `panes.snapshot` |

Pourquoi 1 200 ms et pas zéro : ouvrir par erreur, ou traverser une session en sautant deux
fois vite, ne doit pas la sortir de l'anneau. Pourquoi pas plus : au delà, Robin qui lit vite
verrait le badge ne pas baisser et douterait du compteur.

Pourquoi le transcript en cache suffit : la marque est la référence de l'événement, pas une
date. Si un tour plus récent s'est terminé pendant la coupure, il porte une autre référence
et le pane redevient non lu à la reconnexion. Rien n'est jamais tenu pour lu qui n'a pas été
affiché.

**Remontée vers le daemon.** Aucun message nouveau en lot A. Deux canaux existants portent
déjà l'information :

- `ping.foregroundPaneId` (à chaque ping, et hors cycle au changement d'écran) : le daemon
  sait quel pane est lu et supprime les pushs correspondants (A1, CA-31).
- `focus-pane` à l'ouverture via `Follow on Mac` : Kova bascule sur le pane, ce qui de son
  côté vaut lecture (`awaiting_seen`, et la sortie de son propre anneau Cmd+J). Réglage
  coupé, le Mac ne voit rien, et c'est cohérent : Cmd+J sur le Mac y retrouvera le pane.
  **À vérifier sur la machine** : que `focus-pane` par IPC pose bien `awaiting_seen`, comme
  un focus au clavier. Si ce n'est pas le cas, on l'accepte tel quel : le seul effet est que
  le Mac propose de relire ce que le téléphone a lu, jamais l'inverse.

Un message `pane.read {paneId, promptRef}` reste possible en lot ultérieur, pour un badge
d'icône d'app tenu par le daemon. Il n'est pas nécessaire au tour.

### 6.5 Le daemon : rejouer l'état lisible

Sans cela le tour ne marche pas au premier lancement (section 0.1).

- Le daemon garde, par pane, le **dernier `Prompt` non `none`** émis (`turn_end`, `parsed`
  ou `unparsable`), et l'oublie sur `none`, sur `pane-close`, et quand le pane repasse en
  `working` (le tour suivant a commencé, l'ancienne fin de tour n'est plus l'état lisible).
- Après chaque `panes.snapshot` envoyé à un client (abonnement initial, reprise sans etag,
  `pushPanesSnapshot`), le daemon envoie un message `prompt` par pane qui en porte un.
  Message existant, aucun changement de protocole. Ordre : d'abord le snapshot, puis les
  prompts, pour que `usePrompts.setPrompt` trouve le pane.
- Les `promptRef` rejoués sont ceux d'origine (le registre `PromptRefs` les garde 10 min,
  `PROMPT_REF_TTL_MS`) : au delà, la référence ne résout plus pour les actions rapides, mais
  elle reste une **clé de lecture** valable, c'est tout ce que l'anneau lui demande.
- Côté app, `usePrompts.byPane` est en outre mis en cache dans `kv` (comme les panes) pour
  que la liste hors ligne montre les non lus du dernier état connu. Rien n'est marqué lu
  depuis ce cache sans affichage (6.4).

Estimation : 40 lignes daemon (`main.ts` ou `turnEnd.ts`, plus `hub.ts`), 15 lignes app.

### 6.6 Repli « rien de non lu » (le Cmd+J vide de Kova)

- Sur l'écran de session : `caughtUp` 1 600 ms avec haptique `notificationAsync(Success)`,
  puis `Next idle (2)` si des sessions Claude inactives existent, sinon le bouton disparaît.
  Tap sur `Next idle` : même mécanique que 6.3, sans marquage particulier (un pane inactif
  n'a rien à marquer).
- Sur l'écran Sessions : le troisième bouton de la barre basse passe de `Next unread (3)`
  (primaire) à `Next idle` (secondaire) puis, sans session inactive, à `Caught up` désactivé
  avec `check-circle`. La barre garde ses trois boutons en permanence : la position d'un
  bouton ne change pas selon l'état (P3, par extension).
- La ligne de résumé en tête de liste devient `3 unread · 1 waiting · 2 working` ; quand
  tout est lu, elle disparaît comme aujourd'hui.

### 6.7 Intégration avec le composer et la barre de validation

| Situation | Comportement |
|---|---|
| Robin tape dans le composer | clavier ouvert, bouton masqué. Il envoie ou vide le champ, le bouton revient. Un brouillon laissé en place masque le bouton tant que ce pane est affiché : un texte non envoyé est un texte pour **ce** pane, on ne l'emporte pas ailleurs (les brouillons sont par pane, `useDrafts`, mais le signal visuel compte) |
| Après un envoi | **aucun avancement automatique**. La bulle optimiste et sa coche se lisent, puis Robin tape `Next unread` lui même. Un saut automatique après envoi ferait exactement la confusion de panes que ce document cherche à rendre impossible |
| Barre de validation armée (question ouverte) | bouton visible, au dessus de la barre. Robin peut différer la question : le pane sera marqué lu par le compteur, il sort de l'anneau, mais reste `Waiting` dans la liste, dans la ligne de résumé et dans la bannière CA-70 des autres sessions. Différer est un choix, pas un oubli |
| Barre en `authenticating` ou `sending` | bouton masqué : on ne quitte pas un envoi en cours |
| Placeholder du composer | devient `Message Link · cc…` : le nom de l'onglet et le titre du pane, toujours, tour ou pas. Une ligne d'`i18n`, et le champ dit à qui l'on écrit au moment où l'on regarde le champ |
| Garde de 400 ms à l'arrivée (6.3) | le composer expose une prop `inputGuardUntil` ; la barre de validation garde sa fenêtre d'armement existante |
| Bannière CA-70 « another session is waiting » | inchangée. Elle et le bouton disent la même chose sous deux formes : la bannière nomme, le bouton emmène |

### 6.8 Écran Sessions

- **Barre basse** : `[ Panes ] [ Projects ] [ Next unread (3) ]`, trois boutons de 60 pt,
  icônes `grid`, `folder`, `skip-forward`. Le troisième est primaire quand `unread > 0`,
  secondaire `Next idle` sinon, désactivé `Caught up` en dernier recours. Sur un iPhone 13
  mini (375 pt), trois boutons de 109 pt avec icône 16 pt et libellé calloutStrong tiennent
  sans troncature ; `Next unread` est le libellé le plus long, mesuré à 96 pt.
- **Ligne de pane non lue** : le badge d'état (`Done 3 min`) passe sur fond `accent.subtleBg`
  avec texte `accent.primary`, précédé d'un point plein de 6 pt de la même couleur. Lu : le
  badge d'aujourd'hui. Forme et position, pas seulement la couleur (P4).
- **Ligne de résumé** : `3 unread · 1 waiting · 2 working`, dans `summaryLine`.
- **Palette `/panes`** : même badge non lu sur les lignes, pour que Cmd+P montre ce que
  Cmd+J va parcourir.

### 6.9 Découpage et coût

| Fichier | Contenu | Lignes |
|---|---|---|
| `app/src/features/sessions/unread.ts` | pur, testé sous Node : `isUnread(pane, prompt, readMark)`, `unreadRing(entries, prompts, readMark, currentId)`, `idleRing(...)`, `nextTarget(...)` | 90 |
| `app/test/unread.test.ts` | ordre à travers fenêtres, bouclage, pane courant exclu, `awaiting` d'abord, pane fermé, repli inactif | 80 |
| `app/src/store/reads.ts` | `readMark`, `markRead`, `forget`, hydratation `kv`, purge sur snapshot | 50 |
| `app/src/features/sessions/NextPill.tsx` | les trois états, badge, a11y, masquage | 90 |
| `app/app/session/[paneId].tsx` | compteur de lecture (un `useEffect` sur `paneId`, `promptRef`, `session.status`, `appActive`), marquage sur action, montage du bouton, garde de 400 ms, flash d'identité | 60 |
| `app/app/index.tsx`, `SessionRow.tsx`, `tabGroups.ts` | troisième bouton, badge non lu, ligne de résumé | 40 |
| `app/src/i18n/en.ts` | `nextUnread`, `nextIdle`, `allCaughtUp`, `caughtUp`, `nothingLeftToRead`, `nextPillA11y`, `nextPillHint`, `composerPlaceholderFor`, `summaryUnread` | 12 |
| daemon (6.5) | dernier prompt par pane, rejeu après snapshot | 40 |
| app (6.5) | cache `kv` des prompts | 15 |
| **Total** | | **environ 480**, dont 80 de tests |

Ordre d'implémentation : 6.5 d'abord (sans le rejeu, rien n'est mesurable), puis `unread.ts`
avec ses tests, puis le store, puis le bouton dans l'écran de session, puis la liste.

### 6.10 Cas limites

| Cas | Comportement |
|---|---|
| Le pane cible ferme entre le rendu et le tap | recalcul au tap, cible suivante ; anneau vide : toast `Nothing left to read` |
| Mac injoignable ou hors ligne | le bouton fonctionne depuis le cache (la navigation est locale). Le composer met en file, `Interrupt` est désactivé, la barre de validation est masquée (P5). Les marques posées hors ligne sont valables : elles ne visent que ce qui a été affiché |
| Kova quitté (`kova: down`) | liste vide, bouton `Caught up` désactivé, aucune session à parcourir |
| Fin de tour sur un autre pane pendant la lecture | badge mis à jour, aucun saut, aucune bannière de plus (la bannière CA-70 reste réservée à `awaiting`) |
| Un pane non Claude passe `awaiting` (Kova le lève pour un autre agent) | dans l'anneau, ouvert en vue `Term`, marqué lu par le compteur une fois l'écran reçu |
| Redémarrage de Kova, identifiants de pane réutilisés | aucune fausse lecture : la marque compare un `promptRef` aléatoire, jamais un identifiant de pane seul. Les marques orphelines sont purgées au premier snapshot |
| Deux fins de tour du même pane en 1 200 ms | seule la dernière référence compte ; le compteur repart, le pane est lu 1 200 ms après la seconde |
| VoiceOver | le bouton est le dernier élément avant le composer dans l'ordre de lecture ; label et hint nomment la destination |
| `prefers-reduced-motion` | glissement remplacé par un fondu, flash d'identité remplacé par un fond statique de 320 ms |

### 6.11 Libellés (anglais, définitifs)

| Clé | Texte |
|---|---|
| `nextUnread` | `Next unread` |
| `nextIdle` | `Next idle` |
| `allCaughtUp` | `All caught up` |
| `caughtUp` | `Caught up` |
| `nothingLeftToRead` | `Nothing left to read` |
| `nextPillA11y(n)` | `Next unread session, 3 left` |
| `nextPillHint(tab, title)` | `Opens Notes, claude` |
| `composerPlaceholderFor(tab, title)` | `Message Link · cc…` |
| `summaryUnread(n)` | `3 unread` |
| `panesUnreadTitle` (option C, plus tard) | `Unread` |
| `startReview` (option C, plus tard) | `Start review` |

Icônes Feather utilisées : `skip-forward`, `check-circle`, `grid`, `folder`, `x`. Aucune
autre.

---

## 7. Conformité aux principes

| Principe | Où |
|---|---|
| P1 pouce en bas | bouton flottant dans les 220 pt, troisième bouton de la barre basse à 60 pt, rien en haut d'écran à atteindre |
| P2 la question gagne | `awaiting` en tête de l'anneau ; le bouton passe au dessus de la barre de validation, jamais à sa place |
| P3 on ne répond pas sans lire | le pane courant n'est jamais compté, rien n'est lu sans affichage, aucun avancement automatique après envoi, bouton masqué clavier ouvert |
| P4 lisible en marchant | badge non lu par forme et position, libellé jamais abrégé, calloutStrong |
| P5 réseau visible, jamais bloquant | le tour marche depuis le cache, aucune modale |
| A7 aucune approbation hors session | inchangé : le bouton ouvre, il ne répond jamais |
| 3.3 replace, jamais push | chaque saut remplace l'écran de session |
