# Revue technique et sécurité, KovaLink, passe 3

> Relecteur : staff engineer, axe technique et sécurité du panel.
> Livrables notés : `03-architecture.md` (2 305 lignes), avec `01-prd.md` (833) et
> `02-design.md` (2 543) relus pour la cohérence croisée.
> Ordre de correction appliqué : `08-corrections-passe2.md`.
> Vérifications machine faites en lecture seule le 2026-09-10, instance Kova PID 85882.
> Aucune commande IPC mutante, aucun `send-keys`, aucun pane touché.
> Passe 1 : 6,65. Passe 2 : 8,48. Les deux fois, NE PASSE PAS.

**Méthode.** Comme aux passes précédentes, aucune annonce de correction n'a été prise pour argent
comptant. Pour C20, C21 et C23 j'ai cherché le mécanisme, puis j'ai cherché le contournement. J'ai
en plus audité pour la première fois le catalogue de notifications dans les **trois** documents en
parallèle, ce que je n'avais pas fait en passe 2, et j'ai testé sur la machine la prémisse qui
fonde le nouveau lot 1.

---

## 1. Évolution depuis la passe 2

### Mes deux défauts lourds

| # | Défaut de la passe 2 | État | Ce que j'ai vérifié |
|---|---|---|---|
| **1** | Le `promptHash` ne couvre pas le `detail`, donc deux demandes `Bash` consécutives produisent le même hash | **Corrigé, et bien corrigé** | `hashPrompt(question, detail, options)` en 2.3. Canon préfixé (`Q:`, `D{i}:`, `O{index}:`) et joint par `\n`, ce qui écarte aussi les collisions de frontière de champ que la concaténation nue de la passe 2 laissait ouvertes. La règle générale est écrite en tête : *"tout ce qui est affiché à Robin pour qu'il décide entre dans le hash, et rien de ce qui n'entre pas dans le hash n'est affiché"*, et le type `Prompt` porte exactement les trois champs hachés. Table d'exclusion avec une justification par ligne, comme demandé. Critère d'acceptation 13 du lot 1 : *"deux demandes `Bash` consécutives portant des commandes différentes produisent deux `promptHash` différents"*. Rien à redire. |
| **2** | L'interruption, P0 lot 1, sans message, sans route, sans action de notification | **Corrigé de bout en bout** | `PaneInterrupt` marqué **L1** (2.8), `POST /v1/panes/:paneId/interrupt`, `KeyGate.emitInterrupt` qui émet exactement `0x1b` une fois et jamais Ctrl-C, action `interrupt` avec `isAuthenticationRequired: false` dans **toutes** les catégories, bouton sur la carte de liste (PRD A1) et dans la session, limitation de débit dédiée, entrée d'audit. Le document justifie même explicitement pourquoi il crée un message dédié plutôt que de promouvoir `pane.sendKeys` : *"la promouvoir en L1 ramènerait `enter` et les chiffres au lot 1"*. C'est exactement le raisonnement que j'attendais. |

Sur le second garde-fou demandé en complément de C20 : `awaitingSince` est bien reporté dans
`PaneAnswer` et comparé à `pane.awaiting_since` **avant** la relecture. Les deux gardes sont
réellement indépendants : le hash couvre le changement de contenu à occurrence constante,
`awaitingSince` couvre le changement d'occurrence à contenu constant. Ils ne peuvent pas échouer
ensemble sur le scénario visé, qui suppose que `awaiting` est retombé entre les deux demandes.
Réserve honnête, portée en 6.7 : le document scope correctement sa propre affirmation
(*"dès lors que `awaiting` est retombé entre les deux"*), mais la sémantique de mise à jour de
`awaiting_since` par Kova sur deux prompts successifs n'est mesurée nulle part, et je n'ai pas pu
l'observer (voir W5).

### Mon défaut sur les chemins résiduels (C23)

**Corrigé, et c'est la meilleure correction du lot.** Les trois chemins sont fermés par une garde
commune, `hasParsedPromptPending(paneId)`, et le périmètre est enfin énoncé sans raccourci.

| Chemin de la passe 2 | Fermeture vérifiée en 2.4 |
|---|---|
| Second appel de `pane.sendText` | `hasParsedPromptPending` évalué **avant chaque** des deux appels. Si l'agent a basculé entre les deux, le `\r` ne part pas, la réponse est `became_awaiting`, et le prompt est poussé au client. Le commentaire du code cite la fenêtre de 16 ms et la rattache explicitement à C1.3. |
| `sendKeys(['enter'])` | `emitKeys` refuse en `FORBIDDEN_KEY` si la séquence contient une touche de `DECIDING` et qu'un prompt parsé est en attente. |
| `term.input(['enter'])` | Passe par le **même** `emitKeys`. Le type ne transporte plus de string depuis la passe 2, et il partage désormais aussi la garde d'état. |

Le point que j'estimais le plus dur, la ligne de démarcation avec le repli de A6, est traité
juste : quand le prompt est `unparsable`, la garde est **fausse** et tout passe, parce que c'est
le seul moyen qui reste à Robin de débloquer sa session. Interdire aurait été plus simple à
écrire et faux à l'usage.

Le périmètre annoncé est-il vérifiable ou une affirmation déguisée ? **Vérifiable pour moitié.**
Le test qui compte les appelants de `ipc.sendKeys` est un vrai filet, implémentable et binaire.
La règle de lint annoncée, elle, ne fait pas ce qu'elle prétend : voir 6.1, c'est une correction
d'une ligne et non bloquante.

### Mes deux points partiellement corrigés de la passe 2

| # | Point | État |
|---|---|---|
| **V5** | `queue-operation` rendu en bulle utilisateur sur une lecture fausse des données | **Corrigé, sur ma mesure exacte.** Les trois documents portent maintenant "ignoré, jamais rendu" avec le relevé (20 entrées, 11 blocs `<task-notification>`, 9 `content: null`, zéro message de Robin). PRD CA-41 en fait un critère binaire. La correction est allée dans le bon sens, celui de la mesure, pas celui de l'hypothèse la plus flatteuse. |
| **V7** | Marqueur `Full output saved to:` inexistant dans les données | **Corrigé, et de la bonne façon.** V12 en section 0 documente l'absence, le mécanisme est retiré, **aucune route ne promet plus ce contenu**, le bloc porte `truncated: true, retrievable: false` et l'app affiche "résultat complet non récupérable, voir sur le Mac". Le document écrit : *"tant qu'elle n'est pas trouvée, on ne spécifie pas une route qui échouera"*. C'est la bonne discipline : mieux vaut un état honnête qu'un bouton mort. |

### Le basculement de prémisse (C36), qualité du basculement

Noté sur sa qualité, non sur son opportunité, qui est tranchée.

**Ce qui est bien fait.** La section 0.1 est courte, elle sépare nettement ce qui change de ce
qui ne change pas, et elle rattache la décision à la mesure V11 plutôt qu'à une intuition. Le
parseur est explicitement requalifié en **hypothèse** (*"la grammaire ci-dessous est une
hypothèse, pas une mesure, et le document ne la présente pas autrement"*), il est isolé dans un
fichier unique avec des fixtures versionnées, et l'état `unparsable` devient le comportement
**attendu** et non un cas d'erreur. Surtout, les critères d'acceptation du lot 1 sont scindés en
dix exécutables et six **explicitement déclarés non exécutables**, avec la procédure d'une
demi-heure pour les rendre exécutables. Refuser de cocher une case qu'on ne peut pas tester est
exactement le comportement qu'on attend, et c'est rare.

**Ce qui ne l'est pas.** La prémisse qui remplace l'ancienne, *"`awaiting` se lève aussi bien
quand l'agent a fini son tour"*, est énoncée deux fois comme un fait (0.1 et 5.1) et ne figure
dans **aucune** des douze mesures V1 à V12. Elle est contredite par ce que j'observe sur la
machine (W4). Le document vient de requalifier honnêtement une hypothèse en hypothèse, et
introduit dans la même section une seconde hypothèse présentée comme un fait. Défaut bloquant 1.

---

## 2. Notes par axe

| # | Axe | Poids | P1 | P2 | **P3** | Justification (une ligne) |
|---|---|---|---|---|---|---|
| 1 | Justesse du problème | 15% | 7,0 | 9,0 | **7,5** | Le pivot est bien jugé et honnêtement motivé par la mesure, mais le scénario qui devient la raison d'être du lot 1 repose sur un déclencheur non mesuré que la machine contredit, et sa bannière n'a aucun contenu spécifié côté architecture. |
| 2 | Complétude fonctionnelle | 15% | 6,0 | 8,0 | **7,5** | Interruption rétablie de bout en bout, transcript remonté en lot 1, `tool-results` traité honnêtement, replis spécifiés, mais l'architecture ne couvre ni la réécriture de la bannière de fin de tour, ni N3, ni N4, que le PRD et le Design spécifient tous les deux. |
| 3 | Qualité de l'UX mobile | 15% | 7,0 | 8,5 | **8,5** | Le Design est solide et cohérent avec lui même (catalogue N1 à N4, gabarits, Face ID, quatre réglages, `Muter` supprimé), mais il spécifie un contenu de bannière que l'architecture ne sait pas produire. |
| 4 | Solidité de l'architecture | 20% | 7,0 | 8,5 | **8,5** | `KeyGate` est enfin un vrai point d'entrée unique avec quatre opérations et une garde commune, le hash couvre la charge décisionnelle, `timingSafeEqualStr` est défini avec le piège du `RangeError` que j'avais signalé, mais `promptRef` est déclaré à usage unique alors que trois consommateurs distincts doivent le lire. |
| 5 | Sécurité | 15% | 5,0 | 8,0 | **9,0** | Mes sept failles d'origine restent fermées, C20 et C23 ferment les deux dernières voies d'approbation non protégée, `promptRef` est opaque avec un jeton NSE de portée limitée, et C26 supprime la saisie libre depuis la bannière avec la bonne justification : je ne trouve plus de faille ouverte. |
| 6 | Simplicité | 10% | 7,0 | 9,0 | **8,5** | Quatre catégories au lieu de sept, un réglage de moins, aucune route promise sur un mécanisme supposé, estimations révisées à la hausse par honnêteté, mais trois vocabulaires pour désigner les mêmes quatre objets est la pire forme de complexité. |
| 7 | Implémentabilité | 10% | 8,0 | 8,5 | **7,5** | Critères scindés exécutables et non exécutables avec la procédure, fixtures versionnées, budgets révisés, mais un ingénieur qui lit le PRD 4.4 et l'architecture 5.2 obtient deux jeux d'identifiants incompatibles sans savoir lequel enregistrer, et quatre critères d'acceptation échouent par construction. |

---

## 3. Note pondérée globale

```
Axe 1  Justesse du problème        7,5 x 0,15 = 1,125
Axe 2  Complétude fonctionnelle    7,5 x 0,15 = 1,125
Axe 3  UX mobile                   8,5 x 0,15 = 1,275
Axe 4  Solidité architecture       8,5 x 0,20 = 1,700
Axe 5  Sécurité                    9,0 x 0,15 = 1,350
Axe 6  Simplicité                  8,5 x 0,10 = 0,850
Axe 7  Implémentabilité            7,5 x 0,10 = 0,750
                                   -------------------
                          TOTAL PONDÉRÉ        8,175 / 10
```

Aucun axe sous 7. La barre de 9,0 n'est pas atteinte.

**Un mot sur la baisse par rapport à 8,48.** Elle n'est pas une régression de qualité du document,
et je ne veux pas laisser croire cela. Elle vient de deux choses. La première est une faute
d'audit de ma part : je n'avais pas croisé le catalogue de notifications entre les trois documents
en passe 2, et l'écart existait probablement déjà. Je le signale maintenant, tard, et je l'assume.
La seconde est réelle et nouvelle : le basculement de prémisse a déplacé le centre de gravité du
produit vers un scénario dont le déclencheur n'a jamais été mesuré. Tout ce que j'avais signalé en
passe 2 est corrigé, et bien corrigé.

---

## 4. Défauts bloquants

### 1. La prémisse du nouveau lot 1 n'est pas mesurée, et la machine la contredit
`03-architecture.md` 0.1 et 5.1, `01-prd.md` 4.2, `02-design.md` 5.1.

Les trois documents affirment que `pane-status.awaiting` se lève quand l'agent finit son tour.
L'architecture l'écrit deux fois comme un fait. Cette affirmation ne figure dans aucune des douze
mesures de la section 0, alors que la section 0 existe précisément pour porter ce qui est vérifié.

Mesuré (W4) : deux panes Claude ayant fini leur tour et attendant l'instruction suivante
(`working: false`, processus `claude` vivant) rapportent `awaiting: false`, `awaiting_since: null`
et surtout **`awaiting_seen: false`**, c'est à dire que Kova n'a jamais enregistré d'état
d'attente pour eux. Sur un sondage de quatre minutes de tous les panes, avec deux agents en
travail, zéro transition de `awaiting` a été observée. Le seul signal qui bouge est `working`.

Conséquences si la prémisse est fausse, et elles portent toutes sur le lot 1 :

- Le déclencheur N1 ne se lève jamais pour une fin de tour. Le seul chemin restant est N2
  (`pane-working` à `false`, sans `awaiting`), que les trois documents assortissent d'un seuil de
  **60 secondes de travail** (C29). **Tout tour de moins de 60 secondes ne produit aucune
  notification.** Or "l'agent a fini, je donne la suite" est exactement le cas des tours courts.
- Le critère d'acceptation 1 du lot 1 (*"Un agent finit son tour. Une bannière arrive en moins de
  5 s"*) échoue.
- Le sondage du `PromptParser`, déclenché sur front montant de `awaiting`, ne se déclenche jamais,
  donc la barre de validation ne s'arme jamais, y compris pour les prompts qui surviendraient en
  mode plan.

**Correction, dans l'ordre.**
1. **Mesurer avant d'implémenter.** Dix minutes, lecture seule :
   `echo '{"cmd":"subscribe","events":["pane-status","pane-working"]}' | nc -U "$KOVA_SOCKET"`,
   laisser tourner pendant qu'un agent termine un tour, et consigner les événements réels comme
   mesure **V13** en section 0. Tant que V13 n'existe pas, le lot 1 ne démarre pas : il a été
   entièrement re-cadré autour de ce signal.
2. Si `awaiting` ne se lève pas au terme d'un tour, faire de la **transition `pane-working` de
   `true` à `false`** le déclencheur de premier ordre du lot 1, et **supprimer le seuil de 60 s
   pour ce cas** (il a été fixé pour éviter le bruit des petits outils, pas pour filtrer les fins
   de tour). Le garder pour le bruit se traite autrement : un anti-rebond, ou l'exclusion des
   tours qui n'ont produit aucun bloc `text` d'assistant.
3. Retirer l'affirmation de 0.1 et 5.1 tant qu'elle n'est pas une mesure, ou la remplacer par la
   formulation prudente que le document sait employer ailleurs.

### 2. Le catalogue de notifications diverge entre les trois documents
`03-architecture.md` 5.1 et 5.2, contre `01-prd.md` 4.2 et `02-design.md` 4.4.3 et 5.1.

Le PRD porte une table intitulée **"Catégories, vocabulaire unique pour les trois documents"**.
L'architecture n'implémente **aucune** de ces catégories sous ce nom.

| Objet | PRD | Design | Architecture |
|---|---|---|---|
| Prompt à 2 options | `KL_AWAITING_2` | `KL_AWAITING_2` | **`KL_OPT2`** |
| Prompt à 3 options | `KL_AWAITING_3` | `KL_AWAITING_3` | **`KL_OPT3`** |
| Repli aveugle | `KL_AWAITING_BLIND` | `KL_AWAITING_BLIND` | **`KL_OPEN`** |
| Fin de tour (N1) | `KL_TURN_END` | absent | **absent** |
| Agent terminé (N2) | `KL_DONE`, actions `Ouvrir` | `KL_DONE`, **aucune action déclarée** | `KL_DONE`, actions `Ouvrir` **et `Interrompre`** |
| Pane fermé (N3) | `KL_CLOSED` | `KL_CLOSED`, lot 2 | **absent** |
| Reconnexion (N4) | `KL_RECONNECT` | `KL_RECONNECT`, lot 2 | **absent** |

`categoryIdentifier` est une chaîne qui doit correspondre **exactement** entre ce que l'app
enregistre via `setNotificationCategoryAsync`, ce que le daemon place dans la charge utile, et ce
que la NSE écrit. Une divergence ne produit pas une erreur : iOS affiche la bannière **sans aucun
bouton**, silencieusement. C'est le mode de panne le plus coûteux à diagnostiquer, sur le chemin
qui justifie le produit.

Conséquences immédiates, en plus du risque d'implémentation :

- **PRD CA-27** affirme que la bannière retombe sur `KL_AWAITING_BLIND` : faux par construction
  contre une implémentation conforme à l'architecture.
- **PRD CA-15** exige que la charge utile contienne exactement `project`, `pane_id`, `event`,
  `prompt_ref` et `aps`. L'architecture exclut délibérément `pane_id` (C24, et elle a raison :
  la référence opaque existe précisément pour ne pas le divulguer) et nomme ses clés `kind`,
  `promptRef`, `issuedAt`, `deepLink`. Le critère échoue par construction.
- **PRD CA-17 et CA-18** exigent que le corps de la bannière de fin de tour soit *"les 140
  premiers caractères du dernier bloc `text` de l'assistant"*. L'architecture n'a ni route ni
  logique pour cela : sa NSE ne sait résoudre qu'un `promptRef` vers un `Prompt`, et pour une fin
  de tour le parseur renvoie `unparsable`, donc la bannière reste **"Validation requise"**. Sur
  une machine en `bypassPermissions`, c'est ce que Robin lira à chaque fois que son agent aura
  simplement fini de travailler. Le mot est faux et il est anxiogène.
- Le conflit sur les actions de `KL_DONE` (aucune, `Ouvrir`, ou `Ouvrir` plus `Interrompre`) n'est
  arbitré nulle part.

**Correction.** Un seul tableau, dans le PRD puisqu'il revendique déjà le rôle de vocabulaire
unique, recopié à l'identique dans les deux autres. Je recommande de retenir les identifiants du
PRD et du Design, qui sont deux documents sur trois et dont les noms sont plus parlants
(`KL_AWAITING_BLIND` dit ce qu'il est, `KL_OPEN` non). Puis, dans l'architecture :
1. ajouter `KL_TURN_END` avec ses actions et son déclencheur, cohérent avec le défaut bloquant 1 ;
2. ajouter la route qui alimente le corps de la bannière de fin de tour, par exemple
   `GET /v1/turn/{turnRef}` rendant `{ title, excerpt, durationMs, toolCount }`, avec la même
   référence opaque et le même jeton NSE de portée limitée que `promptRef`, et l'excerpt tiré du
   dernier bloc `text` par le `TranscriptTailer` qui est désormais en lot 1 de toute façon ;
3. déclarer `KL_CLOSED` et `KL_RECONNECT` comme lot 2, ou les retirer du PRD et du Design. Les
   trois documents doivent dire la même chose, y compris quand la réponse est "plus tard" ;
4. corriger CA-15 pour qu'il décrive la charge utile réelle de C24, et CA-17, CA-18, CA-27 pour
   qu'ils nomment les identifiants retenus.

**Sur la cohérence de C30, que tu me demandes de vérifier nommément : la règle a convergé, le
vocabulaire non.** Le seuil "au delà de 3 options, aucune action rapide" est identique dans les
trois documents, avec la même arithmétique (4 options plus `Interrompre` font 5 actions pour un
budget de 4) et la même justification. `KL_AWAITING_4` a bien disparu partout, je l'ai cherché.
La correction de ta consigne est donc correctement propagée sur le fond. Elle ne l'est pas sur le
nom de la catégorie de repli, qui est `KL_AWAITING_BLIND` dans deux documents et `KL_OPEN` dans le
troisième.

### 3. `promptRef` est déclaré à usage unique alors que trois consommateurs doivent le lire
`03-architecture.md` 2.8, encadré "Référence de prompt", et 5.2, `handleQuickAction`.

Le document écrit : *"Elle est à usage unique et expire en 10 minutes"*. Or la référence est lue
au moins trois fois, et la première lecture est toujours celle de la NSE :

1. la NSE appelle `GET /v1/prompt/<promptRef>` avant l'affichage de la bannière ;
2. l'action rapide `interrupt` fait `resolveRef(d.promptRef)` pour obtenir le `paneId`, puisque
   la charge utile n'en porte plus (C24) et que la route est `POST /v1/panes/:paneId/interrupt` ;
3. l'action rapide de réponse a le même besoin, et le lien profond `kovalink://prompt/<ref>` est
   décrit comme "l'app résout la référence", ce qui fait une quatrième lecture.

Tel qu'écrit, la NSE consomme la référence à chaque notification, et **toutes les actions rapides
échouent ensuite**, y compris `Interrompre`. Le mode de panne est systématique, pas occasionnel :
la NSE tourne toujours en premier. C'est un défaut d'exploitation, pas de sécurité, mais il tue
en production le chemin que tout le lot 1 sert à construire.

**Correction.** 2.8 : remplacer "usage unique" par le cycle de vie réel, qui est le bon et que le
document décrit déjà par ailleurs en 5.1 : la référence est **valable tant que le `awaiting`
correspondant dure**, plafonnée à 10 minutes, et elle est **invalidée quand `awaiting` retombe**
(le retrait automatique de 5.1 le fait déjà). L'usage unique n'a de sens pour aucune lecture
seule ; il en aurait pour une écriture, mais l'écriture est déjà protégée par le `nonce`, le
`promptHash` et l'`awaitingSince`. Ajouter un critère : *"deux `GET /v1/prompt/<ref>` successifs
pendant le même `awaiting` réussissent tous les deux ; un troisième après la retombée de
`awaiting` répond 404."*

---

## 5. Ce que j'ai vérifié empiriquement

Lecture seule, aucune commande IPC mutante, aucun pane touché.

**W1. Le `promptHash` couvre maintenant réellement le détail. Vérifié par lecture du canon.**
```
canon = ['v1', 'Q:'+norm(question),
         ...detail.map((d,i) => `D${i}:`+norm(d)),
         ...options.map(o => `O${o.index}:`+norm(o.label))].join('\n')
```
Trois propriétés que je vérifiais : le `detail` entre bien dans le canon ; les champs sont
**préfixés et séparés par `\n`**, donc deux découpages différents du même texte ne peuvent pas
produire le même canon (la concaténation nue de la passe 2 le permettait) ; le marqueur de
surlignage est capturé par le groupe non retenu de `OPTION_RE` (`[>*]?`) et n'atteint jamais
`m[2]`, donc il reste exclu. Deux demandes `Bash` de commandes différentes produisent bien deux
hachages différents **dès lors que la commande apparaît dans les cinq lignes au dessus de la
question**, ce qui est le cas dans la maquette du design. Je ne peux pas le prouver contre un
rendu réel, faute d'échantillon (V11), et le document le sait : c'est son critère 13, correctement
classé non exécutable.

**W2. `KeyGate` est un point d'entrée unique par construction, avec une réserve sur le lint.**
J'ai énuméré tous les émetteurs possibles d'un `\r` dans le document :
```
emitAnswer    -> `${optionIndex}\r`   garde : promptHash + awaitingSince   (dans answer())
emitInterrupt -> 0x1b                 pas de \r du tout
emitText      -> texte, puis \r       garde : hasParsedPromptPending AVANT CHACUN des deux
emitKeys      -> table fermée         garde : hasParsedPromptPending si enter ou chiffre
```
Aucun autre chemin. `TermInput` et `PaneSendKeys` convergent tous deux vers `emitKeys`, vérifié
dans le type et dans le commentaire du protocole. `PaneCommand` ne contient que des variantes qui
n'écrivent pas dans le pane. `dispatch-action` reste absent.

La règle de lint annoncée, en revanche, ne fait pas ce qu'elle prétend : `no-restricted-imports`
contraint l'import d'un module ou d'un export nommé, il ne peut pas interdire l'accès à une
méthode sur un objet importé, donc il n'attrapera jamais un `ipc.sendKeys(...)` écrit ailleurs.
Voir 6.1. Le test qui compte les appelants, lui, est un vrai filet et suffit.

**W3. `timingSafeEqualStr` est enfin défini, et avec le bon piège.**
```ts
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
```
C'est exactement la correction que j'avais demandée en passe 2 : sans le test de longueur,
`crypto.timingSafeEqual` lève une `RangeError` et un `promptHash` malformé produirait un `500` au
lieu d'un refus, en divulguant la longueur attendue.

**W4. La prémisse du nouveau lot 1 n'est pas confirmée par la machine. Base du défaut bloquant 1.**
```
$ list-panes, panes ayant fini leur tour :
id=65  working=False  awaiting=False  awaiting_since=None  awaiting_seen=False  agent=claude
id=69  working=False  awaiting=False  awaiting_since=None  awaiting_seen=False  agent=claude

$ sondage de list-panes toutes les 2 s pendant 240 s, 4 panes, 2 agents en travail :
121.0s pane 65: (working False, awaiting False) -> (working True, awaiting False)
  ... aucune autre transition. ZERO transition de `awaiting` observee.

$ list-tabs : has_completion=False sur les 4 onglets, has_running=True sur les 4
```
Deux panes Claude au repos après un tour terminé, avec leur processus `claude` vivant, ne portent
aucune trace d'attente, et `awaiting_seen` vaut `false`, ce qui indique que Kova n'a **jamais**
enregistré d'attente pour eux. Le seul champ qui bouge est `working`. Je n'ai pas pu capturer une
transition `working: true -> false` pendant la fenêtre d'observation, je ne prétends donc pas
avoir démontré que `awaiting` ne pulse jamais. Mais l'état stationnaire d'un pane terminé, et
`awaiting_seen: false` sur les quatre panes, sont deux indices concordants et suffisants pour
exiger la mesure avant de construire un lot dessus.

**W5. Ce que je n'ai pas pu vérifier, et que je ne comptabilise donc ni pour ni contre.**
Aucun rendu de prompt de permission n'existe toujours sur la machine (V11 reste vrai, mode
`bypassPermissions`), donc la grammaire du parseur, la valeur discriminante réelle du `detail`, et
la sémantique de mise à jour de `awaiting_since` sur deux prompts successifs restent non mesurées.
Le document ne prétend rien d'autre, et c'est à son crédit.

**W6. Les corrections C22 et C34 reposent bien sur les données réelles. Revérifié.**
```
$ queue-operation dans la session de reference : 20 entrees
  11 x '<task-notification>\n<task-id>...\n<tool-use-id>toolu_...'
   9 x content: null
   0 x message de Robin
$ grep -c 'tool-results' <session>.jsonl -> 5, toutes des citations de la revue elle meme
$ grep -c 'by8zqugpa'    <session>.jsonl -> 0, alors que le fichier existe et porte un resultat
```
Les trois documents citent ces chiffres exacts, et l'architecture en tire la bonne conclusion dans
les deux cas : ignorer, et ne pas spécifier de route sur un mécanisme supposé. Pour `tool-results`
elle va jusqu'à porter `retrievable: false` dans le type et un libellé d'interface honnête. C'est
la manière correcte de traiter une inconnue.

**W7. Les mesures antérieures restent exactes et sont fidèlement reportées.**
```
list-panes -> data en tableau direct                     conforme a V1
get-pane-content panes:[9999] -> ok:true + error par element   conforme a V2
{"cmd":"capabilities"} -> {"error":"unknown command: ..."}     conforme a V3
count-pane-content visible/scrollback/all -> 10330 / 0 / 10330 conforme a V4
ps -p 85882 -o comm= -> /Applications/Kova.app/Contents/MacOS/kova, egalite stricte OK (V9)
```
La section 0 ne contient aucune mesure que je n'aie pu reproduire, et elle porte désormais V11 et
V12, c'est à dire les deux faits qui invalident ses propres affirmations antérieures. Un document
qui documente ce qui le contredit est un document dans lequel on peut avoir confiance.

---

## 6. Améliorations souhaitables, non bloquantes

1. **La règle de lint ne fait pas ce qu'elle annonce.** `no-restricted-imports` ne peut pas
   interdire `ipc.sendKeys(...)` sur un objet importé. Utiliser `no-restricted-properties`
   (`{ object: 'ipc', property: 'sendKeys' }`), ou exporter `sendKeys` comme export nommé et
   restreindre l'import avec `importNames`. Une ligne, et la garantie annoncée devient réelle.
2. **`DECIDING` est une liste explicite couplée à `KEY_TABLE`.** Le jour où quelqu'un ajoute
   `digit4` à `KEY_TABLE` pour un prompt à quatre options, il rouvre silencieusement le
   contournement que C23 vient de fermer. Dériver l'ensemble d'un prédicat
   (`k === 'enter' || /^\d$/.test(KEY_TABLE[k])`) rend l'ajout sûr par construction.
3. **Le cache de 500 ms de `hasParsedPromptPending` doit être invalidé sur `pane-status`.**
   Aujourd'hui la garde est sûre par accident : la première évaluation sort avant d'atteindre le
   cache quand `awaiting` est faux, donc rien n'est mis en cache avant la fenêtre à protéger. Une
   implémentation naïve qui met en cache le résultat "pas de prompt" rendrait la seconde garde
   d'`emitText` inopérante précisément dans la fenêtre qu'elle protège. Écrire l'invalidation.
4. **Résidu irréductible d'environ 16 ms** entre la lecture de la garde et l'émission du `\r` dans
   `emitText`. Il ne peut pas être fermé sans un `send-keys` atomique, que le PRD interdit pour le
   texte libre. Le document ne le prétend pas, mais autant l'écrire noir sur blanc à côté du
   critère 15 : la garde réduit la fenêtre, elle ne l'annule pas.
5. **`detail` est plafonné à cinq lignes.** Une commande longue est tronquée, dans le hash comme à
   l'affichage, donc la règle "on hache tout ce qui est affiché" tient. Mais Robin décide alors sur
   une commande partielle sans le savoir. Afficher un marqueur de troncature explicite, ou porter
   la fenêtre à huit lignes.
6. **`KL_DONE` avec une action `Interrompre`** (architecture) sur un pane qui vient justement de
   s'arrêter n'a pas de sens. La version du Design, aucune action déclarée et un tap qui ouvre la
   session, est la bonne. À trancher avec le défaut bloquant 2.
7. **Ajouter `awaiting_since` aux mesures.** Le second garde-fou de C20 dépend d'une sémantique de
   Kova non documentée et non mesurée. Le même `subscribe` de dix minutes que pour V13 la donnera.
8. **Toujours pas d'annulation de requête** dans le protocole. `session.history` sur 100 turns et
   les routes de sous-agents peuvent être abandonnés côté app sans que le daemon le sache. Dix
   lignes, lot 2. Je le signale pour la troisième fois, sans insister : ce n'est pas grave.

---

## 7. Verdict

**NE PASSE PAS.** Note pondérée **8,18 / 10**, contre une barre à 9,0. Aucun axe sous 7.

Je veux être précis sur ce que ce verdict dit et ne dit pas.

**Tout ce que j'avais signalé en passe 2 est corrigé, et bien corrigé.** Le `promptHash` couvre
maintenant la charge décisionnelle complète, avec un canon préfixé qui ferme même les collisions
de frontière de champ que je n'avais pas relevées. Les trois chemins résiduels du retour chariot
sont fermés par une garde commune, avec la bonne exception pour le repli `unparsable`, et le
périmètre de `KeyGate` est enfin énoncé sans raccourci. L'interruption est rétablie de bout en
bout, comme opération de premier ordre et non comme cas particulier, avec la bonne justification.
Mes deux points transcript sont corrigés sur les données réelles, y compris en retirant une route
plutôt qu'en la fondant sur un mécanisme supposé. Et le basculement de prémisse est conduit avec
une honnêteté rare : le parseur est requalifié en hypothèse, isolé, testé sur fixtures, et six
critères d'acceptation sont explicitement déclarés non exécutables plutôt que cochés. Sur le plan
de la sécurité, je ne trouve plus de faille ouverte, et c'est la première fois en trois passes.

**Ce qui reste tient en un seul endroit : la couche de notification et la prémisse qui la
déclenche.** Le nouveau lot 1 a été entièrement re-cadré autour d'un signal, `awaiting` au terme
d'un tour, qui n'a jamais été mesuré et que la machine contredit : deux panes Claude qui viennent
de finir rapportent `awaiting: false` et `awaiting_seen: false`, et un sondage de quatre minutes
sur quatre panes n'a vu aucune transition. Si ce signal ne se lève pas, le chemin de repli est N2,
assorti d'un seuil de 60 secondes qui élimine précisément les tours courts, c'est à dire le
scénario que le lot 1 est censé servir. Dix minutes de `subscribe` en lecture seule lèvent le
doute, et elles doivent être faites avant d'écrire une ligne de code, pas après.

À cela s'ajoute une divergence que j'aurais dû voir en passe 2 et que je signale tard : les trois
documents nomment différemment les mêmes catégories de notification, sous un tableau du PRD qui
s'intitule pourtant "vocabulaire unique pour les trois documents". Un `categoryIdentifier` qui ne
correspond pas produit une bannière sans aucun bouton, sans erreur, sur le chemin qui justifie le
produit. Et quatre critères d'acceptation du PRD échouent par construction contre une
implémentation conforme à l'architecture. Enfin, `promptRef` est déclaré à usage unique alors que
la NSE, l'action rapide et le lien profond doivent tous le lire, ce qui casserait toutes les
actions rapides dès la première notification.

Aucun de ces trois points n'est cosmétique, et aucun n'est lourd. Estimation : **une demi-journée**,
dont dix minutes de mesure, une table recopiée à l'identique dans trois fichiers, une route de
récupération de l'extrait de fin de tour, et une phrase corrigée sur le cycle de vie de
`promptRef`. Ces trois points traités, ce document est au dessus de 9 et je le signe sans réserve.
Nous sommes très près.
