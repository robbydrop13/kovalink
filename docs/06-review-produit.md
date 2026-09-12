# Revue produit et UX, KovaLink, passe 3

> Relecteur : produit / UX du panel.
> Documents notés : `01-prd.md` (833 l., 130 critères), `02-design.md` (2 543 l.).
> Lu pour contradictions : `03-architecture.md` (2 305 l.).
> Ordre de correction appliqué : `08-corrections-passe2.md` (C20 à C37).
> Angle inchangé : les parcours qui cassent silencieusement, et les erreurs coûteuses.
> Méthode inchangée : aucune annonce de correction n'est crue sur parole. Chaque correctif
> a été cherché dans le texte des trois documents, y compris dans le code de la NSE, la
> table des catégories, l'union de types du protocole et la liste des critères.

## 0. Éliminatoires, revérifiés

| Éliminatoire | Résultat |
|---|---|
| Tiret cadratin (U+2014) | **0** occurrence dans les quatre documents. Conforme. |
| Contradiction avec la section 5 de `00-context.md` | Aucune. |
| Re-débat d'un choix tranché | Aucun. Les tables de conformité A1 à A16 et C20 à C37 remplacent les anciennes sections 9. |
| Critère non testable | Les 130 critères sont formulés en assertions vérifiables. 14 sont marqués `[NE]`, marquage **honnête** (voir section 1). Aucun critère faussement testable n'est réapparu. Trois critères sont en revanche **testables mais contredits par l'architecture** : CA-17, CA-24, CA-25. Voir défaut T1. |
| Faille de sécurité | **La porte dérobée de la passe 2 est fermée, et vérifiée jusque dans le code.** Voir P1 ci dessous. |

---

## 1. Évolution depuis la passe 2

### 1.1 Mes trois blocages prioritaires

**P1, la porte dérobée du texte libre : corrigé, et mieux que demandé.**
Vérifié dans les trois documents. Plus aucune `UNTextInputNotificationAction` : `Répondre…`
et `Continuer…` ont disparu du PRD (4.3), du Design (4.4.7 et 5.3) et de l'architecture
("Il n'existe aucune action de saisie de texte libre depuis une bannière"). CA-29 le vérifie
sur toutes les catégories.

Le mécanisme ajouté à l'intérieur de l'app est **sûr, et je n'ai pas trouvé de chemin par
lequel un chiffre puisse encore partir déguisé en texte** :
- Le composer est verrouillé tant qu'un prompt parsé est ouvert, côté app (placeholder
  `Réponds d'abord à la question ci dessus`, tap qui fait pulser la barre) **et côté daemon**
  (`prompt_open`). La garde n'est pas seulement visuelle, c'est ce qui compte.
- `Répondre autrement` n'ouvre pas le clavier : il envoie d'abord l'option de `kind: reject`
  par le chemin protégé (avec `prompt_hash`), attend la confirmation que `awaiting` est
  retombé, **puis** déverrouille le composer. Si l'étape 1 échoue, l'étape 2 n'a pas lieu.
  C'est exactement ce que fait Claude Code avec "No, tell Claude what to do differently",
  et aucun chiffre ne transite jamais comme texte.
- J'ai cherché la course : entre le déverrouillage du composer et l'envoi, un nouveau prompt
  peut se lever. Elle est couverte : `hasParsedPromptPending()` est réévalué **avant chacun
  des deux appels** de `pane.sendText`, et le second `\r` ne part pas si l'état a changé
  (réponse `became_awaiting`). Le texte déjà tapé reste visible et non validé.
- J'ai cherché la porte par les touches : `emitKeys` refuse `enter` et les chiffres quand un
  prompt parsé est en attente (`DECIDING = ['enter','digit1','digit2','digit3']`,
  `FORBIDDEN_KEY`). La file d'attente hors ligne est revalidée à la reprise.
Il reste une asymétrie de règle, pas un trou, traitée en amélioration A1.

**P2, la capacité iOS non documentée : corrigé.**
Les trois documents abandonnent le ré-enregistrement dynamique et l'écrivent noir sur blanc.
Catégories **pré-enregistrées statiquement au lancement de l'app**, boutons portant les
**chiffres**, la NSE ne réécrit que le corps. CA-24 vérifie que la NSE n'appelle jamais
`setNotificationCategories`. Le choix de design qui en découle est bon : le corps liste
`1 Yes   2 Yes, and don't ask again   3 No`, donc Robin lit ce que fait chaque chiffre avant
d'appuyer. Le cas "NSE tuée avant d'avoir écrit" est traité de la meilleure façon possible :
**la charge utile porte toujours la catégorie du pire cas** (`KL_AWAITING_BLIND`), et la NSE
la remplace seulement en cas de succès. Il n'existe donc aucun chemin où la bannière promet
des boutons inexistants. Réserve de nommage en T2.

**P3, le repli d'échec : corrigé sur le fond, divergent sur le nom.**
Les trois documents disent maintenant la même chose : bannière sans aucune action
d'approbation, `Interrompre` et `Ouvrir` seulement, ouverture forcée de l'app. L'architecture
a bien ajouté `Interrompre` à sa catégorie de repli, ce qui manquait en passe 2. CA-20
est satisfait par les trois. Seul l'identifiant diffère, voir T2.

### 1.2 P4 à P10

| # | Défaut de la passe 2 | État | Preuve |
|---|---|---|---|
| P4 | Défauts de réglages divergents pouvant éteindre S1 | **Corrigé** | Le réglage `Extraits` est supprimé des trois documents (C28), la NSE récupère toujours le contenu. Réglages ramenés à 4, `Validations seulement` à `Désactivé` partout. CA-74 vérifie les 4 entrées et l'absence de l'entrée supprimée. CA-25 vérifie le comportement sur installation neuve. |
| P5 | 7 actions pour une limite de 4, sans règle de troncature | **Corrigé** | Règle écrite dans le PRD 4.3, appliquée par le Design 4.4.3 et par le code de la NSE. Seuil unifié à **3 options** après ta correction : `p.options.count <= 3` dans l'architecture, `4 et plus vers BLIND` dans le Design, `au delà de 3 options` dans le PRD. La catégorie `KL_AWAITING_4` a bien disparu partout. `Interrompre` n'est jamais retiré. CA-26 à CA-28 le testent. |
| P6 | `Muter` en piège sans retour | **Corrigé** | Supprimé du balayage, du menu contextuel et des réglages, dans les trois documents. Le menu d'appui long n'a plus qu'une entrée. CA-10 vérifie l'absence, y compris par balayage. |
| P7 | `Interrompre` inatteignable pour un pane qui travaille | **Corrigé, et promu** | Message dédié `pane.interrupt`, opération de premier ordre en lot 1, quatre surfaces avec un contrat unique écrit une seule fois (Design 4.1). CA-53 à CA-57 couvrent les quatre. |
| P8 | Quatre critères faussement testables | **Corrigé** | CA-18 dit "les 120 premiers caractères", CA-59 dit "le seul bouton plein", CA-26 et CA-58 séparent la bannière de l'app. |
| P9 | `resize-pane` toujours câblé dans l'architecture | **Toujours ouvert** | `resize-pane` reste dans l'union des commandes de pane, et l'action `Adapter à mon écran` est toujours spécifiée, avec la référence périmée "PRD B5". Le PRD B6 et CA-84 disent l'inverse. Ton ordre de correction ne l'a pas repris. Voir T3. |
| P10 | Trois budgets de rejeu | **Partiellement corrigé** | PRD et Design disent 2 Mo (C35). L'architecture dit encore **256 Ko** dans sa table des risques. CA-80 échoue contre elle. Voir T4. |

### 1.3 Qualité du basculement de prémisse (C36)

Je note la qualité et la cohérence, pas l'opportunité.

**La qualité est élevée.** Le PRD ne se contente pas de renuméroter : la prémisse est étayée
par une mesure (5 projets vérifiés en `bypassPermissions` ou `auto`), les 9 scénarios sont
re-classés avec la validation qui tombe de 55 % à 8 %, M1 est réécrit, les indicateurs de la
section 1.3 changent de nature (instructions envoyées, part des ouvertures qui aboutissent à
un message), le lot 1 est redéfini autour de la bonne boucle, et les volumes sont réestimés à
la hausse au lieu d'être flattés. Deux ajouts montrent que le basculement a été pensé et pas
subi : le **badge `bypass`** avec l'explication "aucune validation ne te sera demandée", qui
répond au risque R6 (le produit paraît cassé parce qu'il ne notifie jamais), et les **trois
prérequis de recette** de la section 3.0, qui disent honnêtement que le parseur n'a aucun
échantillon et que rien de ce qui en dépend ne peut être déclaré satisfait.

**La cohérence entre documents ne suit pas.** C'est le sujet du défaut T1, et c'est mon seul
défaut de fond de cette passe : le basculement est appliqué dans le PRD, incomplètement dans
le Design, et pas du tout dans l'architecture.

### 1.4 Honnêteté du marquage `[NE]`

**Le marquage est honnête.** Les 14 critères marqués dépendent tous réellement d'un rendu de
prompt qui n'existe sur aucune machine aujourd'hui : contenu de la bannière de prompt
(CA-18), nombre de boutons (CA-26 à CA-28), refus du texte libre quand un prompt est ouvert
(CA-49), boutons dans l'app (CA-58, CA-59), propriétés du hash (CA-62, CA-64 à CA-66), Face ID
sur approbation et refus (CA-67, CA-68). Aucun ne pourrait être exécuté sans fixture.

J'ai cherché l'inverse, un critère **non** marqué qui dépendrait quand même d'un prompt réel :
je n'en ai pas trouvé. CA-20 (daemon arrêté), CA-24 (catégories enregistrées), CA-29 (aucun
champ de saisie), CA-50 (aucun retour chariot seul), CA-63 (hash sur fixture synthétique) sont
tous exécutables sans prompt réel, et c'est correct.

Le marquage est même **légèrement conservateur** : CA-62 et CA-64 portent sur la fonction de
hachage et pourraient être exécutés dès aujourd'hui en test unitaire sur un objet fabriqué.
CA-62 étant marqué éliminatoire, l'exécuter tôt aurait de la valeur. Voir amélioration A5.

---

## 2. Notes par axe

| # | Axe | Poids | P1 | P2 | P3 | Justification en une ligne |
|---|---|---|---|---|---|---|
| 1 | Justesse du problème | 15% | 8,5 | 9,0 | **9,5** | Le basculement de prémisse est appuyé sur une mesure et non sur une intuition, les fréquences, les indicateurs et le lot 1 suivent tous, et deux détails montrent que le vrai moment d'usage est compris : le badge `bypass` qui explique pourquoi une session est silencieuse, et les prérequis de recette qui refusent de déclarer satisfait ce qui n'est pas vérifiable. |
| 2 | Complétude fonctionnelle | 15% | 6,5 | 8,5 | **8,0** | Tout ce que je réclamais en passe 2 est fermé (Muter, interruption sur quatre surfaces, réglages, troncature), mais le basculement ouvre un trou neuf : la fin de tour, qui est désormais 45 % des ouvertures, n'a de chaîne complète que dans le PRD, et aucune règle ne distingue une fin de tour d'un prompt illisible, ce qui rend l'état `unparsable` inatteignable. |
| 3 | Qualité de l'UX mobile | 15% | 8,0 | 8,5 | **9,0** | Le verrouillage du composer avec la barre qui pulse, la séquence en deux temps de `Répondre autrement`, les trois régimes de texte libre, les chiffres sur les boutons de bannière avec le corps qui les explique, le pavé numérique et le contrat unique d'`Interrompre` sur quatre surfaces forment un ensemble cohérent et utilisable au pouce ; il reste une règle d'authentification asymétrique entre deux chemins qui font la même chose. |
| 4 | Solidité de l'architecture | 20% | 7,0 | 8,0 | **7,5** | Les convergences demandées sont réelles et vérifiables dans le code (`KeyGate`, ensemble `DECIDING`, hash sur la charge décisionnelle complète, `awaiting_since` comme second discriminant, catégories statiques, jeton NSE de portée limitée), mais quatre divergences subsistent, dont une sur le chemin principal (aucun `turn_end` dans le protocole) et une sur des identifiants de catégorie qui, s'ils diffèrent à l'exécution, produisent une bannière sans aucune action. |
| 5 | Sécurité | 15% | 6,5 | 7,5 | **9,0** | La quatrième porte est fermée partout et je l'ai vérifiée jusqu'au code, le hash couvre enfin le bloc de détail (deux `Bash` consécutifs ne collisionnent plus), `awaiting_since` ajoute un second discriminant, la référence de prompt est opaque, à usage unique et ne dérive pas du `pane_id`, et le jeton de la NSE n'ouvre qu'une route ; il ne reste qu'une incohérence de règle, pas un trou. |
| 6 | Simplicité | 10% | 6,5 | 9,0 | **9,5** | Quatre réglages, `Muter` supprimé, `Extraits` supprimé, `dispatch-action` absent, aucune action de fichier destructive, et des volumes réestimés à la hausse plutôt que flattés : chaque suppression de cette passe retire une décision non prise, et aucune n'a cassé un parcours, ce que j'ai vérifié fonction par fonction. |
| 7 | Implémentabilité | 10% | 7,5 | 8,0 | **8,0** | 130 critères presque tous vérifiables par un journal, un `grep` ou un compteur, 14 marqués non exécutables avec la procédure écrite pour les rendre exécutables, et des prérequis de recette explicites ; mais un ingénieur qui ouvre les trois documents trouve deux modèles de notification pour le cas le plus fréquent et deux vocabulaires de catégories. |

---

## 3. Note pondérée globale

```
Axe 1  9,5 x 0,15 = 1,425
Axe 2  8,0 x 0,15 = 1,200
Axe 3  9,0 x 0,15 = 1,350
Axe 4  7,5 x 0,20 = 1,500
Axe 5  9,0 x 0,15 = 1,350
Axe 6  9,5 x 0,10 = 0,950
Axe 7  8,0 x 0,10 = 0,800
------------------------------
Total             = 8,575 / 10
```

**Note globale : 8,6 / 10** (passe 1 : 7,2 ; passe 2 : 8,3). Aucun axe sous 7. La barre de
9,0 n'est pas atteinte, à cause d'un seul défaut de fond et de trois désynchronisations.

---

## 4. Défauts bloquants

Quatre. Un seul est de fond, les trois autres sont des nombres et des noms.

### T1. La fin de tour, qui est le nouveau lot 1, n'existe que dans le PRD

C'est le défaut de cette passe. Le basculement C36 fait de "l'agent a fini, je lui donne la
suite" 45 % des ouvertures et la justification entière du lot 1. Les trois documents en font
trois choses différentes.

| Document | Ce qui se passe quand l'agent finit et lève `awaiting` sans bloc d'options |
|---|---|
| `01-prd.md` 4.1 et 4.2 | N1, `kind: "turn_end"`, catégorie `KL_TURN_END`, titre `{onglet} attend ta réponse`, corps = 140 premiers caractères du dernier bloc `text` de l'assistant, sous-titre = durée et nombre d'outils, actions `Interrompre` et `Ouvrir`. |
| `02-design.md` 4.4.1 | Renvoyé sur **N2**, titre `{onglet} a terminé`, **aucune action**, "`Interrompre` sans objet". Mais le déclencheur de N2 dans son propre catalogue 5.1 est `pane-working: false` **avec `awaiting` faux**, ce qui exclut précisément ce cas. Et sa table de catégories 4.4.3 n'a que 2 options, 3 options, 4 et plus, parsing échoué : aucune ligne pour la fin de tour. |
| `03-architecture.md` | **Le concept n'existe pas.** Le parseur ne renvoie que `parsed` ou `unparsable`. La NSE sort immédiatement si l'état n'est pas `parsed`. Le cas nominal produit donc la bannière de repli : titre `Validation requise`, corps `Ouvre KovaLink pour lire la question`, catégorie `KL_OPEN`. |

Conséquences concrètes, toutes vérifiables :
- Le cas qui représente 45 % des ouvertures affiche, en l'état de l'architecture, une bannière
  **sans aucun contenu** et **factuellement fausse** : elle annonce une validation requise
  alors que l'agent a simplement fini. C'est le mensonge d'interface exactement de la nature
  que cette revue cherche.
- **CA-17, CA-24 et CA-25 échouent** contre l'architecture. CA-17 et CA-25 sont les deux
  critères qui vérifient le coeur du nouveau lot 1, et ils ne sont pas marqués `[NE]`, donc
  ils sont censés être exécutables dès la recette.
- Le Design perd `Interrompre` sur la bannière la plus fréquente, alors que S3 lui donne une
  cible de 5 secondes et que le contrat unique d'`Interrompre` promet quatre surfaces.
- **Plus grave : aucun document ne dit comment distinguer une fin de tour d'un prompt dont le
  parsing a échoué.** Le seul critère écrit est "la présence d'un bloc d'options dans le pane"
  (Design 4.4.1). Or C37 pose que, faute d'échantillon, `unparsable` est le comportement
  **attendu**. Les deux cas produisent donc le même signal, avec deux conséquences opposées :
  l'état `unparsable` de A8 devient inatteignable (aucun prompt illisible ne sera jamais
  qualifié comme tel), et le jour où un vrai prompt arrive et n'est pas parsé, il est annoncé
  comme une fin de tour avec le résumé du dernier message, ce qui invite Robin à taper une
  instruction dans un composer qui répond en réalité à une question de permission.

**Correction :** ajouter au parseur un **troisième état**, `turn_end`, à côté de `parsed` et
`unparsable`, dans `03-architecture.md` section 2.3 (union de types, ligne du `PromptParser`),
et le propager au chemin NSE (aujourd'hui `guard p.state == "parsed"`, à remplacer par un
branchement à trois voies). Le discriminant existe déjà et est gratuit : le daemon lit déjà le
JSONL pour composer le résumé. Une fin de tour se reconnaît à un dernier bloc `text` de
l'assistant **sans `tool_use` en attente de `tool_result`** ; une décision en attente se
reconnaît à l'inverse. La règle à écrire : `turn_end` si le JSONL montre un tour clos **et**
aucun bloc d'options n'est trouvé ; `unparsable` si le JSONL montre une décision en attente
**et** que le bloc d'options n'a pas pu être lu ; `parsed` sinon. Aligner ensuite
`02-design.md` : supprimer la ligne "renvoyé sur N2" de 4.4.1, ajouter une ligne `KL_TURN_END`
à la table de catégories 4.4.3 et à la table d'actions 5.3 avec `Interrompre` et `Ouvrir`, et
ajouter la ligne correspondante au contenu 5.2. Corriger enfin la justification du réglage
`Validations seulement` dans `01-prd.md` 3.7, qui affirme qu'activé il "éteindrait la
notification de fin de tour" alors que la fin de tour est N1 et que ce réglage ne coupe que
N2, N3 et N4 : le défaut retenu reste le bon, la raison écrite est fausse.

### T2. Deux vocabulaires de catégories, pour un identifiant qui doit correspondre à l'exécution

`01-prd.md` 4.2 intitule sa table "Catégories, vocabulaire unique pour les trois documents" et
liste `KL_TURN_END`, `KL_AWAITING_2`, `KL_AWAITING_3`, `KL_AWAITING_BLIND`, `KL_DONE`.
`02-design.md` 4.4.3 et 5.3 utilisent les mêmes, moins `KL_TURN_END`.
`03-architecture.md` 5.1 et 5.2 enregistre `KL_OPT2`, `KL_OPT3`, `KL_OPEN`, `KL_DONE`.

Ce ne sont pas des noms de documentation : ce sont les chaînes que le daemon pose dans
`categoryIdentifier` et que l'app enregistre au lancement. Si elles ne correspondent pas,
iOS affiche la bannière **sans aucune action**, silencieusement. C'est exactement le mode de
panne que C25 vient d'éliminer, réintroduit par un désaccord de nommage. **CA-24 échoue**
contre l'architecture, sur les noms comme sur le nombre (5 catégories attendues, 4
enregistrées).

**Correction :** retenir le vocabulaire du PRD, qui est le seul complet, et renommer dans
`03-architecture.md` 5.1 et 5.2 : `KL_OPT2` vers `KL_AWAITING_2`, `KL_OPT3` vers
`KL_AWAITING_3`, `KL_OPEN` vers `KL_AWAITING_BLIND`, plus l'ajout de `KL_TURN_END` (T1).
Ajouter au PRD la phrase qui manque pour rendre la table opposable : "ces identifiants sont
des chaînes d'exécution, toute divergence produit une bannière sans action".

### T3. `resize-pane` est toujours câblé dans l'architecture, deuxième passe consécutive

`01-prd.md` B6 : "Le pane du Mac n'est jamais redimensionné depuis le téléphone,
`resize-pane` n'est pas utilisée en v1". Section 6 l'exclut. CA-84 exige zéro occurrence dans
le journal. `03-architecture.md` garde `resize-pane` dans l'union des commandes de pane et
spécifie toujours l'action `Adapter à mon écran`, avec la référence périmée "PRD B5" (B5 est
désormais la barre de touches spéciales). Signalé en passe 2, non repris dans l'ordre de
correction, donc non corrigé.

**Correction :** retirer `resize-pane` de l'union des commandes et supprimer les trois
mentions d'`Adapter à mon écran` dans `03-architecture.md`. Le `Fit` client du Design 4.6
couvre le besoin et ne touche pas au Mac.

### T4. Le budget de rejeu du terminal reste à deux valeurs

C35 impose une valeur unique de **2 Mo**. Le PRD (B3, CA-80) et le Design (4.6 et ses deux
tables de conformité) l'appliquent. `03-architecture.md` conserve **256 Ko** dans sa table des
risques, avec en plus la règle "zéro rejeu si le fichier a grossi davantage", qui n'existe
nulle part ailleurs. CA-80 échoue contre elle.

**Correction :** remplacer 256 Ko par 2 Mo dans la table des risques de
`03-architecture.md`, et aligner la règle de dépassement sur celle du PRD (au delà du budget,
l'écran est vidé et repart du contenu visible courant), ou faire remonter la règle "zéro
rejeu" dans le PRD si elle est jugée meilleure. Une seule valeur, une seule règle.

---

## 5. Améliorations souhaitables, non bloquantes

1. **Asymétrie d'authentification dans l'état `unparsable`.** Le texte libre y exige Face ID,
   au motif qu'"on ne peut pas exclure que la frappe soit un chiffre qui approuve". Le pavé
   numérique du repli monospace, qui envoie exactement un chiffre dans exactement le même
   état, n'exige rien, et l'architecture l'assume ("quand le prompt est `unparsable`, tout
   passe"). Or c'est le chemin **recommandé** par le Design 4.3.6 et par sa phrase de
   conclusion. Les deux portes doivent avoir la même règle. Ma recommandation est de
   **retirer le Face ID du texte libre** plutôt que de l'ajouter au pavé : dans les deux cas
   l'app est déverrouillée, l'écran affiche le pane brut, Robin lit ce qu'il fait, et
   `unparsable` sera l'état par défaut tant que le parseur n'a pas de fixture. Mettre de la
   friction sur la seule issue d'un état qui sera nominal est exactement ce que A2 reproche.
2. **`Interrompre` mis en file 5 minutes hors ligne** (PRD 5.3, CA-72). Le raisonnement est
   juste (interrompre tard reste sûr), mais une interruption émise 4 minutes plus tard peut
   tuer un tour que Robin a lui même lancé entre temps depuis l'app. Ajouter la garde :
   l'interruption en file est annulée si un message a été envoyé au même pane depuis.
3. **Règle de troncature partiellement morte** (PRD 4.3, points 2 et 3). Au delà de 3 options
   il n'y a plus d'action d'option, donc le total ne peut jamais dépasser 4 et le point 3 est
   inatteignable. Le point 2 suppose en outre que "l'option de refus est le dernier index",
   hypothèse que le reste du document interdit explicitement. Supprimer les deux points, ne
   garder que l'ordre de déclaration et le seuil de 3.
4. **`KL_DONE`** : le PRD lui donne l'action `Ouvrir`, le Design "aucune action déclarée". Sans
   conséquence puisque taper la bannière ouvre l'app, mais à aligner en une ligne.
5. **CA-62 et CA-64 pourraient être exécutés dès maintenant** en test unitaire sur un objet de
   prompt fabriqué, sans fixture réelle : ils portent sur la fonction de hachage, pas sur la
   grammaire. CA-62 étant marqué éliminatoire, le sortir du lot `[NE]` de-risquerait la recette
   avant même le basculement d'un projet en mode permission.
6. **Design 4.3.6** promet un terminal "avec la barre de touches spéciales **et** le pavé
   numérique visibles", alors que la barre de touches est marquée lot 2 et le pavé lot 1.
   En lot 1 la moitié de la promesse n'existe pas. Retirer la mention de la barre de touches
   de cette phrase.
7. **Design 3.3**, table des liens profonds : la ligne "Notification N1 (`KL_AWAITING`)" garde
   un identifiant qui n'existe plus dans aucune table. À aligner sur T2.

---

## 6. Verdict

**NE PASSE PAS.** Note globale **8,6 / 10**, barre à 9,0. Aucun axe sous 7.

Je ne bloque pas par lassitude, et je le dis précisément : **mes trois blocages de la passe 2
sont réellement corrigés**, vérifiés jusque dans le code de la NSE et dans les gardes du
daemon, et la fermeture de la porte dérobée est même meilleure que ce que je demandais, parce
que le verrouillage du composer et la séquence en deux temps de `Répondre autrement` traitent
la cause plutôt que le symptôme. Sept des dix défauts de la passe 2 sont fermés, le
basculement de prémisse est du bon travail de produit, et le marquage des critères non
exécutables est honnête, ce qui est rare et vaut d'être dit.

Ce qui reste tient en une phrase : **le nouveau lot 1 a été écrit dans le PRD et n'a pas été
propagé.** La fin de tour, qui est désormais 45 % des ouvertures et la raison d'être du lot,
n'existe pas dans le protocole, produit une bannière fausse et vide en l'état de
l'architecture, fait échouer trois critères, et laisse sans réponse la question de savoir
comment on distingue un agent qui a fini d'un prompt qu'on n'a pas su lire. Cette dernière
question n'est pas cosmétique : elle rend inatteignable le filet de sécurité de A8, et elle
fait annoncer une question de permission comme une fin de tour, ce qui est précisément le
genre de parcours silencieux que je suis chargé de trouver.

T1 est un troisième état dans une union de types, un branchement dans la NSE, une règle de
discrimination qui utilise une donnée déjà lue, et trois lignes de tables dans le Design.
T2, T3 et T4 sont un renommage et deux nombres. Une passe 4 très courte, strictement limitée à
ces quatre points, met ce lot au dessus de 9 sans rien rouvrir d'autre.
