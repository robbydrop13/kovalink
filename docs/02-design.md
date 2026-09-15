# KovaLink : spécification de design (UI/UX)

> Auteur : Senior Product Designer, équipe KovaLink. **Passe 3**, après revue du panel.
> Sources de vérité, dans cet ordre : `08-corrections-passe2.md` (ordre de correction en
> vigueur), `07-corrections.md`, `05-arbitrages.md` (A1 à A16, force de loi), `01-prd.md`,
> `00-context.md`.
> Cible : iOS 17+, Expo / React Native, utilisateur unique, TestFlight interne.
> Gabarit de référence : iPhone 15 Pro, 393 x 852 pt, safe area haute 59 pt, basse 34 pt.
> Vérifié jusqu'à iPhone 13 mini (375 x 812) et iPhone 17 Pro Max (440 x 956).

## Changement de prémisse : ce que Robin fait vraiment (C36)

Le relecteur technique a établi que **toutes les sessions de Robin tournent en
`bypassPermissions` ou `auto`**. Les prompts de permission sont donc rares, voire absents.
Robin a confirmé et tranché : le lot 1 change de cible.

**Le lot 1 n'est plus "le déblocage", c'est "l'agent a fini, je donne la suite".**

| Ce qui reste identique | Ce qui change |
|---|---|
| Le déclencheur : `pane-status.awaiting`, qui se lève aussi bien quand l'agent demande une permission que quand il a fini et attend l'instruction suivante | Le rendu à l'ouverture : ce que Robin voit en arrivant n'est plus une question à approuver, c'est **le dernier échange**, qu'il lit avant de dicter la suite |
| Toute la chaîne de notification, de bout en bout | Le **rendu du transcript remonte du lot 2 au lot 1** et devient l'écran central du produit (section 4.2) |
| La barre de validation (section 4.3), conservée telle quelle | Elle n'est plus la justification du lot. Elle sert quand un prompt survient malgré le mode bypass : mode plan, question explicite de l'agent |
| La bannière de l'écran verrouillé (section 4.4) | Elle porte désormais deux cas d'égale importance : "il attend ta validation" et "il a fini" |

Conséquence sur les priorités de ce document, dans l'ordre :
**1.** section 4.2, le rendu du dernier échange, c'est ce que Robin regarde vingt fois par jour.
**2.** section 4.5, le composer, c'est ce par quoi il répond.
**3.** section 4.4, la bannière, c'est ce qui le prévient.
**4.** section 4.3, la barre de validation, excellente et conservée, mais désormais un cas
particulier et non le coeur.

Conséquence sur le parseur de prompts (C37) : **aucun échantillon réel de prompt de permission
n'existe**, puisque Robin ne les déclenche pas. Ce document ne présente donc aucune grammaire de
parsing comme vérifiée, et l'état `unparsable` de la section 4.3.6 est le **comportement attendu
par défaut**, pas un cas d'erreur.

## Ce que ce document a corrigé en passe 3

| Réf | Correction |
|---|---|
| C26 (éliminatoire) | **Toute saisie de texte libre depuis une notification est supprimée.** `Répondre…` et `Continuer…` n'existent plus. Sections 4.4.5, 4.4.7 et 5.3. |
| C23 (éliminatoire) | Aucun retour chariot ne part sans vérification d'état : le texte libre est **refusé** tant qu'un prompt parsé est ouvert, et il exige Face ID quand le pane est en `awaiting` non parsé. Sections 4.3.3, 4.3.7, 4.5. |
| C20 (éliminatoire) | Le `promptHash` couvre la **charge décisionnelle complète**, détail compris. Section 4.3.1, avec la table de ce qui entre et de ce qui est exclu. |
| C21, C32 (éliminatoire) | `Interrompre` rétabli en lot 1, atteignable depuis la liste sur un pane `working` **et** sur un pane `awaiting`, depuis la session, et depuis la notification. Sections 4.1, 4.3.7, 5.3. |
| C25 | Catégories de notification **pré-enregistrées statiquement**, boutons portant les chiffres, la NSE réécrit le corps. L'hypothèse de ré-enregistrement dynamique est abandonnée. Section 4.4.3. |
| C30 | Règle de troncature normative des actions de bannière, avec l'arithmétique du budget. `Refuser` et `Interrompre` ne sont jamais retirés. Section 4.4.3. |
| C31 | `Muter` supprimé, du balayage comme du menu contextuel. Sections 4.1, 4.10, 5.4. |
| C28 | Réglage `Extraits dans les notifications` supprimé. **4 réglages**, plus le bloc `Activité`. Section 4.10. |
| C35 | Budget de rejeu du `.raw` unifié à **2 Mo**. Section 4.6. |
| C22 | `queue-operation` ignoré, jamais rendu. Section 4.2. |
| C36, C37 | Nouveaux lots, nouvelle hiérarchie de priorités, parseur sans échantillon. Sections 4.2, 4.3.6, 8. |

## Ce que ce document avait corrigé en passe 2

| Réf | Correction |
|---|---|
| C4 | Nouvelle section 4.4 : bannière de l'écran verrouillé et Notification Service Extension, avec ses trois états. C'est désormais l'écran le plus important du document. |
| C1 | Section 4.3 : le badge de chiffre affiché **est** ce qui part. Un seul `send-keys` atomique `"{chiffre}\r"`. La position du curseur du Mac n'entre jamais en compte. |
| C3 | Section 4.3.6 : l'état `unparsable` est promu état de premier ordre, spécifié de bout en bout. |
| A7 | Section 4.1 : les boutons `Oui` / `Non` en ligne sont supprimés. `Ouvrir` proéminent, `Interrompre` secondaire. |
| A2, A10 | Face ID sur `Approuver` uniquement. Aucun sur `Refuser`, `Interrompre`, `Ouvrir`. Un seul énoncé dans tout le document. |
| A11 | Plus aucune bascule LAN vers Tailscale. Indicateur `Direct` / `Relayé`. |
| A4 | Aucun plafond de fichier. Avertissement au delà de 100 Mo en cellulaire. |
| A9 | Mode clair spécifié, non câblé en v1. |
| PRD C7 | Suppression, renommage, duplication, création de dossier et collage retirés du bloc Fichiers. |
| C17 | Réglages ramenés à 5 entrées, puis à 4 en passe 3 (C28). Les écrans correspondants sont retirés. |
| C15, C16 | Chaque écran porte son lot (1, 2 ou 3). Rien n'est supprimé, tout est ordonné. |
| B13 | La section 9 qui rouvrait des arbitrages est remplacée par une table de conformité A1 à A16. |

Note sur la palette : `~/.config/kova/config.toml` n'existe pas sur la machine de Robin, Kova
tourne sur ses couleurs par défaut. La cohérence visuelle est assurée autrement, et de façon
plus robuste : KovaLink reprend (a) l'indexation des couleurs d'onglets de Kova
(`set-tab-color`, 0 à 5) comme jeu d'identification de projet, et (b) une palette de terminal
sombre à faible chroma qui prolonge l'esthétique Kova.

---

## 1. Principes de design

Cinq principes. Chacun sert à trancher un arbitrage réel, et chacun a un contraire défendable.

### P1. Le pouce commande, tout seul, en bas
Toute action exécutée plus d'une fois par jour doit être atteignable par le pouce dans les
**220 pt inférieurs** de l'écran, sans changer de main.
**Ce que ça tranche :**
- Pas de barre d'onglets en racine. Les 88 pt du bas sont réservés à la barre de validation et
  au composer. Une tab bar les squatterait en permanence pour une navigation utilisée trois
  fois par jour.
- Les bascules Chat / Terminal / Fichiers vivent dans la nav bar **et** en balayage horizontal,
  parce que ce sont des actions rares et délibérées.
- Toute cible primaire fait **60 pt** de haut, jamais 44.
- Pas de réglage qui miroite la position des boutons : l'utilisateur est unique et sa main est
  connue. Un réglage capable d'inverser approuver et refuser est un générateur d'accident.

### P2. La question de l'agent gagne toujours
Quand un pane passe en `awaiting`, la question et ses réponses deviennent l'élément le plus
proéminent de l'écran, immédiatement, en écrasant tout le reste.
**Ce que ça tranche :**
- La barre de validation est ancrée en bas, au dessus du composer, et **pousse** la liste au
  lieu de la recouvrir.
- L'autoscroll saute au bloc qui contient la question, pas au bas du transcript.
- Toute animation en cours (indicateur de frappe, spinner d'outil) est arrêtée à l'arrivée d'un
  `awaiting`, pas fondue : la vérité a changé.
- Sur l'écran Sessions, la section `EN ATTENTE` est toujours en haut.
- Une seconde question ne remplace jamais une barre de validation déjà montée pour un autre
  pane (section 6.1, cas D).

### P3. On ne répond jamais à une question qu'on n'a pas lue
C'est le principe qui a coûté le plus de fonctionnalités, et c'est le plus important.
**Ce que ça tranche :**
- Aucun bouton d'approbation sur l'écran Sessions (A7). Approuver exige d'ouvrir la session.
- Aucun bouton d'approbation sur l'écran verrouillé tant que la question n'est pas affichée
  dans la bannière (section 4.4, état 3).
- Aucun bouton deviné : si le parseur échoue, zéro option, repli terminal (A6.2, A8).
- Le libellé affiché, le chiffre du badge et l'octet envoyé sont **la même chose**, vérifiée par
  `promptHash` juste avant l'émission (A6.3).
- Approuver et refuser ont le même poids visuel : même hauteur, même remplissage, même
  contraste. Seule la teinte diffère, et la teinte ne décide jamais de la position.
- La position d'un bouton est dérivée de son `index`, jamais de son `kind`. Une erreur
  d'heuristique ne doit pas pouvoir peindre `Non` en vert là où le pouce va.

### P4. Lisible en marchant, à une seconde de regard
Texte de conversation à 17 pt minimum. Toute information d'état doit être décodable par la
**forme et la position**, pas seulement par la couleur.
**Ce que ça tranche :**
- Les états `working` / `awaiting` / `idle` ont chacun une glyphe distincte en plus d'une
  couleur (barre pleine animée, losange, cercle creux).
- Le code descend à 13 pt mono et pas plus bas ; s'il ne rentre pas, il défile horizontalement,
  il ne rétrécit pas.
- Jamais de texte porteur d'information sous 4,5:1, même un horodatage.
- Les diffs portent un préfixe caractère `+` / `-` **et** un liseré de gouttière.

### P5. Le réseau est visible, jamais bloquant
L'état de la liaison est affiché en permanence, ne bloque jamais l'interface, et distingue ce
que Robin peut corriger de ce qu'il ne peut pas.
**Ce que ça tranche :**
- Jamais de modale de connexion perdue. Une pastille, et c'est tout.
- Trois états distincts, pas un seul : `Direct` / `Relayé` (Tailscale, A11), `Hors ligne`
  (l'iPhone n'a pas de réseau, c'est actionnable), `Mac injoignable` (l'iPhone a du réseau, le
  Mac dort, ce n'est pas actionnable). Les confondre laisse Robin chercher une solution qui
  n'existe pas.
- Le transcript est mis en cache localement, l'écran Chat s'ouvre sur le cache puis se
  réconcilie.
- Un message envoyé hors ligne est mis en file, pas rejeté. Une **réponse de validation** hors
  ligne est refusée, jamais mise en file : répondre à une question qui a peut-être expiré est
  pire que ne pas répondre.

---

## 2. Design tokens

Fichier de référence attendu : `app/src/theme/tokens.ts`.

### 2.1 Couleurs, mode sombre (le seul câblé en v1, A9)

| Token | Hex | Usage |
|---|---|---|
| `bg.base` | `#0B0D10` | fond d'écran principal |
| `bg.raised` | `#14171C` | cartes, bulles assistant, lignes de liste |
| `bg.overlay` | `#1B1F26` | feuilles modales, blocs d'outil, menus |
| `bg.inset` | `#070809` | blocs de code, terminal, champs de saisie |
| `bg.pressed` | `#1F242B` | état pressé d'une surface |
| `bg.scrim` | `rgba(0,0,0,0.60)` | voile derrière une feuille modale |
| `border.subtle` | `#23272F` | séparateurs, contour de carte |
| `border.strong` | `#333944` | contour de bouton secondaire, champ actif |
| `border.focus` | `#4C8DFF` | anneau de focus clavier / VoiceOver |
| `text.primary` | `#E8EAED` | corps de message, titres (15,3:1) |
| `text.secondary` | `#9BA3AF` | métadonnées, sous-titres (7,6:1) |
| `text.tertiary` | `#7C8593` | horodatages, labels de section (5,2:1) |
| `text.disabled` | `#5A616D` | désactivé uniquement, jamais de texte utile |
| `text.inverse` | `#0B0D10` | texte sur remplissage clair |
| `text.onFill` | `#FFFFFF` | texte sur bouton plein |
| `accent.primary` | `#4C8DFF` | liens, sélection, focus, actions neutres |
| `accent.primaryPressed` | `#3A79E6` | |
| `accent.subtleBg` | `#12213A` | fond de pastille accent |

**États d'agent** :

| Token | Hex | Glyphe | Sens |
|---|---|---|---|
| `status.awaiting` | `#FFB020` | losange plein | l'agent attend Robin (10,6:1) |
| `status.awaitingBg` | `#2A1F08` | | fond de carte en attente |
| `status.working` | `#38BDF8` | barre pleine animée | l'agent travaille |
| `status.workingBg` | `#0A1F2B` | | |
| `status.idle` | `#7C8593` | cercle creux | pane inactif |
| `status.closed` | `#5A616D` | crochet fermant | session fermée, lecture seule |
| `status.error` | `#FF5C5C` | point d'exclamation | erreur daemon ou IPC |
| `status.success` | `#3DD68C` | coche | opération confirmée |

**Actions de validation** (contrastes calculés sur label blanc) :

| Token | Hex | Contraste |
|---|---|---|
| `action.approve.bg` | `#1C8052` | 4,93:1 avec `#FFFFFF` |
| `action.approve.bgPressed` | `#166843` | |
| `action.approve.text` | `#FFFFFF` | |
| `action.reject.bg` | `#B02A22` | 6,56:1 avec `#FFFFFF` |
| `action.reject.bgPressed` | `#8E211B` | |
| `action.reject.text` | `#FFFFFF` | |
| `action.always.border` | `#2E9E63` | option de portée durable, contour |
| `action.always.bg` | `#101C16` | |
| `action.always.text` | `#6FE0A6` | 9,1:1 |
| `action.neutral.bg` | `#2A2F38` | option dont le `kind` est inconnu |
| `action.neutral.text` | `#E8EAED` | 12,1:1 |
| `action.interrupt.border` | `#FF5C5C` | bouton Interrompre, contour seul |
| `action.interrupt.text` | `#FF7A7A` | 8,3:1 |

**Liaison** (A11 : plus aucun état LAN) :

| Token | Hex | État |
|---|---|---|
| `link.direct` | `#3DD68C` | Tailscale en pair à pair direct |
| `link.relayed` | `#4C8DFF` | Tailscale via relais DERP |
| `link.connecting` | `#FFB020` | connexion ou reconnexion en cours (pulse) |
| `link.macUnreachable` | `#FF9F45` | l'iPhone a du réseau, le Mac ne répond pas |
| `link.offline` | `#FF5C5C` | l'iPhone n'a aucun réseau |

**Diff** (lot 2) :

| Token | Hex |
|---|---|
| `diff.addBg` | `#10251A` |
| `diff.addText` | `#7EE2AC` |
| `diff.addGutter` | `#1C8052` |
| `diff.delBg` | `#2B1416` |
| `diff.delText` | `#FF9E96` |
| `diff.delGutter` | `#B02A22` |
| `diff.ctxText` | `#9BA3AF` |
| `diff.lineNo` | `#5A616D` |
| `diff.hunkBg` | `#101720` |
| `diff.hunkText` | `#7C8593` |

**Coloration syntaxique** (7 tokens, lot 2) :

| Token | Hex |
|---|---|
| `syn.keyword` | `#C792EA` |
| `syn.string` | `#9ECE6A` |
| `syn.number` | `#FF9E64` |
| `syn.comment` | `#6B7280` |
| `syn.function` | `#7AA2F7` |
| `syn.type` | `#2AC3DE` |
| `syn.punct` | `#9BA3AF` |

**Couleurs d'onglet Kova** (mapping strict sur `set-tab-color` 0 à 5) :

| Index | Nom | Sombre | Clair |
|---|---|---|---|
| 0 | rouge | `#FF6B6B` | `#C0281F` |
| 1 | orange | `#FF9F45` | `#B35309` |
| 2 | jaune | `#FFD84D` | `#8A6A00` |
| 3 | vert | `#4ADE80` | `#12703F` |
| 4 | bleu | `#60A5FA` | `#0A63D6` |
| 5 | violet | `#C084FC` | `#7C3AED` |
| null | aucune | `#7C8593` | `#6B7280` |

**Palette ANSI 16 pour xterm.js** (lot 2, mode sombre) :

```
background #070809   foreground #E8EAED   cursor #FFB020   selection #2B3A54
black   #14171C      brightBlack   #4A515C
red     #FF6B6B      brightRed     #FF9E96
green   #4ADE80      brightGreen   #7EE2AC
yellow  #FFD84D      brightYellow  #FFE08A
blue    #60A5FA      brightBlue    #93C0FF
magenta #C084FC      brightMagenta #DCB4FF
cyan    #38BDF8      brightCyan    #7DD8FB
white   #C6CBD3      brightWhite   #FFFFFF
```

### 2.2 Couleurs, mode clair

**Spécifié, non câblé en v1 (A9).** La couche de tokens existe dès le lot 1, seul le thème
clair n'est pas branché. Le brancher plus tard ne coûte que la sélection du jeu.

| Token | Hex |
|---|---|
| `bg.base` | `#FFFFFF` |
| `bg.raised` | `#F5F6F8` |
| `bg.overlay` | `#FFFFFF` |
| `bg.inset` | `#F0F2F5` |
| `bg.pressed` | `#E8EAEE` |
| `bg.scrim` | `rgba(16,24,40,0.40)` |
| `border.subtle` | `#E3E6EB` |
| `border.strong` | `#C9CFD8` |
| `border.focus` | `#0A63D6` |
| `text.primary` | `#14171C` |
| `text.secondary` | `#4A515C` |
| `text.tertiary` | `#646C78` |
| `text.disabled` | `#9AA1AC` |
| `text.inverse` | `#FFFFFF` |
| `text.onFill` | `#FFFFFF` |
| `accent.primary` | `#0A63D6` |
| `accent.primaryPressed` | `#0850AE` |
| `accent.subtleBg` | `#E8F0FE` |
| `status.awaiting` | `#A65B00` |
| `status.awaitingBg` | `#FFF6E6` |
| `status.working` | `#0A7EA4` |
| `status.workingBg` | `#E6F5FA` |
| `status.idle` | `#646C78` |
| `status.closed` | `#9AA1AC` |
| `status.error` | `#C0281F` |
| `status.success` | `#12703F` |
| `action.approve.bg` | `#12703F` |
| `action.approve.bgPressed` | `#0D5A32` |
| `action.reject.bg` | `#A82119` |
| `action.reject.bgPressed` | `#8A1A14` |
| `action.always.border` | `#12703F` |
| `action.always.bg` | `#EEF8F2` |
| `action.always.text` | `#0D5A32` |
| `action.neutral.bg` | `#EDEFF3` |
| `action.neutral.text` | `#14171C` |
| `action.interrupt.border` | `#C0281F` |
| `action.interrupt.text` | `#C0281F` |
| `link.direct` | `#12703F` |
| `link.relayed` | `#0A63D6` |
| `link.connecting` | `#A65B00` |
| `link.macUnreachable` | `#B35309` |
| `link.offline` | `#C0281F` |
| `diff.addBg` | `#E7F6ED` |
| `diff.addText` | `#0F5B34` |
| `diff.addGutter` | `#12703F` |
| `diff.delBg` | `#FCEBEA` |
| `diff.delText` | `#8C1A14` |
| `diff.delGutter` | `#A82119` |
| `diff.ctxText` | `#4A515C` |
| `diff.lineNo` | `#9AA1AC` |
| `diff.hunkBg` | `#F0F2F5` |
| `diff.hunkText` | `#646C78` |
| `syn.keyword` | `#8250DF` |
| `syn.string` | `#0A7A3C` |
| `syn.number` | `#B35309` |
| `syn.comment` | `#646C78` |
| `syn.function` | `#1F5FBF` |
| `syn.type` | `#0E7490` |
| `syn.punct` | `#4A515C` |

### 2.3 Typographie

Familles : `SF Pro` (système) pour l'UI, `SF Mono` pour tout le monospace.
Fallback mono : `Menlo`, `ui-monospace`.

| Token | Taille | Interligne | Graisse | Tracking | Usage |
|---|---|---|---|---|---|
| `display` | 28 | 34 | 700 | -0,4 | titre d'appairage, écran vide majeur |
| `title1` | 22 | 28 | 600 | -0,3 | grand titre de nav (Sessions) |
| `title2` | 17 | 22 | 600 | -0,2 | nav bar compacte, en-tête de carte |
| `body` | 17 | 24 | 400 | 0 | **corps de message, plancher absolu** |
| `bodyStrong` | 17 | 24 | 600 | 0 | label de bouton de validation, question |
| `callout` | 15 | 20 | 400 | 0 | détail de question, sous-titre de ligne |
| `calloutStrong` | 15 | 20 | 600 | 0 | nom de fichier, nom d'outil |
| `footnote` | 13 | 18 | 400 | 0 | horodatage, chemin, aide contextuelle |
| `caption` | 11 | 14 | 500 | +0,2 | badges, pastilles d'état, numéro d'option |
| `mono.code` | 13 | 20 | 400 | 0 | blocs de code |
| `mono.codeInline` | 15 | 20 | 400 | 0 | code en ligne dans un corps à 17 pt |
| `mono.diff` | 12 | 18 | 400 | 0 | diffs (densité prioritaire) |
| `mono.terminal` | 12 | 16 | 400 | 0 | xterm.js et repli monospace |
| `mono.path` | 13 | 18 | 400 | 0 | fil d'Ariane, chemins de fichiers |

Dynamic Type : section 7.3. Les tokens `mono.*` sont exclus de la mise à l'échelle automatique
et fixés en dur (C17 : plus de réglage de taille de police).

### 2.4 Espacements (base 4 pt)

| Token | pt |
|---|---|
| `space.0` | 0 |
| `space.1` | 2 |
| `space.2` | 4 |
| `space.3` | 8 |
| `space.4` | 12 |
| `space.5` | 16 |
| `space.6` | 20 |
| `space.7` | 24 |
| `space.8` | 32 |
| `space.9` | 40 |
| `space.10` | 48 |
| `space.11` | 64 |

Constantes de gabarit :

| Constante | pt |
|---|---|
| `layout.screenPaddingH` | 16 |
| `layout.navBarHeight` | 44 |
| `layout.rowMinHeight` | 64 |
| `layout.touchMin` | 44 |
| `layout.touchPrimary` | 60 |
| `layout.composerMinHeight` | 52 |
| `layout.composerMaxHeight` | 148 (environ 6 lignes) |
| `layout.validationBarMaxHeight` | 268 |
| `layout.bubbleMaxWidth` | 82 % de la largeur d'écran |
| `layout.thumbZone` | 220 pt depuis le bas |

### 2.5 Rayons

| Token | pt | Usage |
|---|---|---|
| `radius.xs` | 4 | badge de numéro d'option |
| `radius.sm` | 6 | pastille, chip de touche spéciale |
| `radius.md` | 10 | bouton, champ de saisie, bloc de code |
| `radius.lg` | 14 | bulle de message, carte de session, bloc d'outil |
| `radius.xl` | 20 | feuille modale (coins hauts uniquement) |
| `radius.full` | 999 | pastille d'état, bouton rond |

### 2.6 Ombres et élévation

En mode sombre l'élévation passe d'abord par le fond et le contour.

| Token | Valeur |
|---|---|
| `shadow.none` | aucune |
| `shadow.bar` | `0 -8 24 rgba(0,0,0,0.45)` (barre de validation, composer) |
| `shadow.sheet` | `0 -2 32 rgba(0,0,0,0.60)` |
| `shadow.pressedInset` | `inset 0 1 0 rgba(255,255,255,0.06)` |
| `shadow.cardLight` | `0 1 3 rgba(16,24,40,0.08)` (mode clair uniquement) |
| `shadow.floatLight` | `0 8 24 rgba(16,24,40,0.12)` (mode clair uniquement) |

### 2.7 Animation

| Token | ms | Courbe |
|---|---|---|
| `motion.instant` | 100 | `linear` |
| `motion.fast` | 160 | `cubic-bezier(0.2, 0, 0, 1)` |
| `motion.base` | 220 | `cubic-bezier(0.2, 0, 0, 1)` |
| `motion.slow` | 320 | `cubic-bezier(0.2, 0, 0, 1)` |
| `motion.enter` | 220 | `cubic-bezier(0, 0, 0, 1)` |
| `motion.exit` | 160 | `cubic-bezier(0.4, 0, 1, 1)` |
| `motion.pulse` | 1400 | boucle `ease-in-out`, opacité 1 vers 0,45 |
| `motion.spinner` | 900 | rotation linéaire continue |

Ressorts (Reanimated) :

| Token | Paramètres |
|---|---|
| `spring.bar` | `damping: 22, stiffness: 260, mass: 1` |
| `spring.press` | `damping: 18, stiffness: 400, mass: 0.6` |
| `spring.sheet` | `damping: 26, stiffness: 220, mass: 1` |

`prefers-reduced-motion` actif : toutes les durées tombent à `motion.instant`, les pulses
deviennent des changements d'opacité statiques, les ressorts deviennent des fondus.

### 2.8 Bloc TypeScript prêt à copier

```ts
// app/src/theme/tokens.ts
export const dark = {
  bg:     { base:'#0B0D10', raised:'#14171C', overlay:'#1B1F26', inset:'#070809',
            pressed:'#1F242B', scrim:'rgba(0,0,0,0.60)' },
  border: { subtle:'#23272F', strong:'#333944', focus:'#4C8DFF' },
  text:   { primary:'#E8EAED', secondary:'#9BA3AF', tertiary:'#7C8593',
            disabled:'#5A616D', inverse:'#0B0D10', onFill:'#FFFFFF' },
  accent: { primary:'#4C8DFF', primaryPressed:'#3A79E6', subtleBg:'#12213A' },
  status: { awaiting:'#FFB020', awaitingBg:'#2A1F08', working:'#38BDF8',
            workingBg:'#0A1F2B', idle:'#7C8593', closed:'#5A616D',
            error:'#FF5C5C', success:'#3DD68C' },
  action: {
    approve:   { bg:'#1C8052', bgPressed:'#166843', text:'#FFFFFF' },
    reject:    { bg:'#B02A22', bgPressed:'#8E211B', text:'#FFFFFF' },
    always:    { border:'#2E9E63', bg:'#101C16', text:'#6FE0A6' },
    neutral:   { bg:'#2A2F38', text:'#E8EAED' },
    interrupt: { border:'#FF5C5C', text:'#FF7A7A' },
  },
  link:   { direct:'#3DD68C', relayed:'#4C8DFF', connecting:'#FFB020',
            macUnreachable:'#FF9F45', offline:'#FF5C5C' },
  diff:   { addBg:'#10251A', addText:'#7EE2AC', addGutter:'#1C8052',
            delBg:'#2B1416', delText:'#FF9E96', delGutter:'#B02A22',
            ctxText:'#9BA3AF', lineNo:'#5A616D', hunkBg:'#101720', hunkText:'#7C8593' },
  syn:    { keyword:'#C792EA', string:'#9ECE6A', number:'#FF9E64', comment:'#6B7280',
            function:'#7AA2F7', type:'#2AC3DE', punct:'#9BA3AF' },
  tab:    ['#FF6B6B','#FF9F45','#FFD84D','#4ADE80','#60A5FA','#C084FC'],
  tabNone:'#7C8593',
} as const;

export const space  = [0,2,4,8,12,16,20,24,32,40,48,64] as const;
export const radius = { xs:4, sm:6, md:10, lg:14, xl:20, full:999 } as const;
export const motion = { instant:100, fast:160, base:220, slow:320, enter:220,
                        exit:160, pulse:1400, spinner:900 } as const;
export const type = {
  display:      { size:28, line:34, weight:'700', tracking:-0.4 },
  title1:       { size:22, line:28, weight:'600', tracking:-0.3 },
  title2:       { size:17, line:22, weight:'600', tracking:-0.2 },
  body:         { size:17, line:24, weight:'400', tracking:0 },
  bodyStrong:   { size:17, line:24, weight:'600', tracking:0 },
  callout:      { size:15, line:20, weight:'400', tracking:0 },
  calloutStrong:{ size:15, line:20, weight:'600', tracking:0 },
  footnote:     { size:13, line:18, weight:'400', tracking:0 },
  caption:      { size:11, line:14, weight:'500', tracking:0.2 },
  monoCode:     { size:13, line:20, weight:'400', family:'SF Mono' },
  monoDiff:     { size:12, line:18, weight:'400', family:'SF Mono' },
  monoTerminal: { size:12, line:16, weight:'400', family:'SF Mono' },
  monoPath:     { size:13, line:18, weight:'400', family:'SF Mono' },
} as const;
```

---

## 3. Architecture de navigation

### 3.1 Structure

**Une pile unique, pas de barre d'onglets en racine.**

```
RootStack (expo-router)
├── (gate)            Appairage          plein écran si aucun jeton en Keychain   [lot 1]
├── /sessions         Sessions           racine de la pile                        [lot 1]
│   └── /session/[paneId]                écran de session, 3 vues internes
│         ├── chat     (défaut)          barre de validation, composer            [lot 1]
│         ├── term     repli monospace lot 1, xterm.js complet                    [lot 2]
│         └── files    racine = cwd du pane                                       [lot 3]
├── /session/closed/[sessionId]          session fermée en lecture seule          [lot 2]
├── /files            Fichiers globaux (racine = $HOME)                           [lot 3]
├── /settings         Réglages, 4 entrées, poussé en modal                        [lot 1]
└── /share            Cible de la Share Extension                                 [lot 3]
```

### 3.2 Justification

**Pourquoi pas de tab bar.** Une tab bar iOS mange 49 pt plus 34 pt de safe area, soit 83 pt du
bas de l'écran en permanence. Ces 83 pt sont exactement la zone de la barre de validation
(P1, P2). On ne sacrifie pas la zone du verbe dominant pour une navigation utilisée trois fois
par jour.

**Pourquoi Chat / Terminal / Fichiers sont internes à une session.** Le terminal est le repli du
chat d'un pane donné (décision 5 du contexte, et A5 pour les agents non-Claude). Les fichiers
ont presque toujours pour racine utile le `cwd` du pane. Le mode global (`/files`) existe pour le
cas "je cherche ailleurs sur le Mac".

**Comment on bascule entre les 3 vues.** Segmented control compact dans la nav bar, **plus** un
balayage horizontal sur la zone de contenu. Le balayage rend l'action atteignable au pouce, la
nav bar reste le repère visuel.

**Pourquoi Réglages n'est pas un onglet.** Cinq entrées, ouvertes quelques fois par mois. Un
bouton engrenage dans la nav bar de Sessions suffit.

**Pourquoi la session fermée est une route distincte.** Elle n'a ni composer, ni barre de
validation, ni pane. Lui donner la même route que `/session/[paneId]` obligerait à désactiver la
moitié de l'écran par condition, ce qui est exactement la façon dont on laisse passer un envoi
sur une session morte.

### 3.3 Deep links (le chemin critique)

| Source | Route | Comportement |
|---|---|---|
| Notification N1 (`KL_AWAITING`), bouton `Ouvrir` | `kovalink://session/{paneId}?focus=awaiting` | ouvre le Chat, scroll au bloc de la question, barre de validation montée puis armée |
| Notification N1, action `Approuver` | aucun écran | Face ID système, puis `answer` en tâche de fond (section 5) |
| Notification N1, actions `Refuser` / `Interrompre` | aucun écran | envoi en tâche de fond, sans authentification (A2) |
| Notification N2 (`KL_DONE`) | `kovalink://session/{paneId}?focus=last` | ouvre le Chat sur le dernier message assistant |
| Notification N3 (`KL_CLOSED`) | `kovalink://sessions` | liste |
| Notification agrégée | `kovalink://sessions?filter=awaiting` | liste filtrée |
| Share Extension | `kovalink://share` | l'extension seule, l'app hôte ne s'ouvre pas |

Règle : un deep link vers une session **remplace** la pile au lieu de l'empiler. Robin ne doit
jamais accumuler 12 écrans Chat après 12 notifications. `router.replace` systématique quand la
pile contient déjà un `/session/*`.

Widget et raccourci Siri sont hors périmètre v1 (`01-prd.md` section 6), ils ne figurent pas
dans cette table.

### 3.4 Gestes globaux

| Geste | Effet |
|---|---|
| Balayage depuis le bord gauche | retour (natif) |
| Balayage horizontal dans le contenu d'une session | Chat vers Terminal vers Fichiers |
| Tirer vers le bas (Sessions) | rafraîchissement forcé de `list-panes` |
| Appui long sur une ligne de session | menu contextuel à une entrée : `Ouvrir sur le Mac` |
| Appui long sur une bulle | menu (Copier, Copier en Markdown, Partager) |
| Secousse | rien (désactivé, faux positifs en marchant) |

Aucun geste de balayage n'exécute jamais une action destructive ou une approbation (P3).

---

## 4. Spécification écran par écran

Convention : `[ ]` bouton, `( )` pastille, `>` `v` chevrons, `·` séparateur.
Les mesures en pt indiquées à droite d'un wireframe sont normatives.
Chaque écran porte son **lot** (C15, C16).

---

### 4.1 Écran Sessions [lot 1]

Le tableau de bord. Il répond à une seule question : "qu'est-ce qui m'attend ?"

```
+---------------------------------------------+
|                                        59pt | safe area
+---------------------------------------------+
|  Sessions                 (Direct 12ms)  [*]| 44pt  nav bar
+---------------------------------------------+
|                                             |
|  EN ATTENTE · 1                             | 11pt caption, text.tertiary
| +-----------------------------------------+ |
| | ◆  link · cc                    2 min   | | liseré gauche 4pt
| |    Autoriser Edit sur 02-design.md ?    | | status.awaiting
| |    Modifie 42 lignes, supprime 3        | | fond awaitingBg
| |    +-----------------------------------+| |
| |    |            Ouvrir                 || | 60pt  primaire
| |    +-----------------------------------+| |
| |    Interrompre                          | | 32pt  secondaire
| +-----------------------------------------+ | 188pt
|                                             |
|  TRAVAILLE · 1                              |
| +-----------------------------------------+ |
| | #  Notes · claude              en cours | |
| |    Projet A                             | |
| |    Read ~/notes/todo.md                 | | dernière action, live
| |                          Interrompre    | | 32pt secondaire (S4)
| +-----------------------------------------+ | 120pt
|                                             |
|  INACTIF · 3                                |
| +-----------------------------------------+ |
| | o  automation-demo · n8n          3 h   | | 64pt
| | o  Admin · claude                 1 j   | | 64pt
| | o  web-app · codex                2 j   | | 64pt
| +-----------------------------------------+ |
|                                             |
|  > FERMEES · 62                             | 44pt  repliée par défaut
|                                             |
+---------------------------------------------+
|  [ Parcourir le Mac ]      [ Nouvelle ]     | 60pt  barre d'action
+---------------------------------------------+
|                                        34pt |
+---------------------------------------------+
```

#### Zones

| Zone | Contenu | Détail |
|---|---|---|
| Nav bar | Titre `Sessions` (title1 en grand titre, compacté en title2 au scroll), pastille de liaison, engrenage | La pastille est tappable, ouvre Réglages |
| Pastille de liaison | `(Direct 12 ms)` / `(Relayé 48 ms)` / `(Connexion…)` / `(Mac injoignable)` / `(Hors ligne)` | caption, fond `accent.subtleBg`, texte `link.*`, `radius.full`, hauteur 22 pt, cible étendue à 44 pt. **Aucun état LAN, A11** |
| Sections | `EN ATTENTE`, `TRAVAILLE`, `INACTIF`, `FERMÉES` | Ordre fixe. Une section vide est masquée, sauf si les quatre le sont |
| Carte en attente | losange, `projet · titre de pane`, âge de l'attente, question tronquée à 2 lignes, détail à 1 ligne, bouton `Ouvrir` 60 pt, lien `Interrompre` | Liseré gauche 4 pt `status.awaiting`, fond `status.awaitingBg`, `radius.lg`. **Aucun bouton d'approbation (A7, P3)** |
| Ligne travaille | barre pleine animée (pulse 1400 ms), `projet · titre`, dernière ligne d'activité (nom d'outil et argument tronqué), **lien `Interrompre` aligné à droite** | Mise à jour en direct via l'abonnement. `Interrompre` est présent ici parce que S4 (l'agent est parti de travers) décrit un pane `working: true`, pas un pane `awaiting` : le geste le plus urgent du produit ne doit pas demander d'ouvrir la session (C21, C32) |
| Ligne inactive | cercle creux, `projet · titre`, ancienneté | Densité maximale, 64 pt |
| Section `FERMÉES` | En-tête tappable `> FERMÉES · 62`, repliée par défaut. Dépliée : lignes de 60 pt tirées de `claude_history.json`, triées par `last_active` décroissant, titre de session et ancienneté, liste virtualisée | Repliée par défaut sinon 62 entrées noient les 5 sessions vives (`01-prd.md` S6, CA-20) [lot 2] |
| Point de couleur | Point de 8 pt à gauche du nom de projet, teinté par `tab[0..5]` | Absent si `color: null` |
| Barre d'action basse | `Parcourir le Mac` (vers `/files`, lot 3), `Nouvelle` (feuille de projets récents tirée de `recent_projects.json`, puis `new-tab`) | 60 pt, zone du pouce. Aucun `split` : exclu par `01-prd.md` section 6 |

#### Interactions

- Tap sur une carte ou une ligne : `router.push('/session/{paneId}')`, vue Chat.
- Tap sur `Ouvrir` : identique, en cible de 60 pt. C'est le seul chemin vers une approbation.
- Tap sur `Interrompre` : envoie le message dédié `pane.interrupt {paneId}` (C21), **sans
  confirmation et sans authentification** (A2, A7 : c'est le geste sûr, on le rend le plus facile possible).
  Haptique `impactAsync(Heavy)`. Le libellé devient `Interrompu` en `status.success` pendant
  1200 ms, puis la carte migre vers `TRAVAILLE` ou `INACTIF` selon l'événement reçu.
- Appui long : menu contextuel à une seule entrée, `Ouvrir sur le Mac` (`focus-pane`).
- **Aucune action de balayage sur une ligne de session.** `Muter` est supprimé (C31) : un
  balayage se fait en poche, et couper silencieusement et définitivement la notification qui
  justifie le produit est un piège sans retour. Le réglage `Validations seulement` et les
  `Heures calmes` (section 4.10) couvrent le besoin de baisser le bruit, et eux se voient.
- Tirer vers le bas : `list-panes` forcé, spinner natif.

**`Interrompre`, règle unique pour toute l'application (C21, A2, A7).** Le geste existe sur
quatre surfaces : la carte `EN ATTENTE`, la ligne `TRAVAILLE`, la barre de validation
(section 4.3.7) et la notification (section 5.3). Sur les quatre, il a exactement le même
contrat : message `pane.interrupt {paneId}`, aucune confirmation, aucune authentification,
haptique `impactAsync(Heavy)`, libellé `Interrompre` et jamais autre chose. Il est en lot 1.

#### États

| État | Rendu |
|---|---|
| **Chargement initial** (aucun cache) | 3 lignes squelettes de 64 pt, fond `bg.raised`, shimmer 1400 ms. Sections invisibles. Jamais de spinner plein écran |
| **Chargement avec cache** | Liste du cache immédiatement, pastille `(Connexion…)`, aucun squelette |
| **Vide** (daemon joignable, Kova lancé, 0 pane) | Glyphe terminal 48 pt `text.tertiary`, titre display "Aucune session", corps callout "Ouvre un pane dans Kova, il apparaîtra ici.", bouton `[ Ouvrir un projet récent ]` |
| **Kova n'est pas lancé** | Titre "Kova n'est pas lancé", corps "Les fichiers du Mac restent accessibles.", bouton primaire 60 pt `[ Lancer Kova ]` (le daemon exécute `open -a Kova`), lien secondaire `Parcourir le Mac`. **Aucun chemin de socket, aucun message technique** (`01-prd.md` 5.4, CA-62) |
| **Lancement de Kova en cours** | Le bouton devient `Lancement…` avec spinner, désactivé. Retour à l'état normal dès le premier `list-panes` non vide, ou message d'échec après 15 s |
| **Mac injoignable** (l'iPhone a du réseau, le daemon ne répond pas) | Pastille `(Mac injoignable)` en `link.macUnreachable`. Bandeau 32 pt : "Mac endormi ou éteint, dernier état à 14:32", bouton `Réessayer`. Liste en cache visible et navigable en lecture seule |
| **Hors ligne** (l'iPhone n'a aucun réseau, `expo-network`) | Pastille `(Hors ligne)` en `link.offline`. Bandeau : "iPhone hors ligne, dernier état à 14:32". Même comportement de cache. La distinction avec l'état précédent est le seul moyen pour Robin de savoir s'il doit chercher du réseau ou renoncer |
| **Erreur daemon** (le daemon répond, l'IPC Kova échoue) | Bandeau `status.error` : "Kova ne répond pas", bouton `Réessayer`. Liste en cache grisée à 60 % |
| Dans tous les états dégradés | Le bouton `Interrompre` est désactivé avec le libellé `Indisponible`. Le bouton `Ouvrir` reste actif : lire est toujours permis |

---

### 4.2 Écran Chat d'une session [lot 1, écran central du produit]

**C'est l'écran que Robin regarde vingt fois par jour** depuis le basculement de prémisse
(C36) : ses agents tournent en `bypassPermissions`, ils ne demandent presque jamais de
permission, ils **finissent** et attendent l'instruction suivante. Ce qu'il vient lire, c'est le
dernier échange. Ce qu'il vient faire, c'est donner la suite.

**Découpage par lot, explicite.**

| Élément | Lot |
|---|---|
| En-tête, sous-titre contextuel, pastille de liaison | 1 |
| **Rendu du dernier échange depuis le JSONL** : message utilisateur, réponse assistant regroupée par `requestId` (A16), Markdown de base | **1** |
| **Blocs d'appel d'outil, en-tête et état, repliés par défaut** | **1** |
| Composer (section 4.5) | 1 |
| Barre de validation (section 4.3) | 1, mais chemin rare |
| Contenu déplié d'un bloc d'outil : blocs de code, diffs, coloration syntaxique | 2 (en lot 1, le dépliage affiche le texte brut tronqué à 40 lignes, en `mono.code`, sans coloration) |
| Sous-agents joints par `toolUseId` (A16) | 2 |
| Pagination inverse de l'historique au delà du dernier échange | 2 |

Le lot 1 rend donc une conversation lisible de bout en bout, pas un extrait. Ce qui est
repoussé, c'est l'embellissement du contenu déplié, jamais la capacité de lire.

```
+---------------------------------------------+
| < Sessions   [Chat|Term|Fich]   (Direct) ...| 44pt nav bar
+---------------------------------------------+
| * link · cc   ~/.../personal-tools/link     | 28pt sous-titre
+---------------------------------------------+
|                                             |
|              +----------------------------+ |
|              | Ecris la spec de design en | | bulle utilisateur
|              | te basant sur 00-context   | | alignée à droite
|              +----------------------------+ | accent.subtleBg
|                                   14:32 (v) | 13pt footnote
|                                             |
| +-----------------------------------------+ |
| | Je lis d'abord le contexte technique.   | | bulle assistant
| +-----------------------------------------+ | bg.raised
|                                             |
| +-----------------------------------------+ |
| | > Read  00-context.md            184 l. | | outil replié [lot 1]
| +-----------------------------------------+ | 48pt, bg.overlay
|                                             |
| +-----------------------------------------+ |
| | v Edit  02-design.md        +42  -3     | | outil déplié [lot 1]
| +-----------------------------------------+ |
| | 118  const dark = {            [copier] | |
| | 119 -  bg: '#000000',                   | | diff.delBg
| | 119 +  bg: '#0B0D10',                   | | diff.addBg
| | 120    text: '#E8EAED',                 | |
| | <------ defilement horizontal ------->  | |
| +-----------------------------------------+ |
|                                             |
| +-----------------------------------------+ |
| | Je vais modifier tokens.ts. Tu confirmes| |
| +-----------------------------------------+ |
|                                             |
+=============================================+
|  BARRE DE VALIDATION (section 4.3)          | ancrée, pousse la liste
+---------------------------------------------+
|  [ Message...   ]                    [ >> ] | 52pt composer
+---------------------------------------------+
|                                        34pt |
+---------------------------------------------+
```

#### Zones

**Nav bar.** Retour `< Sessions`, segmented control `Chat | Term | Fich` (168 x 30 pt,
`bg.overlay`, sélection `bg.raised` et `text.primary`, non sélectionné `text.secondary`),
pastille de liaison compacte (point de 8 pt sans texte), menu `...` (Ouvrir sur le Mac, Copier
le transcript). Aucune entrée `Muter` (C31).

**Sous-titre contextuel** (28 pt, séparateur bas `border.subtle`). Point de couleur d'onglet
Kova, `projet · titre de pane` en calloutStrong, chemin tronqué en tête en `mono.path`
`text.tertiary`. Tap sur le chemin : vue Fichiers à ce dossier (lot 3).

**Bulle utilisateur.** Alignée à droite, largeur maximale 82 %, fond `accent.subtleBg`, texte
`text.primary` body 17, `radius.lg` avec le coin bas droit à `radius.sm`. Padding 12 x 14.
Horodatage et état d'envoi en dessous, footnote `text.tertiary` : coche (envoyé et acquitté),
cercle creux (en file), point d'exclamation (échec, tap pour réessayer).

**Bulle assistant.** Alignée à gauche, largeur maximale 92 % (c'est du contenu à lire), fond
`bg.raised`, `radius.lg` avec le coin bas gauche à `radius.sm`. Markdown rendu : gras, italique,
listes, titres (mappés sur calloutStrong), liens (`accent.primary`, souligné), code en ligne
(fond `bg.inset`, `radius.sm`, `mono.codeInline` 15 pt). Pas d'avatar, pas de nom : il n'y a que
deux interlocuteurs. Les lignes `assistant` du JSONL sont regroupées par `requestId` (A16), le
champ `usage` n'est jamais sommé.

**Bloc d'appel d'outil** [en-tête et repli : lot 1, contenu enrichi : lot 2]. Composant `ToolBlock`, fond `bg.overlay`, contour
`border.subtle`, `radius.lg`, marge verticale 8 pt.
- *En-tête* (48 pt, cible tappable pleine largeur) : chevron (rotation 160 ms), nom d'outil en
  calloutStrong, argument principal tronqué au milieu, métrique à droite en footnote.
- *États* : en cours (spinner 900 ms, en-tête `status.working`), succès (neutre), échec
  (`status.error`, **déplié par défaut**).
- *Corps déplié* : bloc de code, diff, ou texte brut tronqué à 40 lignes avec un bouton
  `Afficher les 312 lignes`.
- *Règle de repli* : Read, Glob, Grep, LS repliés. Edit, Write, MultiEdit dépliés (Robin doit
  voir ce qui change). Bash replié sauf code de sortie non nul. Tout échec déplié.
- *Sous-agents* (A16) : le transcript `subagents/agent-*.jsonl` est joint par `toolUseId` et
  rendu comme un bloc pliable **dans** la bulle de l'outil parent, jamais comme une conversation
  de premier niveau.
- Le nombre de blocs par `requestId` va de 1 à 5 (C11), aucune hypothèse n'est faite dessus.
- Tout type de ligne JSONL inconnu est ignoré silencieusement, jamais une erreur bloquante (C12).
- Les lignes `queue-operation` sont **ignorées et jamais rendues** (C22). Mesure du panel sur les
  transcripts réels : 20 entrées, dont 11 blobs XML de notification et 9 valeurs nulles, et zéro
  message écrit par Robin. Les rendre en bulle utilisateur injecterait du XML dans le fil.
- Aucun mécanisme de récupération de sortie complète par marqueur n'est spécifié (C34) : le
  marqueur `Full output saved to:` n'existe pas dans les transcripts réels. Une sortie d'outil
  tronquée reste tronquée, et le bouton `Afficher les 312 lignes` n'affiche que ce que le JSONL
  contient réellement.

**Bloc de code** [lot 2]. En lot 1, le contenu déplié est du texte brut en `mono.code`, sans
coloration ni bouton de langue, mais avec le défilement horizontal et le bouton `Copier`.
Fond `bg.inset`, `radius.md`, `mono.code` 13/20, padding 12.
- Barre supérieure de 32 pt : langage en caption `text.tertiary`, bouton `Copier` (44 x 32).
- **Défilement horizontal**, jamais de retour à la ligne. Indicateur persistant, dégradé de
  16 pt sur le bord droit qui disparaît en fin de course.
- Les gestes horizontaux dans un bloc de code ont priorité sur le balayage de changement de vue.
- Plus de 30 lignes : tronqué avec fondu et bouton `Afficher tout (312 lignes)`.
- Tap sur `Copier` : haptique `Light`, le label devient `Copié` en `status.success` 1200 ms.

**Bloc de diff** [lot 2]. En lot 1, un diff s'affiche comme un bloc de code brut, préfixes `+`
et `-` compris : lisible, sans teinte de fond. Fond `bg.inset`, `mono.diff` 12/18.
- En-tête 36 pt : chemin en `mono.path` tronqué en tête, compteur `+42 -3`, bouton `Copier`.
- Gouttière de 3 pt à gauche de chaque ligne, **et** préfixe `+` / `-` en caractère plein.
- Numéros de ligne en colonne de 40 pt, `diff.lineNo`, collés à gauche pendant le défilement
  horizontal du code.
- Vue unifiée uniquement : 393 pt ne permettent pas deux colonnes.
- Hunks séparés par une ligne `diff.hunkBg`. Au delà de 3 hunks, les suivants sont repliés.

**Indicateur de frappe.** Quand `pane-working: true` : trois points de 6 pt animés en vague
(opacité 0,3 vers 1, décalage 160 ms) dans une bulle assistant vide de 40 pt.

#### Comportement de défilement

- Ancrage bas par défaut. Au delà de 120 pt de scroll vers le haut, l'ancrage se désactive et un
  bouton flottant apparaît en bas à droite : 44 pt, `radius.full`, `bg.overlay`, chevron bas,
  badge du nombre de nouveaux messages.
- L'arrivée d'un `awaiting` **force** le scroll jusqu'au bloc de la question, même si l'ancrage
  était désactivé (P2), en `motion.base`.
- Pagination inverse par tranches de 50 entrées, déclenchée à 600 pt du haut [lot 2]. En lot 1,
  le dernier échange complet est chargé, ce qui couvre le geste « je lis et je donne la suite ».

#### États

| État | Rendu |
|---|---|
| **Chargement initial** | 4 bulles squelettes alternées, shimmer. Composer présent mais désactivé, placeholder "Connexion…" |
| **Ouverture depuis le cache** | Transcript en cache instantané, liseré de 2 pt `status.working` en haut de la liste pendant la réconciliation |
| **Session en cours de démarrage** (`new-tab` lancé, `agent_session_id` pas encore apparu) | Bandeau 44 pt `status.working` : "Démarrage de Claude, 8 s" avec compteur qui s'incrémente. Squelette de transcript en dessous. Composer désactivé. À **20 s** sans `agent_session_id`, bascule automatique sur la vue Term avec le bandeau "Claude ne répond pas, voici le terminal" (`01-prd.md` CA-19) |
| **Agent non-Claude** (`agent != "claude"`, A5) | Bandeau permanent 44 pt, fond `bg.overlay` : "Vue chat indisponible pour cet agent" et bouton `[ Ouvrir le terminal ]`. Le transcript n'est pas tenté. La bascule est silencieuse et explicable, jamais un écran vide |
| **Vide** (pane sans `agent_session_id`) | Message centré `text.tertiary` : "Ce pane n'a pas de session d'agent." et bouton `[ Ouvrir le terminal ]`. Le composer envoie du texte brut via `send-keys` |
| **Erreur de lecture du JSONL** | Bandeau `status.error` : "Transcript illisible", bouton `Ouvrir le terminal`. La barre de validation reste fonctionnelle : elle ne dépend pas du JSONL mais de `get-pane-content` (A6) |
| **Mac injoignable** | Bandeau `link.macUnreachable` : "Mac endormi ou éteint, dernier état à 14:32". Composer en file d'attente. Barre de validation masquée (P5) |
| **Hors ligne** | Bandeau `link.offline` : "iPhone hors ligne". Même comportement |
| **Pane fermé pendant la consultation** (`pane-close`, ou `get-pane-content` qui répond `ok:true` avec `{"error":"not found"}`, C9) | Bandeau : "Cette session n'existe plus." Le transcript reste lisible, composer et barre de validation désactivés, bouton `Retour aux sessions`. Le cas `not found` est modélisé explicitement : ni `cols` ni `rows` ne sont lus dans cet état |

---

### 4.3 Composant : barre de validation [lot 1]

**Le composant le plus important à l'intérieur de l'app.** Tout le produit existe pour ce
moment : la notification arrive, Robin ouvre, lit, débloque, range son téléphone. Cible : moins
de 10 secondes, une main, en marchant.

#### 4.3.1 Modèle de données et contrat d'envoi

**Avertissement de méthode (C37) :** aucun échantillon réel de prompt de permission n'a pu être
capturé, puisque Robin travaille en `bypassPermissions`. Le schéma ci dessous est le contrat que
le daemon doit produire, il n'est **pas** une grammaire de parsing vérifiée. Le parseur est
défensif par défaut : en l'absence de certitude, il produit `parsed: false` et l'app affiche
l'état `unparsable` (section 4.3.6), qui est le comportement attendu et non un cas d'erreur.

Le prompt de permission de Claude Code **n'apparaît pas dans le transcript JSONL** (A6). Le
daemon le lit dans `get-pane-content` en `mode: "visible"`, déclenché par l'événement
`pane-status.awaiting`, jamais en boucle permanente (A6.4). Il émet vers l'app :

```json
{
  "type": "prompt",
  "paneId": 66,
  "promptHash": "b91c4e2f8a...",
  "question": "Autoriser Edit sur 02-design.md ?",
  "detail": "Modifie 42 lignes, supprime 3 lignes",
  "awaitingSince": "2026-09-10T15:12:04Z",
  "parsed": true,
  "options": [
    { "index": 1, "label": "Yes",                      "kind": "approve" },
    { "index": 2, "label": "Yes, and don't ask again", "kind": "approve_always" },
    { "index": 3, "label": "No, tell Claude what to do differently", "kind": "reject" }
  ]
}
```

**Contrat d'envoi, normatif et opposable à l'architecture (C1, A6.3) :**

```json
{ "action": "answer", "paneId": 66, "optionIndex": 2, "promptHash": "b91c4e2f8a..." }
```

1. Le client envoie **toujours** `optionIndex`. Jamais `"approve"`, jamais un libellé, jamais
   un retour chariot seul.
2. Le `promptHash` est un SHA-256 de la **charge décisionnelle complète** (C20), pas seulement
   de la ligne de question. Voir la table ci dessous. Il accompagne chaque réponse.
3. Le daemon relit le pane, recalcule le hash, et **refuse** s'il diffère. L'app reçoit
   `stale_prompt` et entre dans l'état `hash_mismatch` (section 4.3.5).
4. Le daemon émet le chiffre **et** l'Entrée dans **un seul `send-keys` atomique**
   (`{"cmd":"send-keys","pane_id":66,"text":"2\r"}`). Il n'existe aucun délai entre les deux :
   un délai ouvre une fenêtre où Claude Code peut enchaîner sur une autre question et recevoir
   l'Entrée.
5. **La position du curseur sur le Mac n'entre jamais dans la décision.** Ce qui est envoyé est
   le chiffre affiché sur le bouton, et rien d'autre.
6. **Aucun retour chariot ne part sans vérification d'état (C23).** Il n'existe que deux chemins
   qui émettent une Entrée vers un pane, et chacun porte sa vérification : une réponse à un
   prompt, protégée par le `promptHash` ci dessus, ou un envoi de texte utilisateur, qui est
   **refusé** si le pane est en `awaiting` avec un prompt parsé (sections 4.3.7 et 4.5). Il
   n'existe aucun troisième chemin, aucune touche `Entrée` isolée, aucun `sendKeys(['enter'])`.

**Ce qui entre dans le `promptHash`, et ce qui en est exclu (C20).**

Le hash portait en passe 2 sur la question et les libellés d'options. C'était insuffisant : deux
demandes `Bash` consécutives partagent la même question (`Do you want to run this command?`) et
les mêmes libellés (`Yes` / `Yes, don't ask again` / `No`), donc produisaient **le même hash**.
Le scénario que le hash est censé neutraliser (prompt N sur une lecture, prompt N+1 sur un
`rm -rf`, approbation de la mauvaise) n'était donc pas couvert. Le hash porte désormais sur tout
ce qui, s'il change, change la décision de Robin.

| Entre dans le hash | Pourquoi |
|---|---|
| La ligne de question, normalisée (espaces compressés, ANSI retiré) | C'est l'énoncé |
| Les libellés d'options, **dans l'ordre de leurs index**, séparés par un caractère non ambigu | Un changement d'ordre change ce que le chiffre 2 signifie |
| Le nombre d'options | Une option ajoutée ou retirée décale tout |
| **Le bloc de détail dans son intégralité** : commande shell, chemin de fichier, contenu du diff, arguments d'outil | **C'est ce qui distingue deux prompts identiques en apparence.** Sans lui, le hash ne protège de rien |
| L'identifiant du pane | Un hash ne doit pas être valide sur un autre pane |

| Exclu du hash | Pourquoi |
|---|---|
| Le marqueur de surlignage (le chevron ou l'inversion vidéo qui indique la ligne sélectionnée) | Il bouge quand Robin déplace le curseur sur le Mac sans rien décider. L'inclure ferait échouer des réponses parfaitement valides, et la position du curseur n'entre jamais dans la décision (point 5) |
| Les codes d'échappement ANSI, les couleurs et le style | Purement visuels, ils changent selon la largeur du pane |
| L'horodatage et le compteur de durée affichés par Claude Code | Ils changent chaque seconde, le hash ne survivrait pas une seconde |
| Les espaces de fin de ligne et le remplissage de bordure | Ils dépendent de `cols`, qui change quand Robin redimensionne son pane |
| Le contenu du terminal **hors** du bloc de prompt | La sortie d'une commande en cours dans un autre pane n'a rien à voir avec cette décision |

Règle de vérification : le daemon recalcule ce hash sur l'état courant du pane **juste avant**
d'émettre le `send-keys`, jamais au moment de la réception de la requête. Entre les deux, il ne
fait aucune autre écriture sur ce pane.

**Conséquence de design, à vérifier à la revue de code :** le nombre imprimé dans le badge d'un
bouton **est** la valeur envoyée. Le badge n'est pas une décoration, c'est la représentation
visible de la charge utile. S'ils divergent, c'est un bug bloquant. C'est aussi ce qui permet à
Robin de vérifier après coup, en regardant son Mac, que l'option 2 est bien celle qui est
partie.

**Nombre d'options variable (A6.1).** Jamais 3 en dur. Les gabarits ci dessous couvrent 2, 3,
et 4 ou plus, et le gabarit C n'a pas de borne haute.

**Position dérivée de l'index, pas du kind (B8).** L'ordre visuel est toujours celui des
`index` croissants. Le `kind` ne pilote que la **teinte** du remplissage. Une erreur de
l'heuristique de `kind` fait au pire un bouton mal coloré, jamais un bouton mal placé.

#### 4.3.2 Anatomie et gabarits

La barre est ancrée au dessus du composer, elle **pousse** la liste de messages (P2), elle ne la
recouvre pas. Fond `bg.overlay`, bord supérieur `border.subtle` de 1 pt, `shadow.bar`, coins
hauts `radius.xl`. Padding : 16 latéral, 12 haut, 12 bas.

**Gabarit A, 2 options :**

```
+=============================================+
| ◆  Autorisation requise            il y a 8s| 20pt  caption + timer
|                                             |
| Autoriser Edit sur 02-design.md ?           | 17pt  bodyStrong
| Modifie 42 lignes, supprime 3               | 15pt  callout secondary
|                                             |
| +--------------------++--------------------+|
| | (1)       Oui      || (2)       Non      || 60pt  ordre = index
| +--------------------++--------------------+|
|                                             |
| Autre reponse...              Interrompre   | 32pt  liens footnote
+=============================================+   total 204pt
```

**Gabarit B, 3 options (le cas canonique de Claude Code) :**

```
+=============================================+
| ◆  Autorisation requise            il y a 8s|
|                                             |
| Autoriser Edit sur 02-design.md ?           |
| Modifie 42 lignes, supprime 3               |
|                                             |
| +-----------------------------------------+ |
| | (2)  Oui, et ne plus redemander         | | 48pt  contour, recesse
| +-----------------------------------------+ |
| +--------------------++--------------------+|
| | (1)       Oui      || (3)       Non      || 60pt  pleins, egaux
| +--------------------++--------------------+|
|                                             |
| Autre reponse...              Interrompre   |
+=============================================+   total 260pt
```

Règle de composition du gabarit B : l'option de `kind: approve_always` est extraite de la ligne
principale et posée **au dessus**, en contour, hors de l'arc de repos du pouce. Les deux options
restantes occupent la ligne principale dans l'ordre de leurs index. Si aucune option n'a le
`kind: approve_always`, on tombe dans le gabarit C.

**Gabarit C, 4 options ou plus, ou tout `kind` inconnu :**

```
+=============================================+
| ◆  Choix requis                   il y a 12s|
| Quelle strategie de migration ?             |
| +-----------------------------------------+ |
| | (1)  Migration incrementale             | | 56pt
| +-----------------------------------------+ |
| | (2)  Reecriture complete                | | 56pt
| +-----------------------------------------+ |
| | (3)  Garder l'existant                  | | 56pt
| +-----------------------------------------+ |
| | (4)  Autre chose                        | | 56pt  zone defilante
| +-----------------------------------------+ |       max 268pt
| Autre reponse...              Interrompre   |
+=============================================+
```

En gabarit C, toutes les options sont en `action.neutral` (aucune teinte sémantique n'est
devinée), la zone est défilante et plafonnée à `layout.validationBarMaxHeight` (268 pt), et la
liste est **pré-défilée en bas** si elle dépasse : la fin de liste est dans la zone du pouce, le
haut reste atteignable au scroll. Un dégradé de 12 pt en haut signale le contenu masqué.

#### 4.3.3 Spécification des boutons

| Propriété | Valeur |
|---|---|
| Hauteur, action principale | 60 pt (gabarits A et B) |
| Hauteur, option de portée durable | 48 pt |
| Hauteur, option en liste (gabarit C) | 56 pt |
| Écart entre les deux boutons de la ligne principale | 12 pt |
| Écart vertical entre les rangées | 8 pt |
| Rayon | `radius.md` (10) |
| Label | `bodyStrong` 17/24, centré, une ligne, tronqué en queue |
| Badge de numéro | carré 20 x 20, `radius.xs`, fond `rgba(255,255,255,0.16)`, chiffre `caption` 11 pt en `text.onFill`, à 12 pt du bord gauche. **Sa valeur est l'`optionIndex` envoyé** |
| Zone tactile | rectangle du bouton, `hitSlop` de 4 pt vertical entre les rangées, sans chevauchement |
| Press-in | `spring.press`, scale 0,97, fond `bgPressed`, haptique `impactAsync(Medium)` |
| Press-out hors du bouton | retour à l'échelle 1 en `motion.fast`, aucun envoi |
| Ordre | index croissant, de gauche à droite puis de haut en bas. Aucun réglage ne peut l'inverser |

**Face ID (A2, A10), énoncé unique pour tout le document :**

| Action | Authentification |
|---|---|
| Toute option de `kind` `approve` ou `approve_always` | **Face ID obligatoire** si l'appareil est verrouillé ou si l'app est ouverte depuis moins de 2 s sur un déverrouillage |
| Toute option de `kind` `reject` | aucune |
| Option de `kind` inconnu (gabarit C) | **Face ID obligatoire** : dans le doute, on protège |
| `Interrompre` | aucune |
| Envoi de texte libre, pane en `awaiting` avec un **prompt parsé** | sans objet : l'envoi est **refusé**, voir ci dessous |
| Envoi de texte libre, pane en `awaiting` **non parsé** (état `unparsable`) | **Face ID obligatoire** |
| Envoi de texte libre, pane **hors** `awaiting` (le cas courant : Robin donne l'instruction suivante) | aucune |

Justification (A2) : refuser et interrompre sont les actions sûres. Exiger Face ID dessus ajoute
de la friction sur le geste défensif, ce qui pousse à approuver par facilité. C'est l'incitation
exactement inverse de celle qu'on veut. Le pire cas d'un refus non authentifié est un agent
bloqué, pas un disque modifié.

**Pourquoi le texte libre est traité comme une approbation potentielle (C23, C26).** Un prompt de
permission de Claude Code attend un chiffre. Taper `1` puis Envoyer **est** une approbation, avec
la même conséquence qu'un tap sur le bouton `Oui`, mais sans `promptHash`, sans relecture du pane
et sans Face ID. C'est une quatrième porte qui contourne les trois garde-fous du projet. Elle est
fermée de deux façons :

1. **Quand un prompt parsé est ouvert, le texte libre est refusé.** Le daemon vérifie l'état
   avant tout envoi et répond `prompt_open`. Robin dispose des boutons numérotés, qui sont sûrs.
   S'il veut répondre en mots, il passe par `Répondre autrement` (section 4.3.7), qui envoie
   d'abord l'option de refus par le chemin protégé, puis le texte une fois le prompt refermé.
2. **Quand le pane est en `awaiting` sans prompt parsé** (état `unparsable`), le texte libre est
   le seul chemin possible, donc il reste ouvert, mais il **exige Face ID** : dans cet état, on
   ne peut pas exclure que la frappe soit un chiffre qui approuve.

Hors `awaiting`, c'est à dire dans le cas dominant depuis C36 (l'agent a fini, Robin donne la
suite), aucune authentification n'est demandée. Ce serait de la friction sur le geste le plus
fréquent du produit, pour un envoi qui n'approuve rien.

#### 4.3.4 Sécurité anti-appui accidentel

1. **Fenêtre d'armement de 400 ms.** La barre entre en `spring.bar` (environ 320 ms perçus).
   Pendant 400 ms après le début de l'animation, `pointerEvents` vaut `none` sur la zone des
   boutons, sous un voile d'opacité 0,55 qui se lève en 120 ms. Sans ça, une notification
   ouverte pendant que le pouce descend valide toute seule.
2. **Pas de geste de balayage** pour valider, jamais (P3).
3. **Confirmation pour `approve_always`.** Un tap ne l'envoie pas : le bouton se transforme sur
   place en `[ Confirmer : ne plus redemander ]` en plein `action.approve.bg` pendant 3 s. Un
   second tap envoie (et déclenche Face ID). Un tap ailleurs ou l'expiration annule. C'est la
   seule option dont la portée dépasse la question courante.
4. **Anti double envoi.** Après l'envoi, tous les boutons passent en `text.disabled` et la barre
   entre en `sending`. Aucun second `answer` n'est possible pour ce `promptHash`.
5. **Vérification serveur.** Même si tout ce qui précède échoue, le daemon recalcule le
   `promptHash` avant d'émettre. C'est le seul garde-fou qui protège d'un changement d'écran.

#### 4.3.5 Cycle de vie et états

Treize états. `aging` (l'attente dure) et `hash_mismatch` (la question a changé) sont deux choses
différentes, le vocabulaire ne collisionne pas.

| État | Rendu | Durée |
|---|---|---|
| `hidden` | absent de l'arbre | |
| `entering` | translation depuis le bas (+64 pt vers 0), opacité 0 vers 1, `spring.bar`, voile d'armement actif | 320 ms |
| `armed` | état nominal, entièrement interactif. Le timer "il y a Ns" s'incrémente chaque seconde | jusqu'à réponse |
| `pressing` | bouton pressé, scale 0,97, haptique `Medium` | |
| `authenticating` | Face ID système par dessus. La barre reste visible en arrière-plan, boutons désactivés. Échec ou annulation : retour à `armed` sans envoi, aucun message d'erreur (l'utilisateur sait ce qu'il a fait) | |
| `sending` | boutons désactivés, le bouton choisi garde son remplissage et affiche un spinner 16 pt à la place de son badge | ACK daemon, timeout 4 s |
| `sent` | le bouton choisi passe en plein `status.success` 200 ms avec une coche, haptique `notificationAsync(Success)`, puis sortie `motion.exit` vers le bas | 400 ms |
| `failed` | la barre reste, bandeau interne `status.error` "Envoi impossible, réessaie", boutons ré-armés après 400 ms, haptique `notificationAsync(Error)` | |
| `hash_mismatch` | **Le daemon a refusé : la question affichée n'est plus celle du pane.** Bandeau interne `status.awaiting` de 40 pt : "La question a changé sur le Mac". La nouvelle question et ses nouvelles options **remplacent** l'anciennes en place, avec un fondu croisé de 220 ms. La barre repasse par `entering` et une **nouvelle fenêtre d'armement de 400 ms**. Haptique `notificationAsync(Warning)`. **Rien n'a été envoyé**, et ce fait est écrit dans le bandeau : "Ta réponse n'a pas été envoyée" | jusqu'à réponse |
| `expired` | `awaiting` repasse à false sans envoi de notre part : Robin a répondu sur le Mac. Sortie `motion.exit` et ligne "Répondu sur le Mac" | 2 s |
| `aging` | attente de plus de 10 min. Le losange et le timer passent en `status.error`, le timer affiche "il y a 12 min". Aucun autre changement, on ne bloque rien | |
| `unparsable` | section 4.3.6 | |
| `unavailable` | Mac injoignable, hors ligne, ou pane fermé. La barre est remplacée par une ligne de 44 pt, fond `status.error` à 12 % : "Réponse impossible, Mac injoignable" et bouton `Réessayer`. **Jamais de mise en file** : répondre à une question qui a peut-être expiré est pire que ne pas répondre (P5) | |

La différence entre `expired` et `hash_mismatch` est la différence entre "c'est réglé" et "ce
n'est pas réglé et tu as failli répondre à côté". Les confondre est le défaut que cette passe
corrige.

#### 4.3.6 État `unparsable` : question détectée, options illisibles [état de premier ordre]

A6.2 et A8 : si le parsing échoue ou est ambigu, l'app **n'affiche aucun bouton** et bascule sur
le terminal avec un message clair. On ne devine jamais un bouton.

**C'est le comportement attendu par défaut, pas un cas d'erreur (C37).** Aucun échantillon réel
de prompt de permission n'existe, puisque les sessions de Robin tournent en `bypassPermissions`.
Tant qu'un prompt réel n'a pas été capturé et que la grammaire n'a pas été écrite contre lui, le
parseur produira `parsed: false` sur à peu près tout, et cet état sera le rendu normal. Il doit
donc être aussi soigné que le chemin nominal, parce qu'il sera le chemin nominal au démarrage.

Procédure pour sortir de cette situation, à exécuter avant de déclarer un critère de parsing
satisfait : lancer une session en mode permissions par défaut, déclencher un `Edit` et un `Bash`,
capturer `get-pane-content` en `mode: "visible"`, et écrire la grammaire contre ces captures.

**Déclencheur.** Le daemon émet le message `prompt` avec `parsed: false` et sans tableau
`options`. Cela couvre trois cas : aucun bloc d'options reconnu, options reconnues mais
numérotation incohérente, ou question reconnue avec une seule option (ce qui n'est pas un
prompt de permission).

```
+=============================================+
| ◆  Validation requise           il y a 14s  | 20pt
|                                             |
| Une question attend sur le Mac.             | 17pt bodyStrong
| Les options n'ont pas pu etre lues.         | 15pt callout secondary
|                                             |
| +-----------------------------------------+ |
| |          Ouvrir le terminal             | | 60pt  primaire, unique
| +-----------------------------------------+ |
|                                             |
| Repondre en texte                Interrompre| 32pt  liens
+=============================================+   total 196pt
```

| Élément | Spec |
|---|---|
| Fond et liseré | `bg.overlay`, liseré supérieur 2 pt `status.awaiting` |
| Titre | "Une question attend sur le Mac." Le texte de la question **n'est pas affiché** : on vient de dire qu'on ne sait pas le lire, l'afficher quand même serait affirmer une lecture dont on n'a pas la certitude |
| Sous-titre | "Les options n'ont pas pu être lues." Formulation qui dit la vérité et n'accuse ni Robin ni Claude |
| Boutons d'option | **Aucun. Zéro. En aucune circonstance.** Aucune option numérotée n'est proposée, sur aucune surface |
| Bouton primaire | **Le seul bouton plein de cet état** : `Ouvrir le terminal`, 60 pt, `accent.primary`. Bascule sur la vue Term, positionnée en bas du flux, avec la barre de touches spéciales **et le pavé numérique visibles** (section 4.6) |
| Lien `Répondre en texte` | Donne le focus au composer en envoi brut. **Exige Face ID avant l'envoi** (section 4.3.3) : dans cet état, on ne peut pas exclure que la frappe soit un chiffre qui approuve. Le texte part via `send-keys` suivi de `\r`, en un seul appel atomique. Aucun `promptHash` n'est joint, puisqu'il n'y a pas de prompt structuré à hacher, et Robin voit ce qu'il tape |
| Lien `Interrompre` | `pane.interrupt {paneId}`, sans confirmation ni authentification |
| Comptage | Chaque occurrence incrémente le compteur `parse_failed` remonté dans l'écran Réglages, bloc Activité (section 4.10). C'est l'indicateur qui dira si le parseur décroche |

**Sortie de l'état.** Si un message `prompt` avec `parsed: true` arrive ensuite pour le même
pane (le parseur a réussi au sondage suivant), la barre bascule en `entering` normal avec un
fondu croisé de 220 ms et une nouvelle fenêtre d'armement. Si `awaiting` repasse à false, sortie
en `expired`.

**Ce que Robin peut faire, résumé en une ligne :** lire la question dans le terminal, taper le
chiffre au pavé numérique, ou interrompre. Trois chemins, tous sûrs, aucun deviné.

#### 4.3.7 Actions secondaires (rangée de 32 pt en bas de la barre)

- **`Répondre autrement`** à gauche, `accent.primary`, footnote. Visible **uniquement s'il existe
  une option de `kind: reject`**, absent sinon. Il ne donne pas directement la parole au clavier :
  tant qu'un prompt parsé est ouvert, le texte libre est refusé (C23). Il exécute une séquence en
  deux temps, visible à l'écran :
  1. envoi de l'option de refus par le chemin protégé (`optionIndex` du `kind: reject`, avec le
     `promptHash`), avec Face ID si cette option n'est pas de nature `reject`, ce qui ne peut pas
     arriver par construction, donc sans Face ID en pratique ;
  2. dès que le daemon confirme que `awaiting` est repassé à false, le composer s'ouvre avec le
     clavier, une pastille caption au dessus : `Refus envoyé, explique à Claude`.
  Si l'étape 1 échoue (`hash_mismatch`), l'étape 2 n'a pas lieu et la barre entre dans l'état
  `hash_mismatch` normal. C'est exactement ce que fait Claude Code quand on répond
  "No, tell Claude what to do differently", et cela ne fait jamais transiter un chiffre déguisé
  en phrase.
- **`Interrompre`** à droite, `action.interrupt.text`, footnote, cible tactile 44 x 32. Envoie
  `pane.interrupt {paneId}`, message dédié de premier ordre (C21), en lot 1.
  Haptique `impactAsync(Heavy)`. Pas de confirmation, pas d'authentification (A2, A7) :
  interrompre est réversible, c'est le geste de sécurité, on le rend le plus facile possible.
  Vocabulaire unique dans tout le produit : `Interrompre`, jamais `Stop`, jamais `Esc` (la
  touche `Esc` de la barre du terminal reste nommée `Esc`, c'est une touche, pas une action).

#### 4.3.8 Coexistence avec le clavier

Deux cas seulement, puisque le composer est verrouillé tant qu'un prompt parsé est ouvert
(section 4.5).

**Cas 1, état `armed` avec un prompt parsé.** Le clavier ne peut pas s'ouvrir : le champ est
verrouillé et un tap dessus fait pulser la barre. Il n'y a donc jamais de superposition à gérer.

**Cas 2, état `unparsable`, ou composer déverrouillé après un `Répondre autrement`.** Le clavier
s'ouvre, et la barre **se replie en une ligne de rappel de 40 pt** ancrée au dessus du composer :
losange, `Validation requise`, chevron haut. Un tap la redéploie et referme le clavier. On ne
superpose jamais 260 pt de barre et 300 pt de clavier sur 852 pt d'écran.

---

### 4.4 Écran verrouillé : la bannière de validation [lot 1]

**C'est l'écran le plus important de ce document.** Dans 55 % des cas, Robin ne verra jamais
autre chose : il regarde son téléphone, lit la bannière, tape une réponse, range son téléphone.
L'app n'est jamais ouverte. Tout ce qui est spécifié ailleurs sert les 45 % restants.

#### 4.4.1 Le problème à résoudre

A14 interdit tout extrait de transcript dans la charge utile du push, parce qu'elle transite par
le service de push d'Expo puis par APNs. Appliqué naïvement, cela donne une bannière qui dit
`Claude attend ta validation` et rien d'autre, avec un bouton `Oui` qui autorise une écriture
disque dont le libellé n'a jamais été affiché. C'est exactement l'accident que A7 refuse sur
l'écran Sessions, reproduit là où il se produira le plus souvent, et cela viole frontalement P3.

**La parade retenue : une Notification Service Extension.** Le push part avec
`mutable-content: 1` et un corps neutre. À la réception, avant tout affichage, l'extension
appelle le daemon sur le canal chiffré direct, récupère question, détail et options, et réécrit
la bannière. A14 est respecté (rien de sensible ne transite chez un tiers) et la question
redevient visible avant le tap.

**Depuis C36, cette bannière sert deux cas d'égale importance,** et le second est devenu le plus
fréquent : `awaiting` se lève aussi bien quand l'agent demande une permission (rare, mode bypass)
que quand il a fini et attend l'instruction suivante (constant). La différence est faite par la
présence d'un bloc d'options dans le pane :

| Cas | Bannière | Actions |
|---|---|---|
| L'agent attend une validation, options lisibles | `{onglet} attend ta validation`, question et options numérotées | chiffres et `Interrompre` (4.4.3) |
| L'agent a fini, aucune option (N2) | `{onglet} a terminé`, résumé du dernier message assistant | `Interrompre` sans objet, seulement le tap qui ouvre la session, où Robin dicte la suite |

La suite de cette section couvre le premier cas, qui est le seul à porter un risque. Le second
suit le même chemin technique (NSE, corps réécrit, charge utile neutre) avec un jeu d'actions
vide, et il est spécifié en section 5.2.

#### 4.4.2 Charge utile du push (ce qui passe chez Expo et APNs)

```json
{
  "aps": {
    "alert": { "title": "Validation requise", "body": "Ouvre KovaLink pour lire la question." },
    "mutable-content": 1,
    "category": "KL_AWAITING_BLIND",
    "interruption-level": "time-sensitive",
    "relevance-score": 1.0,
    "thread-id": "pane-66",
    "sound": "default"
  },
  "kl": { "paneId": 66, "promptRef": "9f2c...", "project": "link", "tab": "Link" }
}
```

Ne transitent que : l'identifiant du pane, une référence opaque au prompt, le nom du projet et le
titre d'onglet, tous autorisés nommément par A14. **Aucune question, aucun libellé d'option,
aucun chemin de fichier, aucune commande.**

| Champ | Règle |
|---|---|
| `promptRef` | Jeton opaque **à usage unique**, tiré aléatoirement, **non dérivé du `paneId`** et ne le révélant pas (C24). Il n'a de sens que pour le daemon, il expire à la première utilisation ou après 10 minutes |
| `category` | La charge utile porte **toujours** `KL_AWAITING_BLIND`, c'est à dire le pire cas. La NSE la remplace par la bonne catégorie une fois la question récupérée. Ainsi, si la NSE est tuée avant d'avoir écrit quoi que ce soit, ce qui s'affiche est la bannière sans action d'approbation, jamais une bannière qui promet des boutons inexistants |
| `alert` | Rempli avec le texte de repli, jamais vide : il n'existe aucun chemin où iOS affiche une bannière muette |
| Route de récupération | `GET /v1/prompt/{promptRef}` (C24), avec un **jeton court dédié à la NSE**, distinct du jeton de l'app, stocké dans le même Keychain partagé et de portée limitée à cette seule route |

Il n'existe **aucun réglage** gouvernant ce comportement (C28). Le réglage `Extraits dans les
notifications` de la passe 2 est supprimé : la NSE récupère toujours la question sur le canal
chiffré direct, donc la charge utile n'a jamais besoin de contenu sensible, et le réglage n'a
plus d'objet.

#### 4.4.3 Catégories et actions : pré-enregistrées, statiques, jamais réécrites

**Décision arrêtée (C25).** La capacité pour une Notification Service Extension de
ré-enregistrer une `UNNotificationCategory` avant affichage **n'est pas documentée par Apple**.
Les catégories appartiennent au centre de notification de l'app, pas à celui de l'extension. Si
l'hypothèse est fausse, la catégorie référencée n'existe pas au moment de l'affichage et la
bannière apparaît **sans aucun bouton**, sans que rien ne le signale, sur le seul écran qui
justifie le produit. On ne construit pas le chemin critique sur un comportement non documenté.

**Ce qu'on fait à la place.** Toutes les catégories sont enregistrées **statiquement au
lancement de l'app**, une fois pour toutes. Les boutons portent les **chiffres**. La NSE réécrit
uniquement le **corps** de la bannière, ce qu'elle a le droit de faire et qui est documenté, avec
la question, le détail et la **liste numérotée des options**. Robin lit dans le texte ce que fait
chaque chiffre, et tape le bouton correspondant.

Conséquence assumée : les libellés de boutons sont des chiffres, pas `Oui` et `Non`. C'est moins
élégant, et c'est le seul contrat qui tient sur appareil sans preuve préalable. Le sens n'est pas
perdu, il est simplement porté par le corps, qui est de toute façon ce que Robin doit lire avant
de taper (P3).

**Le budget d'actions.** iOS rend au plus **4 actions** sur l'écran verrouillé. `Ouvrir` n'est
pas une action déclarée : taper le corps de la bannière ouvre l'app, c'est l'action par défaut
d'iOS, elle est toujours disponible et ne consomme aucun budget.

Ordre de déclaration normatif (C30) : **les options par index croissant, puis `Interrompre`.**
Deux règles priment sur cet ordre, dans cet ordre de priorité :
1. **`Interrompre` n'est jamais retiré.**
2. **L'option de refus n'est jamais retirée.**

| Options du prompt | Catégorie | Actions déclarées | Total |
|---|---|---|---|
| 2 | `KL_AWAITING_2` | `1`, `2`, `Interrompre` | 3 |
| 3 | `KL_AWAITING_3` | `1`, `2`, `3`, `Interrompre` | 4 |
| 4 et plus | `KL_AWAITING_BLIND` | `Interrompre` et `Ouvrir` | 2 |
| parsing échoué | `KL_AWAITING_BLIND` | `Interrompre` et `Ouvrir` | 2 |

**Pourquoi il n'existe pas de catégorie à 4 options.** L'arithmétique ne laisse pas le choix :
4 options plus `Interrompre` font 5 actions déclarées pour un budget de 4. Il faudrait donc
retirer soit une option, soit `Interrompre`. Retirer `Interrompre` est interdit par C30. Retirer
une option est pire : une catégorie statique ne sait pas laquelle des quatre est le refus, donc
elle pourrait retirer précisément le geste sûr, sur l'écran verrouillé. À partir de 4 options, la
bannière retombe donc sur `KL_AWAITING_BLIND`, **avec le corps complet quand la question a été
récupérée** : Robin lit la question et ses quatre options, et ouvre l'app pour choisir. C'est
exactement la règle "au delà de la capacité, aucune action d'option, ouverture forcée".

Les identifiants d'action sont fixes et portent leur index : `answer:1`, `answer:2`, `answer:3`,
`interrupt`, `open`. Le `promptHash` et le `paneId` ne sont **pas** dans l'identifiant (il est
statique), ils viennent du `userInfo` que la NSE a rempli à la récupération. Une action rapide
envoie donc `{action:"answer", paneId, optionIndex, promptHash}`, exactement comme un tap dans
l'app, avec la même vérification côté daemon.

#### 4.4.4 Les trois états de la bannière

**État 1 : question récupérée. Le cas nominal, cible 300 à 800 ms.**

Exemple à 3 options, catégorie `KL_AWAITING_3` :

```
+---------------------------------------------+
|                                    15:12    |
|   dim. 10 septembre                         |
+---------------------------------------------+
| +-----------------------------------------+ |
| | [K] KOVALINK · LINK             il y a 8s| |
| |                                          | |
| | Link attend ta validation                | | title 15pt semibold
| | link · cc · Edit                          | | subtitle 13pt
| |                                          | |
| | Autoriser Edit sur 02-design.md ?         | | body 15pt
| | Modifie 42 lignes, supprime 3             | |
| |                                          | |
| | 1. Oui                                    | | liste numerotee
| | 2. Oui, et ne plus redemander             | | ecrite par la NSE
| | 3. Non                                    | |
| |                                          | |
| +--------+--------+--------+---------------+ |
| |   1    |   2    |   3    |  Interrompre  | | 44pt, 4 actions
| +--------+--------+--------+---------------+ |
|   ( taper le corps ouvre la session )        |
+---------------------------------------------+
```

Exemple à 2 options, catégorie `KL_AWAITING_2` :

```
+---------------------------------------------+
| | Link attend ta validation                | |
| | link · cc · Bash                          | |
| | Executer git push --force origin main ?   | |
| |                                          | |
| | 1. Oui                                    | |
| | 2. Non                                    | |
| +------------+------------+----------------+ |
| |     1      |     2      |  Interrompre   | | 44pt, 3 actions
| +------------+------------+----------------+ |
+---------------------------------------------+
```

| Champ | Valeur après réécriture par la NSE |
|---|---|
| `title` | `{titre onglet} attend ta validation`, par exemple `Link attend ta validation` (`01-prd.md` 4.2) |
| `subtitle` | `{projet} · {titre de pane} · {outil}` si l'outil est détecté, sinon `{projet} · {titre de pane}` |
| `body` | trois parties, dans cet ordre : la question tronquée à **120 caractères**, le détail sur une ligne, puis la **liste numérotée des options** telles qu'elles seront envoyées. La liste est ce qui donne son sens aux boutons chiffrés, elle n'est jamais omise |
| `userInfo` | `paneId`, `promptHash`, `optionCount`, et la table `index -> kind` pour l'affichage dans l'app à l'ouverture |
| `categoryIdentifier` | `KL_AWAITING_2`, `KL_AWAITING_3` ou `KL_AWAITING_BLIND`, selon la table de 4.4.3 |

**État 2 : récupération en cours.** Budget interne **4 s**, dans la fenêtre de 25 s qu'iOS
accorde à l'extension.

Cet état n'a **aucun rendu** : iOS n'affiche la bannière qu'une fois l'extension rendue. Il est
observable dans le bloc `Activité` des Réglages (compteur `nse_timeout`), pas à l'écran. Le
spécifier ainsi évite qu'un implémenteur invente une bannière de chargement que personne ne verra
jamais.

Séquence exacte de la NSE :

| t (ms) | Action |
|---|---|
| 0 | `didReceive`. Lecture du jeton NSE dans le Keychain partagé (App Group `group.io.claap.kovalink`) |
| 0 | `GET /v1/prompt/{promptRef}` sur le nom MagicDNS, TLS validé par la chaîne système (A12) |
| 0 à 4000 | Attente. Aucune interface |
| réponse `parsed: true`, 2 ou 3 options | Réécriture de `title`, `subtitle`, `body` et `userInfo`, `categoryIdentifier` remplacé par `KL_AWAITING_2` ou `KL_AWAITING_3`, `contentHandler` appelé. **État 1** |
| réponse `parsed: true`, 4 options ou plus | Réécriture identique du corps, `categoryIdentifier` laissé sur `KL_AWAITING_BLIND`. **État 1 dégradé** : la question est lisible, les options sont listées, aucun bouton d'option |
| réponse `parsed: false` | Corps réécrit avec la question si elle est disponible, sinon le texte de repli. `KL_AWAITING_BLIND` conservé. **État 3** |
| 4000 ms, erreur réseau, jeton absent, 404, ou `serviceExtensionTimeWillExpire` | `contentHandler` appelé avec la charge utile inchangée. **État 3** |

**État 3 : échec de récupération. Aucune action d'approbation (C27).**

```
+---------------------------------------------+
|                                    15:12    |
|   dim. 10 septembre                         |
+---------------------------------------------+
| +-----------------------------------------+ |
| | [K] KOVALINK · LINK             il y a 8s| |
| |                                          | |
| | Validation requise                       | | title
| | link · cc                                | | subtitle
| |                                          | |
| | La question n'a pas pu etre recuperee.   | | body
| | Ouvre l'app pour la lire.                | |
| |                                          | |
| +--------------------+---------------------+ |
| |    Interrompre     |       Ouvrir        | | 44pt, 2 actions
| +--------------------+---------------------+ |
+---------------------------------------------+
```

| Règle | Valeur |
|---|---|
| `title` | `Validation requise` |
| `subtitle` | `{projet} · {titre de pane}`, déjà dans la charge utile, aucune récupération nécessaire |
| `body` | `La question n'a pas pu être récupérée. Ouvre l'app pour la lire.` |
| Catégorie | `KL_AWAITING_BLIND`, enregistrée statiquement, **jamais réécrite**, identifiant unique dans les trois documents |
| Actions | **`Interrompre`** (sûr, sans authentification) et **`Ouvrir`** (foreground). Rien d'autre. `Ouvrir` est ici déclaré explicitement, en plus du tap par défaut, parce que c'est le seul chemin utile et qu'il doit être visible |
| Actions interdites | **Aucune action d'approbation. Aucune action numérotée. Aucun champ de saisie.** Une réponse structurée suppose de connaître les options, ce qui est précisément ce qui a échoué |
| `interruption-level` | reste `time-sensitive` : ne pas avoir pu lire la question ne rend pas la situation moins urgente |
| Ouverture forcée | `Ouvrir` mène à `kovalink://session/{paneId}?focus=awaiting`. L'app récupère la question en premier plan, avec tout le temps qu'il faut, et affiche la barre de validation normale (4.3) ou l'état `unparsable` (4.3.6) |
| Compteur | Incrémente `nse_failed`. Un taux durablement au dessus de 5 % signifie que le Mac dort trop souvent ou que le daemon est trop lent : c'est un signal produit, pas un bug d'affichage |

#### 4.4.5 Face ID sur les actions rapides (A2, A10)

| Action | `authenticationRequired` | Justification |
|---|---|---|
| Action numérotée dont le `kind` est `approve` ou inconnu | **`true`** | Elle engage le disque entier. Face ID est instantané quand Robin regarde déjà son écran |
| Action numérotée dont le `kind` est `reject` | `false` | Action sûre par défaut. Exiger Face ID dessus pousse à approuver par facilité |
| `Interrompre` | `false` | Le geste qu'on veut rendre le plus facile de tout le produit |
| `Ouvrir` | déverrouillage standard de l'appareil | Comportement iOS normal |

La catégorie étant statique, le `kind` de chaque index n'est pas connu à l'enregistrement. Les
actions numérotées sont donc **toutes** déclarées avec `authenticationRequired: true`, et le
daemon relâche l'exigence côté serveur pour un `optionIndex` dont il sait qu'il est un refus.
Conséquence honnête : sur l'écran verrouillé, refuser demande Face ID au même titre
qu'approuver. Le geste sûr sans authentification reste disponible et il s'appelle
**`Interrompre`**, qui est précisément celui que A7 veut rendre le plus facile. Aucune règle
n'est contournée, et rien n'est promis qu'iOS ne puisse tenir.

#### 4.4.6 Ce qui se passe après un tap

| t | Ce qui se passe |
|---|---|
| 0 | Tap sur `2`. iOS présente Face ID |
| Face ID OK | L'action d'arrière-plan envoie `{action:"answer", paneId, optionIndex: 2, promptHash}`, tous lus dans le `userInfo` écrit par la NSE |
| daemon | Recalcule le `promptHash` sur la charge décisionnelle complète (4.3.1) et refuse s'il diffère |
| ACK | La notification d'origine est retirée. Une notification silencieuse la remplace 3 s, même `thread-id`, `interruption-level: passive`, sans son : `Réponse envoyée : option 2` |
| `stale_prompt` | Notification `active` : `La question a changé, ta réponse n'a pas été envoyée`, action unique `Ouvrir`. Le texte dit explicitement que rien n'est parti, même vocabulaire que l'état `hash_mismatch` de la barre |
| échec réseau | Notification `active` : `Envoi impossible, ouvre l'app`, action `Ouvrir` |
| Face ID échoué ou annulé | Rien. La notification d'origine reste en place, intacte |
| Tap sur `Interrompre` | `pane.interrupt {paneId}`, sans Face ID, sans confirmation. Notification de remplacement : `Agent interrompu` |

#### 4.4.7 Ce qui n'est jamais proposé sur l'écran verrouillé

| Interdit | Pourquoi |
|---|---|
| **Toute saisie de texte libre** (`Répondre…`, `Continuer…`) | **C26, éliminatoire.** Un prompt de permission attend un chiffre : taper `1` puis Envoyer approuve l'option 1, sans Face ID, sans `promptHash`, sans relecture du pane. Cela contourne les trois garde-fous du projet d'un coup. Ces actions n'existent plus, ni sur `KL_AWAITING_*`, ni sur `KL_DONE` |
| L'option `approve_always` sous un libellé explicite | Elle change durablement les permissions d'un agent qui a le disque entier. Elle reste **atteignable par son chiffre** si le prompt la contient (le corps la liste), mais elle n'est jamais mise en avant, et la double confirmation de 4.3.4 ne s'applique que dans l'app. Un utilisateur qui veut l'accorder délibérément a le chemin ; un utilisateur pressé ne tombe pas dessus |
| Toute action numérotée quand la question n'est pas affichée | État 3. C'est le coeur de cette section |
| Toute action numérotée à partir de 4 options | Table de 4.4.3. Le budget d'actions ne permet pas de garantir que le refus et `Interrompre` survivent |
| Une action spécifique à un pane sur une notification agrégée | Une agrégation ne peut porter aucune action de pane. Elle ne porte que `Ouvrir` (section 5.4) |


### 4.5 Composant : zone de saisie (composer) [lot 1]

**Deuxième composant du produit par ordre d'importance depuis C36** : les agents de Robin
finissent et attendent l'instruction suivante, et c'est ici qu'il la donne, vingt fois par jour.

```
+---------------------------------------------+
| +-------------------------------------+ +--+|
| | Message...                          | |>>|| 52pt
| +-------------------------------------+ +--+|
+---------------------------------------------+
       champ souple 40pt min             44pt
```

État avec agent en cours d'exécution :

```
+---------------------------------------------+
| +-------------------------------+ +-------+ |
| | Message...                  | |Interr.| | 52pt
| +-------------------------------+ +-------+ |
+---------------------------------------------+
```

| Zone | Spec |
|---|---|
| Champ | `bg.inset`, contour `border.subtle` (`border.focus` au focus), `radius.md`, padding 12 x 14, `body` 17/24, hauteur 40 pt min, croissance jusqu'à 148 pt puis défilement interne. Placeholder `Message…` en `text.tertiary` |
| Bouton envoyer | 44 x 44, `radius.full`, `accent.primary`, glyphe d'envoi en `text.onFill`. Désactivé (`text.disabled`) tant que le champ est vide |
| Bouton interrompre | Remplace le bouton d'envoi quand `pane-working: true` **et** le champ est vide. 116 x 44 (largeur nécessaire au libellé complet à 15 pt semibold), `radius.md`, contour `action.interrupt.border` 1,5 pt, fond transparent, label `Interrompre` en calloutStrong `action.interrupt.text`, jamais abrégé |

**Dictée vocale : celle du clavier iOS, pas la nôtre.** Le composant `VoiceCapture` maison
(appui maintenu, forme d'onde à 30 Hz, `expo-speech-recognition`, geste d'annulation) est
**retiré**. La touche micro du clavier iOS fait déjà tout, gratuitement, avec le modèle mental
que Robin connaît, et elle insère dans le champ sans envoyer. Le champ déclare
`keyboardType: 'default'` et ne masque jamais la rangée de raccourcis du clavier.
Conséquence de design assumée : il n'y a **aucun bouton micro** dans l'app.

**Envoi.** Tap sur le bouton d'envoi : haptique `impactAsync(Light)`, le champ se vide
instantanément, la bulle utilisateur apparaît en état optimiste avec le cercle creux, le scroll
descend en `motion.base`. Le daemon envoie le texte puis `\r` en un seul appel atomique. À
l'accusé de réception, le cercle devient une coche avec un fondu de 160 ms. En cas d'échec, point
d'exclamation `status.error`, tap pour renvoyer.

**Vérification d'état avant tout envoi (C23).** Aucun retour chariot ne part sans que le daemon
ait vérifié l'état du pane. Le composer connaît trois régimes, et son apparence les distingue :

| État du pane | Composer | Envoi |
|---|---|---|
| Hors `awaiting` : l'agent travaille ou a fini. **Le cas dominant** | Normal, placeholder `Message…` | Autorisé, sans authentification |
| `awaiting` avec un **prompt parsé** ouvert | **Verrouillé.** Champ en `bg.raised`, placeholder `Réponds d'abord à la question ci dessus`, bouton d'envoi `text.disabled`. Un tap sur le champ fait pulser la barre de validation (scale 1,00 vers 1,02 vers 1,00, 220 ms) au lieu d'ouvrir le clavier | **Refusé**, côté app et côté daemon (`prompt_open`). Le chemin pour répondre en mots est `Répondre autrement` (4.3.7) |
| `awaiting` **sans** prompt parsé (état `unparsable`) | Normal, placeholder `Réponse libre, Face ID demandé` | Autorisé, **après Face ID** (4.3.3) |

La double barrière (app et daemon) est volontaire : l'app évite la frustration d'un envoi refusé,
le daemon garantit qu'aucun autre client, aucune reprise de file d'attente et aucun bug d'état ne
peut faire partir un chiffre déguisé en phrase pendant qu'un prompt est ouvert.

**Multi-lignes.** La touche retour du clavier insère un saut de ligne, jamais un envoi. L'envoi
passe uniquement par le bouton. Raison : on tape souvent des instructions de plusieurs lignes,
et un envoi accidentel vers un agent est coûteux.

**Filtrage.** Tout texte envoyé passe par le même filtre côté daemon que les touches spéciales
(C6) : suppression des caractères de contrôle hors `\n` et `\t`, interdiction des séquences OSC,
bracketed paste obligatoire. Côté app, cela n'a aucun effet visible, sauf qu'un collage contenant
des séquences d'échappement part nettoyé. Le composer ne fait aucun filtrage de son côté : un
seul point d'entrée, une seule règle.

**États du composer**

| État | Rendu |
|---|---|
| Normal | comme spécifié |
| Désactivé (pane fermé, session en démarrage, agent non-Claude en vue chat) | champ `bg.raised`, placeholder explicite ("Cette session n'existe plus", "Démarrage de Claude…"), bouton `text.disabled` |
| Mac injoignable ou hors ligne, avec file | actif, placeholder "Sera envoyé à la reconnexion", liseré supérieur 2 pt `link.offline` ou `link.macUnreachable`. À la reprise, la file est **revalidée** contre l'état courant : un message en attente n'est pas envoyé si le pane est entre temps passé en `awaiting` avec un prompt parsé, il reste en file avec la mention `en attente, question ouverte` (C23) |
| Verrouillé par un prompt parsé ouvert | voir la table de vérification d'état ci dessus |
| File d'attente non vide | pastille au dessus du composer : `2 messages en attente`, caption, `bg.overlay` |
| Erreur d'envoi | bulle en erreur, plus un toast 2 s "Envoi impossible" |

Rappel : la file d'attente concerne les **messages**, jamais les **réponses de validation**
(section 4.3.5, état `unavailable`).

---

### 4.6 Écran Terminal [repli monospace lot 1, xterm.js complet lot 2]

Le repli assumé. Il doit être utilisable, pas confortable : c'est le chat qui doit être
confortable.

**Découpage par lot.**

| Élément | Lot |
|---|---|
| Repli monospace simple : le texte de `get-pane-content` en `mode: "visible"`, rendu en `mono.terminal`, non interactif, rafraîchi à 1 Hz, plus le pavé numérique et le champ de saisie. Environ 30 lignes de code, imposé par A6.2 comme destination de l'état `unparsable` | 1 |
| xterm.js dans un WebView, flux `.raw`, palette ANSI, barre de touches complète, pincement, paysage | 2 |

```
+---------------------------------------------+
| < Sessions   [Chat|Term|Fich]  (Direct) ... | 44pt
+---------------------------------------------+
| * link · cc                80x24 · Fit      | 28pt barre d'info
+---------------------------------------------+
| robin@mac link %  claude                    |
| +------------------------------------------+|
| | > Je lis d'abord le contexte technique.  || xterm.js  [lot 2]
| |                                          || bg.inset
| | . Read(00-context.md)                    || mono.terminal
| |   L  Read 184 lines                      || 12pt/16pt
| |                                          ||
| | Do you want to make this edit?           ||
| | > 1. Yes                                 ||
| |   2. Yes, and don't ask again            ||
| |   3. No                                  ||
| +------------------------------------------+|
+---------------------------------------------+
| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |       | 44pt pave numerique
+---------------------------------------------+
| Esc  Tab  Ctrl  <  ^  v  >  ^C  Ent    kbd  | 48pt touches speciales
+---------------------------------------------+
| [ Saisie...                            >> ] | 52pt si clavier ferme
+---------------------------------------------+
|                                        34pt |
+---------------------------------------------+
```

#### Zones

| Zone | Spec |
|---|---|
| Barre d'info | 28 pt. Gauche : point de couleur, `projet · pane`. Droite : dimensions réelles `80x24` (informatif), bouton `Fit`. **Le pane du Mac n'est jamais redimensionné depuis l'iPhone** : `Fit` est un ajustement de rendu côté client uniquement |
| Vue terminal | Lot 2 : `react-native-webview` avec xterm.js, fond `bg.inset`, palette ANSI de 2.1, curseur `#FFB020` en bloc clignotant 1,2 s, padding 8 pt. Le flux vient du `tail -f` de `~/Library/Logs/Kova/pty-capture-{pid}-{paneId}.raw` (ouverture, seek en fin, lecture en flux). Lot 1 : un `<Text>` monospace non interactif rempli par `get-pane-content` |
| Pavé numérique | 44 pt, chiffres 1 à 9, chips de 34 x 34. **Affiché uniquement quand `awaiting` est vrai sur ce pane**, c'est à dire quand on arrive ici depuis l'état `unparsable`. Il évite d'ouvrir le clavier système pour taper un seul chiffre |
| Barre de touches spéciales | 48 pt, `bg.overlay`, bord supérieur `border.subtle`, toujours visible en vue Term, y compris collée au clavier système [lot 2] |
| Champ de saisie | Visible seulement quand le clavier est fermé. Un tap sur la vue terminal ouvre le clavier et masque ce champ |

#### Barre de touches spéciales [lot 2]

Chips de 40 x 36, `radius.sm`, `bg.raised`, contour `border.subtle`, label `mono.code` 13 pt
`text.primary`, écart 6 pt, `hitSlop` vertical de 6 pt (cible effective 40 x 48). La rangée
défile horizontalement si elle déborde.

Chaque chip envoie une **valeur d'un type énuméré fermé** côté protocole, jamais du texte libre
(C6, C7). L'app ne peut pas envoyer une séquence arbitraire, même par erreur.

| Chip | Envoi | Comportement |
|---|---|---|
| `Esc` | `KEY_ESC` | tap simple, haptique `Heavy` |
| `Tab` | `KEY_TAB` | tap simple |
| `Ctrl` | aucun | **modificateur collant** : tap = armé (fond `accent.primary`, texte `text.onFill`), la touche suivante est combinée, puis désarmement. Double tap = verrouillé (contour clignotant), tap = déverrouille |
| flèches | `KEY_LEFT` `KEY_UP` `KEY_DOWN` `KEY_RIGHT` | tap simple ; répétition automatique après 400 ms de maintien, à 60 ms d'intervalle |
| `^C` | `KEY_CTRL_C` | raccourci direct, séparé du Ctrl collant, teinté `action.interrupt.text`. **Confirmation par appui long de 400 ms** avec anneau de progression : `^C` tue un agent en cours, ça ne doit pas partir dans une poche |
| `Ent` | `KEY_ENTER` | tap simple |
| chiffres 1 à 9 | `KEY_DIGIT_{n}` | pavé numérique, tap simple |
| clavier | aucun | ouvre ou ferme le clavier système, aligné à droite |

Haptique `impactAsync(Light)` sur chaque chip sauf `Esc` (`Heavy`) et `^C` (`Heavy` à la fin de
l'appui long).

#### Interactions [lot 2]

- Pincement à deux doigts : taille de police 10 à 18 pt, persistée par pane. Ce n'est pas un
  réglage exposé dans l'écran Réglages (C17), c'est un geste contextuel.
- Défilement vertical : scrollback natif de xterm.js, 5000 lignes en mémoire.
  `mode: "scrollback"` de l'IPC Kova n'est **jamais** utilisé : il renvoie zéro octet sur un pane
  Claude Code, qui occupe l'écran alterné (A15).
- Double tap : bascule `Fit` (colonnes ajustées à la largeur) et `80 colonnes` (défilement
  horizontal, fidélité maximale).
- Appui long : sélection de texte native de xterm.js et menu `Copier`.
- Rotation en paysage autorisée **uniquement** sur cet écran, les autres sont verrouillés en
  portrait. En paysage, la barre de touches passe à 40 pt.

#### Reprise après déconnexion

Le `.raw` croît de 145 Ko par minute mesuré, soit environ 4,3 Mo pour une demi heure de
déconnexion (C13). La stratégie est la **resynchronisation** (A15), jamais le rejeu intégral :
- Budget de rejeu fixé à **2 Mo** (C35, valeur unique dans les trois documents). En dessous, le
  daemon rejoue depuis le dernier offset connu
  et l'émulateur converge.
- Au delà, le daemon envoie `RESET` suivi de l'écran courant complet, et l'app affiche une ligne
  `text.tertiary` centrée : `--- reprise, historique tronqué ---`. C'est une information, pas une
  erreur : l'écran affiché est juste, seul le passé manque.

#### États

| État | Rendu |
|---|---|
| **Chargement** | Fond `bg.inset`, curseur clignotant seul en haut à gauche, ligne `mono.terminal` `text.tertiary` : `connexion au pane 66…` |
| **Vide** (fichier `.raw` absent ou capture désactivée) | Message `text.tertiary` centré : "Capture PTY indisponible pour ce pane.", puis "Rafraîchissement périodique à 1 Hz.", et bouton `[ Utiliser le mode polling ]` qui bascule sur `get-pane-content` en `mode: "visible"`. C'est exactement le repli du lot 1, donc il est toujours disponible |
| **Erreur** | Bandeau `status.error` : "Flux interrompu", bouton `Reconnecter`. Le contenu déjà reçu reste affiché, jamais effacé |
| **Mac injoignable / Hors ligne** | Voile `bg.scrim` à 40 % sur la vue, ligne centrale reprenant le libellé exact de la pastille. Barre de touches et pavé numérique désactivés. Contenu lisible et défilable |
| **Pane fermé** (`pane-close`, ou `ok:true` avec `{"error":"not found"}`, C9) | Ligne finale `text.tertiary` : `[cette session n'existe plus]`, barre de touches désactivée, bouton `Retour aux sessions` |

---

### 4.7 Écran Fichiers [lot 3]

Lecture, téléchargement et envoi. **Rien d'autre.** `01-prd.md` C7 et section 6 excluent
renommer, déplacer, supprimer et créer un dossier, et cette spécification s'y aligne sans
réserve : le daemon a un accès total au disque, et une suppression déclenchée par un tap
accidentel dans le métro est irréparable, pour un bloc qui pèse 4 % des ouvertures.

Note de sécurité connexe (C5) : la lecture reste totale sur tout le disque, l'écriture est
refusée par le daemon sur une liste noire de chemins de démarrage et de secrets. Côté interface,
cela se manifeste uniquement dans l'état d'erreur "Écriture refusée" du transfert.

```
+---------------------------------------------+
| < Sessions   [Chat|Term|Fich]  (Direct) ... | 44pt
+---------------------------------------------+
| ~ / ... / personal-tools / link         [+] | 36pt fil d'Ariane
+---------------------------------------------+
| Nom                        Taille   Modifie | 24pt en-tete de tri
+---------------------------------------------+
| [D] app                        --      2 j >| 60pt
| [D] daemon                     --      2 j >| 60pt
| [D] docs                       --     3 min>| 60pt
| [F] .gitignore                124 o    2 j  | 60pt
| [F] README.md                 4,2 Ko   1 j  | 60pt
| [I] capture.png               882 Ko  5 min | 60pt  vignette 40x40
+---------------------------------------------+
|                                             |
+---------------------------------------------+
| [        Envoyer un fichier ici           ] | 60pt barre d'action
+---------------------------------------------+
|                                        34pt |
+---------------------------------------------+
```

#### Zones

| Zone | Spec |
|---|---|
| Fil d'Ariane | 36 pt, `bg.raised`, défilant horizontalement, **auto-défilé à droite** (le segment courant est toujours visible). Segments en `mono.path` 13 pt, séparateur `/` en `text.tertiary`, segment courant en `text.primary` semibold, les autres en `accent.primary` et tappables. `~` remplace `$HOME`. Appui long sur un segment : `Copier le chemin` |
| Bouton `[+]` | 32 x 32 : menu à deux entrées, `Envoyer un fichier ici` et `Ouvrir ce dossier dans un nouveau pane Kova`. **Ni `Nouveau dossier`, ni `Coller`** |
| En-tête de tri | 24 pt, `caption` `text.tertiary`. Tap sur `Nom` / `Taille` / `Modifié`, chevron sur la colonne active. Défaut : dossiers d'abord, puis nom alphabétique |
| Ligne | 60 pt. Icône 24 pt (dossier, fichier, code, image, PDF, archive), nom en `body` 17 pt tronqué au milieu, taille et date en `footnote` `text.tertiary` à droite, chevron pour les dossiers. Vignette 40 x 40 en `radius.sm` pour les images |
| Barre d'action basse | `Envoyer un fichier ici`, pleine largeur, 60 pt (sélecteur de documents iOS ou photothèque, vers le dossier courant) |

#### Interactions

- Tap sur un dossier : navigation, transition de pile (`motion.slow`).
- Tap sur un fichier : ouvre l'aperçu.
- **Balayage vers la gauche : `Partager` uniquement.** Une seule action, non destructive.
- Appui long : menu contextuel `Aperçu`, `Partager`, `Copier le chemin`,
  `Ouvrir dans un nouveau pane Kova`. **Ni `Renommer`, ni `Dupliquer`, ni `Supprimer`.**
- Tirer vers le bas : rafraîchissement du dossier.
- Champ de recherche : révélé en tirant sous le fil d'Ariane, **filtre le dossier courant
  uniquement**. Aucune recherche récursive : elle est absente du PRD et ferait travailler le
  daemon sur tout le disque pour un besoin non exprimé.
- **Sélection multiple** (`01-prd.md` C3) : appui long sur l'en-tête de tri, ou bouton
  `Sélectionner` du menu `[+]`. Passe en mode sélection : pastille de 24 pt à gauche de chaque
  ligne, compteur `3 sélectionnés` dans la nav bar, barre basse à une seule action `Partager`
  (jusqu'à 20 fichiers). Sortie par `Annuler`. Aucune action destructive n'existe dans ce mode.

#### Aperçu de fichier

Feuille modale plein écran, coins hauts `radius.xl`, poignée de 36 x 4 pt.

| Type | Rendu |
|---|---|
| Texte ou code (moins de 2 Mo) | Lecture seule, `mono.code` 13/20, numéros de ligne, coloration syntaxique, défilement horizontal, bouton `Copier tout`. Barre haute : nom, taille, `Partager`, `Fermer` |
| Markdown | Bascule `Rendu` / `Source` en segmented control. Rendu par défaut |
| Image | Plein écran sur `bg.inset`, zoom par pincement, double tap pour ajuster, dimensions et poids en bas |
| PDF | Visionneuse native, pagination |
| Binaire ou plus de 2 Mo | Métadonnées seules : icône, nom, type MIME, taille, dates, chemin complet, boutons `Partager` et `Télécharger sur l'iPhone`. Aucun rendu tenté |

L'édition de fichiers depuis l'iPhone est hors périmètre (`01-prd.md` section 6) : tout aperçu
est en lecture seule, et aucun écran n'offre de champ éditable sur un contenu de fichier.

#### Transferts (A4 : aucun plafond)

| Règle | Valeur |
|---|---|
| Plafond de taille | **Aucun.** La limite est l'espace disque |
| Mode | Flux dans les deux sens, jamais de fichier entier en mémoire. Upload découpé en morceaux avec reprise après coupure réseau |
| Au delà de 100 Mo en données cellulaires | Feuille d'action **avant** de démarrer : titre `Fichier de 1,2 Go en cellulaire`, deux boutons de 60 pt, `[ Envoyer maintenant ]` et `[ Attendre le Wi-Fi ]`, plus `Annuler`. `Attendre le Wi-Fi` met le transfert en file et le démarre au prochain passage en Wi-Fi, avec une notification locale à la fin |
| En Wi-Fi | Aucun avertissement, quelle que soit la taille |
| Mac vers iPhone | Bouton `Partager`. Barre de progression linéaire de 3 pt sous la nav bar, `accent.primary`, pourcentage en caption. La share sheet iOS s'ouvre à la fin |
| iPhone vers Mac | Ligne fantôme en tête de liste (opacité 0,6) avec barre de progression intégrée, puis matérialisation en ligne normale (haptique `notificationAsync(Success)`) |
| Collision de nom | **Aucune boîte de dialogue, aucun écrasement possible.** Le daemon suffixe automatiquement : `capture-2.png`, `capture-3.png`. Format unique dans tout le projet : `nom-2.ext`. Une pastille caption sous la ligne indique `renommé en capture-2.png` pendant 3 s |
| Arrière-plan | Le transfert continue, notification locale silencieuse à la fin |
| Reprise | Une coupure réseau met le transfert en pause avec la mention `en pause, reprise automatique`, jamais un échec. Échec définitif seulement après 3 tentatives sur 5 min |

#### États

| État | Rendu |
|---|---|
| **Chargement** | 6 lignes squelettes de 60 pt avec shimmer. Le fil d'Ariane est déjà rendu |
| **Vide** | Icône dossier 40 pt `text.tertiary`, "Dossier vide", bouton `[ Envoyer un fichier ici ]` |
| **Erreur de permission en lecture** | Icône cadenas, "Accès refusé par macOS", chemin en `mono.path`, aide "Le daemon tourne sous ton utilisateur, ce dossier ne lui est pas accessible.", bouton `Retour` |
| **Écriture refusée** (chemin en liste noire, C5) | Feuille : "Écriture refusée sur ce chemin", corps "Ce dossier fait partie des mécanismes de démarrage et d'authentification du Mac. La lecture reste possible.", bouton `Choisir un autre dossier`. Ce n'est pas une erreur technique, c'est une règle, et le texte le dit |
| **Erreur générique** | Bandeau `status.error` avec le message du daemon, bouton `Réessayer` |
| **Mac injoignable / Hors ligne** | Les dossiers déjà visités sont servis depuis le cache avec une pastille caption `en cache · il y a 4 min`. Les autres affichent "Indisponible hors ligne". **Toutes les écritures sont désactivées, jamais mises en file** : écrire à l'aveugle sur un disque distant est trop risqué |

---

### 4.8 Flux de la Share Extension [lot 3]

Objectif : depuis Photos, Fichiers, Safari ou n'importe quelle app, envoyer un fichier vers un
dossier précis du Mac en **trois taps maximum**, sans ouvrir KovaLink.

```
Etape 1 : share sheet iOS       Etape 2 : extension KovaLink
+----------------------+        +---------------------------------------+
| AirDrop  Messages    |        |  Annuler   Envoyer vers le Mac   Env. | 44pt
| ...                  |        +---------------------------------------+
| [K] KovaLink      >  |  --->  | +-----------------------------------+ |
| Copier               |        | | [img] capture.png        882 Ko   | | 64pt
+----------------------+        | +-----------------------------------+ |
                                |                                       |
                                | DESTINATION                           |
                                | +-----------------------------------+ |
                                | | (o) link / docs         recent    | | 56pt
                                | | ( ) Downloads           recent    | | 56pt
                                | | ( ) Notes               signet    | | 56pt
                                | | ( ) Bureau              systeme   | | 56pt
                                | +-----------------------------------+ |
                                | [ Choisir un autre dossier...       ] | 48pt
                                |                                       |
                                | [ ] Ouvrir un pane Kova sur ce dossier| 44pt
                                +---------------------------------------+
```

Étape 3, progression puis confirmation :

```
+---------------------------------------+
|             (  72 %  )                |  anneau 64pt, accent.primary
|         capture.png                   |  callout
|      vers ~/.../link/docs             |  footnote, text.tertiary
|                                       |
|          [ Annuler ]                  |
+---------------------------------------+
          |
          v
+---------------------------------------+
|              ( v )                    |  anneau -> coche, status.success
|          Envoye sur le Mac            |  haptique Success
|      ~/.../link/docs/capture.png      |
+---------------------------------------+
  fermeture automatique apres 900 ms
```

| Point | Décision |
|---|---|
| Liste des destinations | Fusion de trois sources dans cet ordre : les 3 dernières destinations utilisées, les `cwd` des panes ouverts et les projets récents de `recent_projects.json` (libellés `récent`), puis 3 dossiers système (`Bureau`, `Téléchargements`, `Documents`). Maximum 6 lignes, le reste via `Choisir un autre dossier…` (`01-prd.md` S7) |
| Destination par défaut | La dernière utilisée est **pré-sélectionnée**, pas seulement en tête. Un tap sur `Envoyer` suffit donc : c'est le chemin à 1 tap |
| `Choisir un autre dossier…` | Mini navigateur dans l'extension, dossiers uniquement, sans aperçu ni action |
| Case `Ouvrir un pane Kova` | Si cochée, après le transfert le daemon lance `{"cmd":"new-tab","cwd":"<dossier>"}`. Mémorisée, décochée par défaut |
| Multi-fichiers | La zone du haut devient une liste défilante avec le total (`3 fichiers · 4,1 Mo`). Une seule destination pour le lot |
| Poids | **Aucun plafond** (A4). Au delà de 100 Mo en cellulaire, la feuille `Envoyer maintenant` / `Attendre le Wi-Fi` de la section 4.7 s'affiche avant de démarrer |
| Collision | Suffixe automatique `nom-2.ext`, jamais d'écrasement, jamais de dialogue |
| Authentification | Jeton lu dans le Keychain partagé (App Group `group.io.claap.kovalink`). Aucune saisie |
| Mac injoignable | Écran d'état : "Mac injoignable", bouton `[ Mettre en file d'attente ]` qui stocke le fichier dans le conteneur partagé. L'app hôte le pousse à la prochaine ouverture, avec une notification locale de confirmation |
| Erreur | Anneau rouge, message du daemon en callout, boutons `Réessayer` et `Changer de dossier`. Si le chemin est en liste noire d'écriture, le message est celui de la section 4.7 |
| Sens inverse | Depuis l'écran Fichiers, `Partager` télécharge puis ouvre la share sheet iOS standard. Aucune extension nécessaire dans ce sens |

---

### 4.9 Écran d'appairage initial [lot 1]

Premier lancement. Objectif : appairé et opérationnel en moins de 60 secondes, sans saisir un
seul caractère.

```
Ecran 1 : accueil                Ecran 2 : scan
+---------------------------+    +---------------------------+
|                           |    |  Annuler                  |
|          [K]              |    |                           |
|        KovaLink           |    |   +-------------------+   |
|                           |    |   |                   |   |
| Pilote tes sessions Kova  |    |   |   [ viseur ]      |   |
| depuis ton iPhone.        |    |   |                   |   |
|                           |    |   +-------------------+   |
| 1. Ouvre Kova sur le Mac  |    |                           |
| 2. Menu Kova > KovaLink   |    | Vise le QR code affiche   |
| 3. Scanne le QR code      |    | sur ton Mac               |
|                           |    | Il expire dans 2:41       |
| [ Scanner le QR code    ] |    |                           |
| Saisir le code a la main  |    | [ Saisir le code a la     |
+---------------------------+    |   main ]                  |
        60pt bouton              +---------------------------+
                                      viseur 240x240

Ecran 3 : verification            Ecran 4 : succes
+---------------------------+    +---------------------------+
|                           |    |                           |
|        ( ... )            |    |         ( v )             |
|                           |    |                           |
|  Connexion au Mac         |    |  Appaire avec             |
|                           |    |  macbook-robin.tail1234.ts|
|  [v] Mac trouve           |    |                           |
|  [v] Certificat valide    |    |  Connexion directe · 12 ms|
|  [.] Jeton verifie        |    |                           |
|  [ ] Notifications        |    | [ Activer les notif.    ] |
|                           |    | [ Commencer             ] |
+---------------------------+    +---------------------------+
```

| Point | Spec |
|---|---|
| Contenu du QR | JSON compact : `{"h":"macbook-robin.tail1234.ts.net","p":8765,"t":"<jeton 32 o base64url>","n":"MacBook Pro de Robin","exp":"2026-09-10T15:18:00Z"}`. **Une seule adresse** : le nom MagicDNS. A11 supprime l'écouteur LAN, il n'y a plus de seconde route à transmettre |
| Expiration du QR | **3 minutes** (C8). Le compteur est affiché sous le viseur et sur le Mac. Passé le délai, l'écran de scan affiche "Ce code a expiré, régénère-le sur le Mac" avec un bouton `Rescanner` |
| TLS | Certificat Let's Encrypt obtenu par `tailscale cert` sur le nom MagicDNS (A12). **Aucune empreinte à épingler, aucun SPKI dans le QR** : la chaîne de confiance système valide. L'étape de vérification s'appelle donc `Certificat valide`, pas `Certificat épinglé` |
| Viseur | Carré de 240 x 240 centré, coins tracés de 3 pt `accent.primary`, reste voilé à 70 %. Détection continue, pas de bouton de capture |
| Retour de scan | Haptique `notificationAsync(Success)`, coins en `status.success` qui se referment en 160 ms avant la transition |
| Saisie manuelle | Repli si la caméra est refusée ou si le QR ne passe pas : un champ pour le nom MagicDNS, un champ pour un code de 8 groupes de 4 caractères, clavier `asciiCapable`, collage supporté |
| Étapes de vérification | 4 lignes de 32 pt cochées une par une : `Mac trouvé` (résolution et TCP), `Certificat valide` (chaîne système), `Jeton vérifié` (challenge authentifié), `Notifications` (autorisation APNs, catégories enregistrées). Une ligne en échec passe en `status.error` avec un bouton `Détails` |
| Stockage | Jeton dans `expo-secure-store`, accessibilité `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, App Group partagé avec la Share Extension **et la Notification Service Extension**. Le jeton n'apparaît dans aucun journal, aucune URL, aucun message d'erreur (C8) |
| Échec `Certificat valide` | Écran bloquant, fond `status.error` à 8 %, titre "Certificat refusé", corps expliquant que la chaîne de confiance système rejette le certificat du Mac, et **aucun bouton pour passer outre**. Seulement `Rescanner` |
| Échec `Mac trouvé` | "Mac injoignable", le nom MagicDNS testé et son code d'erreur, bouton `Réessayer`, lien d'aide "Vérifie que Tailscale est actif sur les deux appareils" |
| Écran 4 | Affiche **une seule adresse** (le nom MagicDNS) et la nature de la liaison, `Connexion directe · 12 ms` ou `Connexion relayée · 48 ms` (A11) |
| Ré-appairage | Depuis Réglages > `Révoquer l'appairage`. Efface le jeton, le cache et la file, demande au daemon d'invalider le jeton, puis relance ce flux |

Aucun verrouillage biométrique à l'ouverture de l'app n'est proposé (C17) : Face ID protège déjà
l'action qui compte, l'approbation (A2). Un verrou d'ouverture supplémentaire ajouterait de la
friction sur la lecture, qui n'est pas l'action risquée.

---

### 4.10 Écran Réglages [lot 1]

**Quatre entrées interactives, plus le bloc `Activité` en lecture seule.** Chaque réglage exposé
est une décision que le concepteur n'a pas su prendre. Tout le reste est en dur, et la valeur
retenue est indiquée dans la table des valeurs figées ci dessous.

Le réglage `Extraits dans les notifications` de la passe 2 est **supprimé** (C28) : la NSE
récupère toujours la question sur le canal chiffré direct (section 4.4.2), donc la charge utile
n'a jamais besoin de contenu sensible et le réglage n'a plus d'objet. Il avait de surcroît deux
sémantiques opposées selon les documents, dont une qui, désactivée, tuait toutes les actions
rapides et éteignait le produit à l'installation.

```
+---------------------------------------------+
| < Sessions        Reglages                  | 44pt
+---------------------------------------------+
| NOTIFICATIONS                               |
| +-----------------------------------------+ |
| | Validations seulement           [ OFF ] | | 56pt
| |   Seules les demandes de validation      | |
| |   sonnent. Les fins de tache restent     | |
| |   silencieuses. Desactive par defaut.    | |
| +-----------------------------------------+ |
| | Heures calmes             23h00 - 07h00 | | 56pt
| +-----------------------------------------+ |
| MAC                                         |
| +-----------------------------------------+ |
| | Garder le Mac eveille           [ ON  ] | | 56pt
| |   Tant qu'un agent travaille, 4 h max.   | |
| +-----------------------------------------+ |
| SECURITE                                    |
| +-----------------------------------------+ |
| | Revoquer l'appairage                  > | | 48pt  status.error
| +-----------------------------------------+ |
|                                             |
| ACTIVITE                                    |
| +-----------------------------------------+ |
| | Liaison            Directe · 12 ms      | | lecture seule
| | Derniere notification livree   15:12    | |
| | Notifications aujourd'hui         14    | |
| | Questions illisibles (7 j)         0    | |
| | Bannieres non recuperees (7 j)     1    | |
| +-----------------------------------------+ |
| | App 1.0.0 (42) · daemon 0.4.1 · Kova    | | footnote
| | 1.11.0                                  | |
| +-----------------------------------------+ |
+---------------------------------------------+
```

#### Les 4 entrées interactives

| # | Entrée | Type | Défaut | Effet |
|---|---|---|---|---|
| 1 | `Validations seulement` | interrupteur | **OFF** | OFF : N1 à N4 sonnent selon le catalogue de la section 5. ON : seul N1 produit une notification sonore, N2 et N3 passent en `passive`. **Le défaut est OFF, et c'est une conséquence directe de C36** : depuis le basculement de prémisse, la notification qui compte le plus est N2 ("l'agent a fini"), pas N1. Le mettre à ON par défaut éteindrait le produit à l'installation |
| 2 | `Heures calmes` | plage horaire | 23h00 à 07h00 | Dans la plage, seul N1 sonne. N2 et N3 sont livrés en `passive`, sans son ni allumage d'écran (`01-prd.md` 4.4). Un seul jeu d'horaires dans tout le projet |
| 3 | `Garder le Mac éveillé` | interrupteur | ON | Imposé par A1. ON : le daemon pose une assertion IOKit `PreventUserIdleSystemSleep` tant qu'un pane a `working: true`, plafonnée à 4 h (A13). Sous-titre : "Tant qu'un agent travaille, 4 h max." La note "capot fermé sur batterie, la session est suspendue" est affichée en footnote sous la ligne |
| 4 | `Révoquer l'appairage` | action destructive | | Feuille d'action à double confirmation. Efface le jeton de la Keychain (app, Share Extension et Notification Service Extension), le cache, la file d'attente, et demande au daemon d'invalider le jeton côté Mac, effet immédiat (C8). Renvoie à l'écran d'appairage |

**Règle de comptage, pour lever toute ambiguïté au test :** l'écran contient **quatre entrées
interactives** (trois interrupteurs ou sélecteurs, une action destructive), plus un bloc
`Activité` de cinq lignes en lecture seule et un pied de version. Le bloc `Activité` ne compte
pas comme une entrée : il n'a aucun contrôle et n'ouvre aucun écran.

#### Bloc `Activité`, lecture seule, aucune commande

Cinq valeurs, aucune interaction, aucun écran poussé. Elles répondent aux indicateurs R1, R6 et
R7 du PRD sans ajouter un écran de plus.

| Ligne | Source |
|---|---|
| `Liaison` | `Directe · 12 ms` ou `Relayée · 48 ms`, ce que Tailscale expose (A11) |
| `Dernière notification livrée` | horodatage local |
| `Notifications aujourd'hui` | compteur local, sert à voir venir la fatigue de notification |
| `Questions illisibles (7 j)` | compteur `parse_failed` (section 4.3.6) |
| `Bannières non récupérées (7 j)` | compteur `nse_failed` (section 4.4.4, état 3) |

Le pied de bloc affiche les trois versions en footnote. Pas de bouton de mise à jour : les mises
à jour OTA sont appliquées au lancement, sans intervention.

#### Ce qui a été retiré, et la valeur figée à la place

| Retiré | Valeur en dur |
|---|---|
| `Forcer la route Auto / LAN / TS` | Sans objet : A11 supprime l'écouteur LAN, Tailscale choisit seul |
| `Tester la connexion` | Sans objet : le bloc `Activité` affiche déjà la liaison en continu |
| `Projets mutés` | **`Muter` est supprimé du produit (C31).** Un balayage se fait en poche, et il n'existait aucun libellé de démutage, aucun indicateur sur la ligne, aucun écran de liste. Couper silencieusement et définitivement la notification qui justifie le produit est un piège sans retour. `Validations seulement` et les `Heures calmes` couvrent le besoin, et eux se voient |
| `Extraits dans les notifications` | Supprimé (C28). La NSE récupère toujours la question sur le canal direct, la charge utile reste neutre en toutes circonstances |
| `Son` | Suivi des `Heures calmes` et de `Validations seulement` |
| `Thème` | Sombre, en dur (A9) |
| `Main gauche` | Supprimé. C'était le seul réglage capable d'inverser approuver et refuser |
| `Taille du code`, `Taille du terminal` | 13 pt et 12 pt en dur. Le pincement à deux doigts reste disponible dans le terminal |
| `Replier les outils par défaut` | Règle en dur de la section 4.2 |
| `Face ID à l'ouverture` | Retiré. Face ID protège l'approbation, pas la lecture |
| `Journal d'audit` | Le journal d'audit reste **obligatoire côté daemon** (contrainte 3 de `00-context.md` section 6), il vit sur le Mac. Aucun écran dans l'app : le consulter au doigt ne sert aucun scénario |
| `Empreinte du certificat` | Sans objet depuis A12 |
| `Dossier de partage par défaut` | La dernière destination utilisée, mémorisée par l'extension |
| `Signets` | Fusionnés dans la liste de destinations de la Share Extension |
| `Vider le cache local` | Purge automatique au delà de 200 Mo, la plus ancienne session d'abord |
| `Canal OTA`, `Rechercher une mise à jour` | Canal `production` en dur, mise à jour au lancement |

---

### 4.11 Écran Session fermée, lecture seule [lot 2]

`01-prd.md` S6, A9, CA-20 à CA-22. Reprendre une session d'il y a trois jours sans toucher au
Mac.

```
+---------------------------------------------+
| < Sessions      Refonte du parseur          | 44pt
+---------------------------------------------+
| Lecture seule · session fermee · 3 j        | 32pt bandeau permanent
+---------------------------------------------+
|                                             |
| +-----------------------------------------+ |
| | Il faut refactorer le parseur JSONL     | | transcript
| +-----------------------------------------+ | lecture seule
|                                             |
|              +----------------------------+ |
|              | Oui, je m'en occupe.       | |
|              +----------------------------+ |
|                                             |
|                                             |
+---------------------------------------------+
| [        Reprendre sur le Mac             ] | 60pt primaire
+---------------------------------------------+
|                                        34pt |
+---------------------------------------------+
```

| Zone | Spec |
|---|---|
| Nav bar | Retour, titre = `title` de l'entrée `claude_history.json`, tronqué en queue |
| Bandeau permanent | 32 pt, `bg.overlay`, texte `text.secondary` : `Lecture seule · session fermée · {ancienneté}`. Il ne se masque jamais au scroll : c'est ce qui empêche de croire qu'on peut écrire |
| Transcript | Même rendu que la section 4.2, sans indicateur de frappe et sans blocs d'outil en cours. Lu directement dans le `.jsonl` par son chemin, **sans lancer aucun processus sur le Mac** (CA-21) |
| Composer | **Absent de l'arbre**, pas seulement désactivé |
| Barre de validation | Impossible par construction : il n'y a pas de pane |
| Bouton primaire | `Reprendre sur le Mac`, 60 pt, `accent.primary`. Lance `{"cmd":"new-tab","cwd":"<cwd du projet>","command":"claude --resume <sessionId>"}` |

#### États

| État | Rendu |
|---|---|
| **Chargement** | Squelettes de bulles, bandeau déjà affiché |
| **Reprise en cours** | Le bouton devient `Reprise en cours…` avec spinner, désactivé. Le bandeau passe en `status.working` : `Démarrage sur le Mac, 6 s`. Dès qu'un pane porte un `agent_session_id` égal à l'uuid repris, navigation automatique en `router.replace` vers `/session/{paneId}`, le transcript passe en chat actif sur le même contenu (CA-22) |
| **Reprise sans réponse à 20 s** | Bandeau `status.error` : "Claude n'a pas démarré", boutons `Réessayer` et `Ouvrir le terminal` (même règle que CA-19) |
| **Transcript introuvable** | "Le fichier de transcript est introuvable", chemin en `mono.path`, bouton `Retour`. L'entrée reste dans la liste : c'est un fait, pas une erreur d'app |
| **Mac injoignable / Hors ligne** | Le transcript déjà mis en cache reste lisible. `Reprendre sur le Mac` est désactivé avec le libellé `Mac injoignable` |

---

## 5. Catalogue de notifications

Référence : `01-prd.md` section 4. Le rendu de la bannière N1 et sa Notification Service
Extension sont spécifiés en détail en section 4.4, qui fait autorité pour tout ce qui touche à
l'écran verrouillé. Cette section fixe le catalogue, les charges utiles et les règles anti-bruit.

### 5.1 Les quatre notifications

| ID | Déclencheur IPC | Catégorie APNs | Niveau | Lot |
|---|---|---|---|---|
| N1 | `pane-status` avec `awaiting: true` | `KL_AWAITING_2`, `KL_AWAITING_3` ou `KL_AWAITING_BLIND` selon la table de 4.4.3 | `time-sensitive` | 1 |
| N2 | `pane-working` avec `working: false`, après plus de **60 s** de travail, et `awaiting` faux | `KL_DONE` | `active` | 1 |
| N3 | `pane-close` sur un pane qui était `working: true`, hors fermeture initiée depuis l'app | `KL_CLOSED` | `active` | 2 |
| N4 | Reconnexion du daemon alors qu'il reste une action en file côté iPhone | `KL_RECONNECT` | `passive` | 2 |

Seuil unique pour N2 : **60 s** (C29, valeur du PRD, opposable). Aucune autre valeur ne circule
dans ce document.

**Depuis C36, N2 est la notification la plus fréquente et la plus utile.** Les agents de Robin
tournent en `bypassPermissions` : ils ne demandent presque jamais de permission, ils finissent.
N1 reste la plus risquée, donc la plus spécifiée, mais c'est N2 qui déclenche le geste de tous
les jours. Le réglage `Validations seulement` est donc désactivé par défaut (section 4.10).
`pane-open` et `focus` ne déclenchent jamais de notification. Il n'existe **pas** de catégorie
`ERROR` : une erreur de daemon se voit dans l'app, elle ne réveille pas Robin.

### 5.2 Contenu

| ID | `title` | `subtitle` | `body` |
|---|---|---|---|
| N1 | `{titre onglet} attend ta validation` | `{projet} · {pane} · {outil}` | la question, 120 caractères, puis le détail. **Écrit par la Notification Service Extension**, section 4.4 |
| N2 | `{titre onglet} a terminé` | durée de la tâche, `4 min 12 s` | les 140 premiers caractères du dernier bloc `text` de l'assistant. **Écrit par la même extension** (`mutable-content: 1` sur N2 aussi), la charge utile ne le transporte pas. Si la récupération échoue, corps générique `La tâche est terminée.`, sans autre conséquence : aucune action n'en dépend |
| N3 | `{titre onglet} s'est fermé` | nom du projet | `La session a été fermée alors qu'un agent travaillait.` Aucune donnée sensible, aucune récupération nécessaire |
| N4 | `Mac de nouveau joignable` | | `{n} action(s) en attente d'envoi.` |

Le titre d'onglet est `tab.title` (`Link`, `Projet A`, `Tools`), complété par le nom du projet
quand deux onglets portent le même titre.

**Règle de charge utile (A14), applicable à N1 et N2 :** la charge utile ne contient que le nom
du projet, le titre d'onglet, l'identifiant du pane, le type d'événement et une référence opaque.
Aucun texte de transcript. L'extension récupère le texte sur le canal chiffré direct. L'échec de
récupération est un état de premier ordre pour N1 (section 4.4, état 3) ; pour N2 il donne
simplement un `body` générique `La tâche est terminée.`, sans conséquence.

### 5.3 Actions rapides

Toutes les catégories sont **enregistrées statiquement au lancement de l'app** et ne sont jamais
réécrites (C25, section 4.4.3). Le tableau ci dessous est donc le contrat complet et fermé : il
n'existe aucune catégorie construite à la volée.

| Catégorie | Actions déclarées, dans l'ordre | `authenticationRequired` |
|---|---|---|
| `KL_AWAITING_2` | `1`, `2`, `Interrompre` | `true` sur les chiffres, `false` sur `Interrompre` |
| `KL_AWAITING_3` | `1`, `2`, `3`, `Interrompre` | idem |
| `KL_AWAITING_BLIND` (parsing échoué, ou 4 options et plus) | `Interrompre`, `Ouvrir` **et rien d'autre** | `false` / standard |
| `KL_DONE` | **aucune action déclarée.** Le tap ouvre la session, où Robin dicte la suite | standard |
| `KL_CLOSED` | `Ouvrir` | standard |
| `KL_RECONNECT` | aucune | |
| Notification agrégée | `Ouvrir` uniquement, vers `kovalink://sessions?filter=awaiting` | standard |

Sur toutes les catégories, `Ouvrir` reste accessible en tapant le corps de la bannière, qui est
l'action par défaut d'iOS. Elle n'est déclarée explicitement que là où elle est le seul chemin
utile (`KL_AWAITING_BLIND`, `KL_CLOSED`).

**Aucune saisie de texte libre, sur aucune catégorie (C26, éliminatoire).** `Répondre…` sur
`KL_AWAITING_*` et `Continuer…` sur `KL_DONE` sont supprimés. Motif : un prompt de permission de
Claude Code attend un chiffre. Taper `1` puis Envoyer depuis un iPhone verrouillé approuve
l'option 1, sans Face ID, sans `promptHash` et sans relecture du pane. C'était une quatrième
porte qui contournait d'un coup les trois garde-fous du projet. Le remplacement pour `KL_DONE`
est le tap : Robin ouvre la session, lit le dernier échange (section 4.2), et dicte la suite dans
le composer, où toutes les vérifications s'appliquent.

L'option `approve_always` n'est jamais mise en avant sur l'écran verrouillé et n'a jamais de
libellé propre : elle n'est atteignable que par son chiffre, listé dans le corps (section 4.4.7).

### 5.4 Règles anti-bruit

| Règle | Détail |
|---|---|
| Une notification vivante par pane | `thread-id` et `apns-collapse-id` = `pane-{id}`. Une nouvelle notification pour le même pane remplace la précédente |
| Anti-rafale | Un pane qui alterne working et awaiting plusieurs fois en moins de 30 s ne génère qu'une notification, mise à jour en place |
| Robin est devant son Mac | Si le dernier événement `focus` indique `app_active: true` **et** que le pane concerné est le pane focalisé, N1 et N2 sont **suspendues 60 s**. Passé ce délai sans changement d'état, la notification part quand même : il a pu s'éloigner en laissant Kova au premier plan |
| App au premier plan | Aucune notification système. Bandeau interne à la place (section 6.1, cas C) |
| Session déjà ouverte à l'écran | Aucune notification pour cette session. Retour interne uniquement (section 6.1, cas A) |
| Retrait automatique | N1 est retirée dès que `awaiting` repasse à false, quelle que soit l'origine de la réponse. Le daemon envoie un push silencieux qui déclenche `removeDeliveredNotifications` |
| Heures calmes, 23h00 à 07h00 | Seul N1 sonne. N2 et N3 sont livrés en `passive`, sans son ni allumage d'écran |
| `Validations seulement` (réglage 1, **OFF par défaut**) | Activé : seul N1 sonne, en permanence, N2 et N3 passent en `passive`. Désactivé, ce qui est le défaut : N1 et N2 sonnent tous les deux, ce que C36 rend nécessaire |
| Plafond | 20 notifications par heure. Au delà, agrégation en une notification `{n} agents attendent`, qui ne porte que `Ouvrir` |
| Badge d'icône | Nombre de panes en `awaiting`, jamais autre chose |
| **Aucun `Muter`** | Il n'existe aucun moyen de couper les notifications d'un projet en particulier (C31). Le seul réducteur de bruit est le couple `Validations seulement` et `Heures calmes`, tous deux visibles dans les Réglages et réversibles en un tap |

---

## 6. Micro-interactions et retours haptiques

Table de référence complète (`expo-haptics`) :

| Événement | Haptique | Retour visuel |
|---|---|---|
| Appui sur un bouton de validation | `impactAsync(Medium)` | scale 0,97, fond `bgPressed` |
| Réponse acquittée par le daemon | `notificationAsync(Success)` | bouton en `status.success`, coche |
| Réponse refusée pour hash différent | `notificationAsync(Warning)` | état `hash_mismatch`, section 6.4 |
| Réponse en échec réseau | `notificationAsync(Error)` | bandeau `status.error` dans la barre |
| Message envoyé | `impactAsync(Light)` | champ vidé, bulle optimiste |
| Tap sur le composer verrouillé par un prompt ouvert | `selectionAsync()` | la barre de validation pulse (scale 1,00 vers 1,02 vers 1,00, 220 ms), le clavier ne s'ouvre pas |
| `Répondre autrement`, refus envoyé puis composer déverrouillé | `notificationAsync(Success)` au retour du daemon | pastille caption `Refus envoyé, explique à Claude` au dessus du composer, clavier ouvert |
| Message acquitté | aucun | le cercle creux devient une coche, fondu 160 ms |
| Premier tap sur `approve_always` | `impactAsync(Rigid)` | le bouton se transforme en confirmation |
| `Interrompre` (barre, carte `EN ATTENTE`, **ligne `TRAVAILLE`**, ou notification) | `impactAsync(Heavy)` | flash 100 ms en `action.interrupt.border`, puis libellé `Interrompu` en `status.success` 1200 ms |
| `^C` (fin de l'appui long) | `impactAsync(Heavy)` | anneau de progression complet puis flash |
| Copie de code ou de chemin | `impactAsync(Light)` | label `Copié` pendant 1200 ms |
| Dépliage d'un bloc d'outil | `selectionAsync()` | rotation du chevron 160 ms |
| Changement de vue (Chat / Term / Fich) | `selectionAsync()` | glissement horizontal 220 ms |
| Chip de touche spéciale ou de pavé numérique | `impactAsync(Light)` | flash `accent.primary` 100 ms |
| Passage working vers awaiting, app ouverte | séquence dédiée, section 6.1 | section 6.1 |
| Fin de tâche, app ouverte | `notificationAsync(Success)` | section 6.2 |
| Dégradation directe vers relayée | **aucune** | section 6.3 |
| Passage en `Mac injoignable` ou `Hors ligne` | `impactAsync(Rigid)`, **une seule fois** | section 6.3 |
| Retour à la normale | aucun | pastille qui reprend sa couleur, 220 ms |
| Fichier transféré | `notificationAsync(Success)` | ligne fantôme qui se matérialise |
| Scan de QR réussi | `notificationAsync(Success)` | coins du viseur en vert |
| Tirer pour rafraîchir déclenché | `impactAsync(Light)` | spinner natif |

Il n'existe aucune haptique de suppression de fichier : il n'existe aucune suppression de
fichier (`01-prd.md` C7).

### 6.1 Passage working vers awaiting, application ouverte

Séquence exacte à partir de la réception de `pane-status {awaiting: true, paneId: 66}`.

**Cas A, Robin est sur le Chat de ce pane (le cas nominal).**

| t (ms) | Ce qui se passe |
|---|---|
| 0 | Réception. Toute animation en cours (indicateur de frappe, spinner d'outil) est **arrêtée immédiatement**, pas fondue : la vérité change, on ne laisse pas tourner un spinner mensonger |
| 0 | Haptique : **double impact**, `impactAsync(Medium)` puis, à +110 ms, `impactAsync(Heavy)`. Ce motif court puis lourd est unique dans l'app, reconnaissable dans une poche |
| 0 | Le daemon sonde `get-pane-content` et calcule le `promptHash`. Le rendu attend ce résultat : on n'affiche jamais une barre avant d'avoir la question et son hash |
| 0 à 220 | Le bloc de message contenant la question reçoit un halo : contour 1,5 pt `status.awaiting`, opacité 0 vers 1 |
| 60 à 380 | La liste défile jusqu'à ce que le bloc de la question soit à 40 pt sous la nav bar, `motion.enter`. Forcé même si l'ancrage bas était désactivé |
| 100 à 420 | La barre de validation entre en `spring.bar` depuis le bas, +64 pt vers 0. La liste se comprime simultanément, elle n'est jamais recouverte |
| 420 à 540 | Le voile d'armement se lève en 120 ms. À **500 ms**, la barre est interactive |
| 540 à 1740 | Le halo s'estompe en 1200 ms jusqu'à un contour résiduel de 1 pt, conservé tant que la question est ouverte |
| en continu | Le timer "il y a Ns" s'incrémente chaque seconde. À 10 min, passage en `aging` |

Total : la barre est utilisable 500 ms après l'événement, la question est lisible dès 380 ms.
Aucun son, aucune notification : l'app est déjà là.

**Cas B, le parseur a échoué.** Même séquence jusqu'à 420 ms, mais c'est l'état `unparsable`
(section 4.3.6) qui monte. L'haptique reste le double impact : l'urgence est la même, seule la
réponse possible change. Le halo n'est pas dessiné (on ne sait pas quel bloc contient la
question).

**Cas C, Robin est sur un autre écran de l'app.**
- Haptique `notificationAsync(Warning)`, une seule fois.
- Bannière interne de 64 pt qui descend depuis la nav bar en `motion.enter` : liseré gauche 4 pt
  `status.awaiting`, `link · cc` en calloutStrong, la question sur une ligne tronquée, chevron
  droit. Elle reste 6 s, puis remonte. Balayage vers le haut pour la renvoyer.
- Tap : navigation vers le Chat du pane, en `router.replace` si on est déjà dans un `/session/*`.
- Sur l'écran Sessions, en plus : la ligne migre vers la section `EN ATTENTE` avec une animation
  de layout de 220 ms, et le compteur de section s'incrémente.

**Cas D, une seconde question arrive alors qu'une barre est déjà montée pour un autre pane.**
Le cas le plus dangereux, parce que c'est celui où on peut répondre à la mauvaise question.
- **La barre en cours n'est jamais remplacée, jamais modifiée, jamais ré-armée.** Elle continue
  de porter la question du pane courant, avec son `promptHash`.
- Une bannière interne de 64 pt annonce le second pane, exactement comme le cas C, avec un
  libellé qui nomme le projet : `automation-demo attend aussi`.
- Le compteur de la section `EN ATTENTE` s'incrémente, et le badge d'icône passe à 2.
- Un tap sur la bannière navigue vers le second pane : la barre courante sort en `motion.exit`,
  la nouvelle entre en `entering` avec sa propre fenêtre d'armement de 400 ms. Il n'existe aucun
  chemin où deux barres coexistent, et aucun chemin où une barre change de question sous le
  pouce sans repasser par l'armement.
- Haptique : `impactAsync(Light)` seulement, plus discret que le double impact du cas A. Robin
  est déjà en train de traiter une question, on ne l'affole pas.

**Cas E, l'app est en arrière-plan.** Aucun retour interne, la notification prend le relais
(section 4.4). À la réouverture, l'état est celui du cas A **sans rejouer les animations** : pas
de défilement animé au démarrage à froid, on arrive directement en position, barre montée, et la
fenêtre d'armement de 400 ms court à partir du premier rendu.

### 6.2 Envoi d'un message

| t (ms) | Ce qui se passe |
|---|---|
| 0 | Press-in sur le bouton d'envoi : scale 0,88, `spring.press` |
| 0 | Haptique `impactAsync(Light)` |
| 0 | Le champ se vide **instantanément** et perd sa hauteur supplémentaire s'il était multi-lignes (transition 160 ms) |
| 0 à 220 | La bulle utilisateur apparaît : translation +12 pt vers 0, opacité 0 vers 1, `motion.enter`, avec le cercle creux en `text.tertiary` |
| 0 à 220 | La liste défile en bas en parallèle, `motion.base` |
| ACK | Le cercle devient une coche, fondu 160 ms. Aucune haptique : un accusé de réception normal ne mérite pas de vibration |
| ACK + 400 | Si `pane-working: true` remonte, l'indicateur de frappe apparaît |
| échec (4 s) | Point d'exclamation `status.error`, contour 1 pt `status.error` sur la bulle, toast "Envoi impossible" 2 s. Tap sur la bulle pour renvoyer |

### 6.3 Dégradation de la liaison

A11 supprime l'écouteur LAN : il n'existe plus de bascule LAN vers Tailscale, ni dans le code, ni
dans l'interface. Ce qui existe est la nature de la liaison Tailscale, `directe` ou `relayée`, et
la perte de liaison.

**Séquence de dégradation directe vers relayée.** C'est un non-événement du point de vue de
Robin, et le design l'affirme.

| t | Ce qui se passe |
|---|---|
| 0 | Tailscale bascule le chemin en relais DERP (Robin sort de chez lui, quitte le wifi du bureau). L'app le lit dans l'état exposé par Tailscale |
| 0 | La pastille passe de `(Direct 12 ms)` à `(Relayé 48 ms)`, transition de couleur `link.direct` vers `link.relayed` en 220 ms. **Pas d'haptique, pas de modale, pas de toast, pas de bandeau** |
| 0 | Rien d'autre. Aucune reconnexion applicative, aucune file d'attente : la connexion n'a pas été perdue, seul son chemin a changé |

Justification : cela arrive plusieurs fois par jour. Le faire vibrer serait du bruit. Le fait que
rien ne casse est le vrai message (P5).

**Séquence de perte de liaison.**

| t | Ce qui se passe |
|---|---|
| 0 | Deux requêtes consécutives échouent, ou 1,5 s sans réponse |
| 0 | Pastille `(Connexion…)` en `link.connecting`, point de 8 pt en `motion.pulse`. Liseré de 2 pt `link.connecting` en haut de la zone de contenu. **Aucune haptique à ce stade** |
| 0 à 5 s | 3 tentatives, backoff 300 ms, 1 s, 3 s. Les envois de messages partent en file, avec le cercle creux sur les bulles. Aucun message d'erreur affiché |
| succès avant 5 s | Retour à `(Direct)` ou `(Relayé)` en 220 ms, liseré effacé, file vidée dans l'ordre, chaque bulle passant du cercle à la coche avec 80 ms de décalage pour rendre la progression lisible. Réabonnement au flux d'événements, `list-panes` de réconciliation, resynchronisation du transcript depuis le dernier offset. Aucune haptique : le retour à la normale n'a pas besoin d'être annoncé |
| 5 s, l'iPhone **a** du réseau (`expo-network`) | Pastille `(Mac injoignable)` en `link.macUnreachable`. Bandeau 32 pt : `Mac endormi ou éteint, dernier état à 14:32`, bouton `Réessayer`. Haptique `impactAsync(Rigid)`, **une seule fois, jamais répétée** |
| 5 s, l'iPhone **n'a pas** de réseau | Pastille `(Hors ligne)` en `link.offline`. Bandeau : `iPhone hors ligne, dernier état à 14:32`. Même haptique unique |
| dans les deux cas | La barre de validation, si elle était montée, se replie en `unavailable`. Le composer reste actif en mode file. La barre de touches du terminal se désactive. Les écritures de fichiers sont désactivées |
| ensuite | Tentatives toutes les 15 s en arrière-plan, plus une tentative immédiate à chaque retour au premier plan et à chaque changement de réseau |

La distinction entre les deux libellés à 5 s est le seul moyen pour Robin de savoir s'il doit
chercher du réseau ou renoncer. Les confondre sous un unique `Hors ligne` est le défaut que cette
passe corrige.

### 6.4 Refus pour `promptHash` différent

Le cas où le produit sauve Robin d'une erreur. Il doit être lisible et rassurant, pas alarmant.

| t (ms) | Ce qui se passe |
|---|---|
| 0 | Tap sur `Oui`, Face ID, envoi. La barre est en `sending` |
| ACK négatif | Le daemon répond `stale_prompt`. Haptique `notificationAsync(Warning)` |
| 0 à 220 | Le spinner du bouton disparaît, le badge de numéro revient, tous les boutons reprennent leur remplissage normal |
| 0 à 260 | Un bandeau interne de 40 pt descend en haut de la barre, fond `status.awaiting` à 14 %, texte `status.awaiting` bodyStrong : `La question a changé. Ta réponse n'a pas été envoyée.` |
| 100 à 320 | La question, le détail et les boutons sont remplacés par les nouveaux, en fondu croisé de 220 ms. Le nombre de boutons peut changer, le gabarit est recalculé |
| 320 à 720 | Nouvelle fenêtre d'armement de 400 ms, voile à 0,55 qui se lève. La barre redevient interactive à 720 ms |
| 5 s | Le bandeau remonte en `motion.exit`. La barre reste dans son nouvel état |

Le texte dit deux choses, et les deux comptent : ce qui s'est passé, et le fait que rien n'est
parti. Sans la seconde phrase, Robin repose son téléphone en croyant avoir répondu.

---

## 7. Accessibilité

### 7.1 Cibles tactiles

| Élément | Taille |
|---|---|
| Minimum absolu | 44 x 44 pt (`hitSlop` autorisé pour l'atteindre) |
| Boutons de la barre de validation | 60 pt de haut, largeur = (largeur d'écran - 32 - 12) / 2, soit 174,5 pt sur 393 pt |
| Option de portée durable | 48 pt de haut, pleine largeur |
| Option en liste (gabarit C) | 56 pt de haut, pleine largeur |
| Bouton `Ouvrir` d'une carte en attente | 60 pt de haut, pleine largeur de carte |
| Lien `Interrompre` | 44 pt de haut effectif via `hitSlop`, 32 pt visuels |
| Lignes de liste (Sessions, Fichiers) | 60 à 64 pt |
| Chips de touches spéciales et pavé numérique | 40 x 36 visuels, 40 x 48 effectifs |
| Bouton d'envoi | 44 x 44 |
| Espacement minimal entre deux cibles distinctes | 8 pt, 12 pt dans la barre de validation |

### 7.2 Contrastes (WCAG AA, calculés)

| Paire | Ratio | Seuil |
|---|---|---|
| `text.primary` sur `bg.base` | 15,3:1 | AAA |
| `text.secondary` sur `bg.base` | 7,6:1 | AAA |
| `text.tertiary` sur `bg.base` | 5,2:1 | AA |
| `status.awaiting` sur `bg.base` | 10,6:1 | AAA |
| `text.onFill` sur `action.approve.bg` | 4,9:1 | AA |
| `text.onFill` sur `action.reject.bg` | 6,6:1 | AA |
| `action.always.text` sur `action.always.bg` | 9,1:1 | AAA |
| `action.neutral.text` sur `action.neutral.bg` | 12,1:1 | AAA |
| `action.interrupt.text` sur `bg.overlay` | 8,3:1 | AAA |
| `diff.addText` sur `diff.addBg` | 8,9:1 | AAA |
| `diff.delText` sur `diff.delBg` | 7,2:1 | AAA |

`text.disabled` (`#5A616D`, 2,9:1) est **interdit pour tout texte porteur d'information**. Il ne
sert qu'aux états désactivés, où l'information est portée par un libellé explicite
(`Mac injoignable`, `Indisponible`).

Aucune information n'est portée par la couleur seule (P4) : chaque état d'agent a une glyphe,
chaque ligne de diff a un préfixe caractère, chaque état d'envoi a un glyphe distinct, chaque
état de liaison a un libellé texte. Vérification obligatoire avant chaque livraison : l'app doit
rester utilisable avec le filtre `Niveaux de gris` d'iOS.

Cas particulier de la barre de validation : approuver et refuser doivent rester distinguables
sans couleur. Ils le sont par leur **badge de numéro** et par leur **libellé**, jamais seulement
par leur teinte. C'est aussi la raison pour laquelle la position dérive de l'index (P3).

### 7.3 Dynamic Type

- Les échelles `display` à `caption` utilisent `allowFontScaling: true` avec un
  `maxFontSizeMultiplier` de **1,6** (utilisable jusqu'à `AX3`).
- Les échelles `mono.*` ont `allowFontScaling: false`, taille fixée en dur (C17 : plus de réglage
  exposé). Raison : mettre du code à l'échelle casse l'alignement des colonnes et des diffs.
- Au delà du multiplicateur **1,3**, la barre de validation bascule automatiquement du gabarit B
  vers le **gabarit vertical** (une option par ligne, 60 pt, zone défilante). Les labels d'option
  ne sont jamais tronqués au delà de 1,3 : ce sont les seuls textes de l'app dont la troncature
  serait dangereuse.
- Le `body` de la bannière de notification suit Dynamic Type nativement. Si la question ne tient
  pas, iOS la tronque avec une ellipse et la bannière développée (appui long) la montre en
  entier. C'est acceptable : approuver depuis une bannière compacte tronquée reste possible, mais
  la question développée est toujours à un appui long.
- Les hauteurs de ligne passent de 60 pt à `max(60, hauteur du contenu + 16)`.
- Les cibles ne rétrécissent jamais quand la police grandit.
- Test de non-régression obligatoire à `xSmall`, `Large` (défaut), `xxxLarge` et `AX3`.

### 7.4 VoiceOver

Éléments critiques, libellés exacts.

| Élément | `accessibilityLabel` | `accessibilityHint` | Rôle et traits |
|---|---|---|---|
| Bouton d'option de la barre | `Option {index}, {libellé}` par exemple `Option 1, Oui` | `Envoie l'option 1 à Claude sur le pane link cc` | `button` |
| Option de refus | `Option 3, Non` | `Refuse et rend la main à Claude` | `button` |
| Option de portée durable | `Option 2, Oui et ne plus redemander. Action à portée durable, demande une confirmation` | `Double-tapez, puis confirmez` | `button` |
| Après le premier tap | `Confirmer, ne plus redemander` | `Double-tapez pour confirmer` | `button`, `accessibilityLiveRegion: assertive` |
| Barre de validation (conteneur) | `Autorisation requise. {question} {détail}. {n} options.` | | Le focus VoiceOver y est **déplacé automatiquement**, après le délai d'armement de 400 ms, jamais avant |
| Barre en `unparsable` | `Validation requise. Une question attend sur le Mac, les options n'ont pas pu être lues. Aucune option proposée.` | | Le focus va sur le bouton `Ouvrir le terminal` |
| Barre en `hash_mismatch` | `La question a changé. Ta réponse n'a pas été envoyée. Nouvelle question : {question}. {n} options.` | | `accessibilityLiveRegion: assertive`, focus redéplacé après le nouvel armement |
| Bouton `Interrompre` | `Interrompre l'agent` | `Envoie Échap au pane, sans confirmation` | `button` |
| Carte de session en attente | `link, cc, en attente depuis 2 minutes. {question tronquée}` | `Double-tapez pour ouvrir la session et répondre` | `button` |
| Bouton `Ouvrir` d'une carte | `Ouvrir la session link cc` | | `button` |
| Ligne en cours | `Notes, claude, en cours. Dernière action, Read todo point m d.` | | `button` |
| Ligne inactive | `automation-demo, n8n, inactif depuis 3 heures.` | | `button` |
| En-tête `FERMÉES` | `Sessions fermées, 62, replié` | `Double-tapez pour déplier` | `button`, `accessibilityState: {expanded: false}` |
| Pastille de liaison | `Connexion directe, latence 12 millisecondes` / `Mac injoignable, dernier état à 14:32` / `iPhone hors ligne` | `Double-tapez pour ouvrir les réglages` | `button` |
| Bulle utilisateur | `Vous, 14:32. {texte}. Envoyé.` | | `text` |
| Bulle assistant | `Claude, 14:33. {texte}` | | `text` |
| Bloc d'outil replié | `Outil Read, 00-context point m d, 184 lignes. Replié.` | `Double-tapez pour déplier` | `button`, `accessibilityState: {expanded}` |
| Bloc de code | `Bloc de code TypeScript, 42 lignes` | `Balayez vers le haut pour copier` | `text` plus `accessibilityActions: [{name:'copy', label:'Copier'}]` |
| Ligne de diff | `Ligne 119, supprimée. {contenu}` puis `Ligne 119, ajoutée. {contenu}` | | `text`. Le préfixe `ajoutée` / `supprimée` est **toujours annoncé** |
| Chip de touche | `Touche Échap` / `Touche Contrôle, désactivée` | | `button`, `accessibilityState: {selected}` pour le Ctrl collant |
| Chiffre du pavé numérique | `Chiffre 2` | `Envoie 2 au terminal` | `button` |
| Vue terminal | `Terminal du pane cc` | `Contenu terminal, exploration par ligne` | Contenu exposé ligne par ligne via l'`accessibilityTree` du WebView, option `screenReaderMode` de xterm.js activée |
| Fil d'Ariane | `Chemin, tilde, personal-tools, link. Dossier courant, link` | | Chaque segment est un `button` distinct |
| Ligne de fichier | `capture point p n g, image, 882 kilooctets, modifié il y a 5 minutes` | `Double-tapez pour l'aperçu` | `button` |

**Actions de notification et VoiceOver.** Les catégories étant statiques (C25), les libellés de
boutons sont des **chiffres**. Lus seuls, `1`, `2`, `3` ne veulent rien dire, ce qui serait
inacceptable. La correction tient en un point : le `body` de la bannière est lu **avant** les
actions, et il contient la liste numérotée des options écrite par la NSE. VoiceOver énonce donc,
dans cet ordre :

`Link attend ta validation. link, cc, Edit. Autoriser Edit sur 02-design point m d ? Modifie 42
lignes, supprime 3. 1. Oui. 2. Oui, et ne plus redemander. 3. Non.` puis les boutons `1`, `2`,
`3`, `Interrompre`.

Chaque bouton porte de plus un `accessibilityLabel` statique qui rappelle son rôle sans prétendre
connaître le libellé : `Option 1`, `Option 2`, `Option 3`, `Interrompre l'agent`. Le sens exact
vient du corps, jamais du bouton, exactement comme pour un lecteur voyant.

Sur l'état 3 (bannière non récupérée), VoiceOver lit `Validation requise. La question n'a pas pu
être récupérée. Ouvre l'app pour la lire.` puis les deux seules actions disponibles, ce qui rend
l'absence d'approbation évidente à l'oreille.

**Aucune action de saisie vocale ou textuelle depuis une notification** (C26) : il n'existe donc
aucun champ de texte à annoncer sur l'écran verrouillé.

**Annonces dynamiques** (`AccessibilityInfo.announceForAccessibility`) :

| Déclencheur | Annonce | Politesse |
|---|---|---|
| Passage en `awaiting`, app ouverte, cas A | `Claude attend ta validation sur link cc` puis déplacement du focus sur la barre | assertive |
| Passage en `awaiting`, parseur en échec | `Une question attend sur link cc, les options ne sont pas lisibles` | assertive |
| Second `awaiting` pendant qu'une barre est montée (cas D) | `automation-demo attend aussi` | polite, sans déplacer le focus |
| Réponse acquittée | `Réponse envoyée, option 1, Oui` | polite |
| Refus pour hash différent | `La question a changé, ta réponse n'a pas été envoyée` | assertive |
| Fin de tâche | `Claude a terminé sur link cc` | polite |
| Liaison directe vers relayée | `Connexion relayée` | polite |
| Passage en `Mac injoignable` | `Mac injoignable, dernier état à 14:32` | assertive |
| Passage en `Hors ligne` | `iPhone hors ligne, dernier état à 14:32` | assertive |
| Message envoyé | rien, le changement d'état de la bulle suffit | |

**Autres réglages système respectés :**
- `Réduire les animations` : section 2.7. La fenêtre d'armement de 400 ms **reste active**, elle
  est une protection, pas une animation.
- `Réduire la transparence` : `bg.overlay` et `bg.scrim` deviennent opaques.
- `Contraste élevé` : `border.subtle` passe à `border.strong`, `text.tertiary` passe à
  `text.secondary`, les contours de bouton passent de 1 à 1,5 pt.
- `Formes de bouton` : les liens textuels (`Répondre autrement`, `Interrompre`) reçoivent un
  soulignement.
- `Boutons on/off avec libellés` : les 3 interrupteurs des Réglages affichent `I` et `O`.
- `AssistiveTouch` et `Contrôle de sélection` : l'ordre de focus de la barre de validation suit
  l'index des options, jamais l'ordre visuel des colonnes, pour que le balayage séquentiel et le
  badge de numéro concordent.

---

## 8. Inventaire des composants et découpage par lot

### Lot 1, "l'agent a fini, je donne la suite" (C36)

Chaîne complète : la notification arrive, Robin ouvre, **lit le dernier échange**, envoie
l'instruction suivante, et peut interrompre à tout moment. La barre de validation est incluse,
mais elle sert un chemin devenu rare.

| # | Composant | Écrans | Pourquoi il est en lot 1 |
|---|---|---|---|
| 1 | `TranscriptView` : `MessageBubble` (Markdown de base, regroupement par `requestId`, A16) et `ToolBlock` (en-tête, état, repli, contenu déplié en texte brut) | 4.2 | **C'est l'écran central du produit.** Sans lui, Robin ne sait pas ce que l'agent a fait et ne peut pas donner la suite |
| 2 | `Composer` (trois régimes de vérification d'état, file d'attente revalidée, sans dictée maison) | 4.2, 4.6 | C'est par là que passe le geste de tous les jours |
| 3 | `NotificationServiceExtension` (récupération sur `GET /v1/prompt/{promptRef}`, réécriture du corps, **catégories statiques**, 3 états) | 4.4 | C'est ce qui prévient Robin, et le seul endroit où la question peut manquer |
| 4 | `InterruptAction` (message `pane.interrupt`, quatre surfaces, aucune authentification) | 4.1, 4.3.7, 5.3 | Rétabli en lot 1 par C21 et C32. C'est le cas S4 |
| 5 | `SessionRow` et `AwaitingCard` (`Ouvrir` primaire, `Interrompre` secondaire, aucun bouton d'approbation) | 4.1 | La porte d'entrée |
| 6 | `ValidationBar` avec `OptionButton`, `ArmingVeil`, et ses 13 états dont `unparsable` et `hash_mismatch` | 4.3 | Conservée intégralement, chemin rare depuis C36 |
| 7 | `PromptClient` (récupération de la question, calcul et transport du `promptHash` sur la charge décisionnelle complète) | 4.3, 4.4 | Le garde-fou de C20 |
| 8 | `LinkPill` (5 états de liaison) | toutes | P5 |
| 9 | `StatusGlyph` (awaiting, working, idle, closed) | 4.1, 4.2 | P4 |
| 10 | `MonospaceFallback` (environ 30 lignes) et `NumericKeypad` | 4.6 | Repli obligatoire de A6.2 et destination de l'état `unparsable` |
| 11 | `QRScanner` et `PairingChecklist` (4 étapes, expiration 3 min) | 4.9 | Sans appairage, rien ne fonctionne |
| 12 | `SettingsList` (**4 entrées**) et `ActivityBlock` (5 valeurs en lecture seule) | 4.10 | A1, A13, C17, C28 |
| 13 | `EmptyState`, `ErrorState`, `SkeletonList`, `InAppBanner` | toutes | Les états dégradés sont la moitié du travail |

### Lot 2, "le confort de lecture et le repli terminal"

| # | Composant | Écrans |
|---|---|---|
| 14 | `CodeBlock` (coloration syntaxique, bouton de langue) | 4.2 |
| 15 | `DiffBlock` (gouttière, hunks teintés, numéros collants) | 4.2 |
| 16 | `SubAgentBlock` (jointure par `toolUseId`, A16) | 4.2 |
| 17 | `TranscriptPagination` (historique au delà du dernier échange) | 4.2 |
| 18 | `TerminalView` (WebView, xterm.js, resynchronisation, budget 2 Mo) | 4.6 |
| 19 | `SpecialKeysBar` (Ctrl collant, répétition, type énuméré) | 4.6 |
| 20 | `ClosedSessionRow` et écran `4.11` | 4.1, 4.11 |
| 21 | `SegmentedViewSwitcher` | session |

### Lot 3, "les fichiers"

| # | Composant | Écrans |
|---|---|---|
| 22 | `Breadcrumb` | 4.7 |
| 23 | `FileRow`, `FilePreviewSheet`, mode sélection multiple | 4.7 |
| 24 | `TransferProgress` (flux, reprise, avertissement cellulaire) | 4.7, 4.8 |
| 25 | `ShareTargetPicker` | 4.8 |

Rien n'est supprimé du projet. Le lot 1 est la plus petite chaîne bout en bout démontrable
(A3, C15, C36), les lots 2 et 3 sont ordonnés derrière (C16).

**Ce qui a bougé entre la passe 2 et la passe 3 :** le rendu du transcript est passé du lot 2 au
lot 1 et a pris la tête de l'inventaire, l'interruption est revenue en lot 1 comme composant de
premier ordre, et la NSE a perdu ses catégories dynamiques. Le lot 1 est donc plus gros
qu'annoncé en passe 2, et ce document ne prétend pas l'inverse (C33).

---

## 9. Conformité aux arbitrages

| Réf | Décision | Où ce document l'applique |
|---|---|---|
| A1 | Anti-veille IOKit tant qu'un pane travaille, interrupteur exposé | 4.10, réglage 3 `Garder le Mac éveillé`, avec la note capot fermé |
| A2 | Face ID sur approuver uniquement, rien sur refuser et interrompre | 4.3.3 tableau unique, 4.4.5 (avec la conséquence assumée d'une catégorie statique), 4.1 (`Interrompre` sans authentification) |
| A3 | Ordre A puis B puis C | Section 8, lots 1, 2, 3 ; marqueurs de lot sur chaque écran de la section 4 |
| A4 | Aucun plafond de fichier, flux et reprise, avertissement au delà de 100 Mo en cellulaire | 4.7 Transferts, 4.8 ligne `Poids` |
| A5 | Rendu chat réservé à `agent == "claude"`, repli terminal explicite | 4.2 état `Agent non-Claude`, bandeau et bouton, jamais un écran vide |
| A6 | Prompt lu dans `get-pane-content` déclenché par `awaiting`, parseur défensif, `promptHash` revérifié | 4.3.1 contrat complet, 4.3.6 état `unparsable`, 4.3.5 état `hash_mismatch`, 6.4 séquence |
| A7 | Aucun bouton d'approbation sur l'écran Sessions, `Interrompre` autorisé | 4.1 carte en attente, `Ouvrir` 60 pt primaire et `Interrompre` secondaire ; P3 |
| A8 | État "détecté mais non parsable" de premier ordre, aucun bouton deviné | 4.3.6, section entière avec wireframe, déclencheur, sortie et comptage |
| A9 | v1 sombre uniquement, tokens clairs conservés | 2.1 marquée "seul câblé en v1", 2.2 marquée "spécifié, non câblé" |
| A10 | Authentification des actions rapides résolue par A2 | 4.4.5 tableau |
| A11 | Écouteur LAN supprimé, indicateur direct ou relayé | 2.1 tokens `link.*`, 4.1 pastille, 4.9 QR à une seule adresse, 6.3 réécrite en dégradation directe vers relayée |
| A12 | `tailscale cert`, plus d'épinglage SPKI | 4.9 étape `Certificat valide`, QR sans empreinte, 4.4.4 requête TLS validée par la chaîne système |
| A13 | Assertion sur `working: true`, plafond 4 h | 4.10 réglage 3, sous-titre "4 h max" |
| A14 | Aucun extrait de transcript dans la charge utile | 4.4.2 charge utile neutre en toutes circonstances, 4.4.1 justification, 5.2 règle. L'interrupteur prévu par A14 est **supprimé** par C28, décision postérieure : la NSE récupérant toujours la question sur le canal direct, la charge utile n'a jamais besoin de contenu sensible, donc l'intention de A14 est tenue sans réglage |
| A15 | `mode: "scrollback"` interdit, resynchronisation, purge des `.raw` orphelins | 4.6 Interactions et Reprise après déconnexion, budget de rejeu 2 Mo |
| A16 | Regroupement par `requestId`, `usage` jamais sommé, sous-agents joints par `toolUseId` | 4.2 bulle assistant et bloc d'outil |

| Réf `07-corrections.md` | Où ce document l'applique |
|---|---|
| C1 | 4.3.1 points 1, 4 et 5, plus la conséquence de design sur le badge |
| C3 | 4.3.6 entière |
| C4 | 4.4 entière, trois états spécifiés |
| C5 | 4.7 état `Écriture refusée` |
| C6 | 4.5 Filtrage, 4.6 type énuméré des touches |
| C7 | 4.6 : aucune commande `dispatch-action` n'est utilisée par un écran de ce document |
| C8 | 4.9 expiration du QR à 3 min, stockage Keychain, jeton jamais journalisé ; 4.10 révocation immédiate |
| C9 | 4.2 et 4.6 état "cette session n'existe plus", cas `ok:true` avec `not found` modélisé |
| C11 | 4.2 : de 1 à 5 blocs par `requestId`, aucune hypothèse |
| C12 | 4.2 : tout type de ligne inconnu ignoré silencieusement |
| C13, C35 | 4.6 budget de rejeu **2 Mo** et ligne `reprise, historique tronqué` |
| C15, C16 | Section 8 et marqueurs de lot |
| C17, C28 | 4.10 : **4 entrées interactives** plus le bloc `Activité` en lecture seule, table des valeurs figées, écrans retirés |
| C18 | 4.7 : aucune action `mkdir`, `move`, `delete` dans aucun menu |
| PRD C7 | 4.7 : lecture, téléchargement, envoi. Rien d'autre |
| B13 | Cette section remplace l'ancienne section 9, qui rouvrait des arbitrages tranchés |

| Réf `08-corrections-passe2.md` | Où ce document l'applique |
|---|---|
| C20 (éliminatoire) | 4.3.1, table de ce qui entre dans le `promptHash` (question normalisée, libellés ordonnés, nombre d'options, **bloc de détail complet**, `paneId`) et table de ce qui en est exclu, avec la justification de chaque exclusion. Recalcul juste avant émission |
| C21, C32 (éliminatoire) | `pane.interrupt {paneId}` comme opération de premier ordre, en lot 1. Quatre surfaces : carte `EN ATTENTE` et **ligne `TRAVAILLE`** (4.1), barre de validation (4.3.7), notification (5.3). Aucune authentification, contrat unique énoncé en 4.1 |
| C23 (éliminatoire) | 4.3.1 point 6, 4.3.3 table des trois régimes de texte libre, 4.5 table de vérification d'état du composer, revalidation de la file d'attente à la reprise |
| C24 | 4.4.2 : `GET /v1/prompt/{promptRef}`, référence opaque à usage unique non dérivée du `paneId`, jeton court dédié à la NSE |
| C25 | 4.4.3 entière : catégories pré-enregistrées statiquement, boutons portant les chiffres, corps réécrit par la NSE avec la liste numérotée. L'hypothèse de ré-enregistrement dynamique est abandonnée et le motif est écrit |
| C26 (éliminatoire) | 4.4.7 première ligne, 5.3 paragraphe dédié : plus aucune saisie de texte libre depuis une notification, ni `Répondre…`, ni `Continuer…`. 7.4 note VoiceOver |
| C27 | 4.4.4 état 3 : `KL_AWAITING_BLIND`, `Interrompre` et `Ouvrir`, aucune action d'approbation, ouverture forcée. Nom de catégorie unique |
| C28 | 4.10 : réglage `Extraits dans les notifications` supprimé, 4 entrées, ligne ajoutée à la table des valeurs figées |
| C29 | 5.1 : seuil N2 à **60 s**, valeur unique du document |
| C30 | 4.4.3 : ordre de déclaration normatif, budget de 4 actions, `Ouvrir` hors budget, table par nombre d'options et arithmétique du cas à 4 options |
| C31 | 4.1 : `Muter` retiré du balayage et du menu contextuel. 4.10 table des valeurs figées. 5.4 dernière ligne |
| C22 | 4.2 : `queue-operation` ignoré, jamais rendu, avec la mesure du panel |
| C33 | Section 8 : le lot 1 a absorbé le rendu du transcript et l'interruption, et le document le dit au lieu de maintenir une estimation flatteuse |
| C34 | 4.2 : aucun mécanisme de récupération par marqueur `Full output saved to:` |
| C35 | 4.6 : budget de rejeu **2 Mo**, valeur unique |
| C36 | Section d'ouverture "Changement de prémisse", 4.2 promue écran central et passée en lot 1, 4.5 deuxième par ordre d'importance, 4.3 conservée mais chemin rare, section 8 réordonnée, 5.1 note sur N2, 4.10 réglage 1 à OFF |
| C37 | 4.3.1 avertissement de méthode, 4.3.6 `unparsable` déclaré comportement attendu par défaut avec la procédure de capture d'un prompt réel |
