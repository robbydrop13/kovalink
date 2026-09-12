# Revue de pragmatisme, KovaLink, passe 3

| | |
|---|---|
| Relecteur | Axe pragmatisme (procuration Robin) |
| Documents notés | `01-prd.md` (833 l.), `02-design.md` (2 543 l.), `03-architecture.md` (2 305 l.) |
| Référentiel | `04-review-rubric.md`, `00-context.md` §5, `05-arbitrages.md`, `07-corrections.md`, `08-corrections-passe2.md` |
| Passe 1 | 8,35 / 10, Simplicité 5,0, NE PASSE PAS |
| Passe 2 | 8,50 / 10, Simplicité 7,5, NE PASSE PAS |
| **Passe 3** | **9,05 / 10, aucun axe sous 7** |
| **Verdict** | **PASSE** |

Mes trois désynchronisations sont fermées, vérifiées une par une dans les trois documents. Le
changement de prémisse est la meilleure chose qui soit arrivée à ce projet. Il reste une erreur
d'arithmétique sur le chiffrage du lot 1, une contradiction de périmètre sur `resize-pane`, et
deux coquilles. Aucune ne justifie de retenir l'implémentation, toutes se corrigent avant le
premier jour.

---

## 0. Évolution depuis la passe 2

### 0.1 Mes trois désynchronisations

| Point | Tranché par C24, C28, C29 | Vérifié dans les trois documents |
|---|---|---|
| **Route de la NSE** | `GET /v1/prompt/{promptRef}`, référence opaque à usage unique, jeton court dédié à la NSE | **Fermé.** PRD 4.2 et CA-21, Design 4.4.2 et 4.4.4, Archi 2.8 route et 5.1 chaîne. Même route, même modèle d'authentification, même durée de vie (usage unique ou 10 min), et le `promptRef` n'est pas dérivé du `paneId` dans les trois. Meilleur que ce que je demandais : je proposais de trancher pour l'architecture, la version retenue est plus sûre parce qu'elle ne fait pas fuiter l'identifiant de pane dans la charge utile. |
| **Réglage `Extraits dans les notifications`** | Supprimé du produit, réglages de 5 à 4 | **Fermé, et mieux que corrigé.** Le réglage qui était deux fonctions opposées n'existe plus, dans les trois documents. Supprimer valait mieux que trancher : il n'avait plus d'objet dès lors que la NSE récupère toujours sur le canal direct. |
| **Seuil de N2** | 60 s | **Fermé.** PRD 4.1 (déclaré opposable et déclaré une seule fois), Design 5.1, Archi 5.1. Une seule valeur circule, et CA-30 la teste (55 s ne notifie pas, 70 s notifie). |

### 0.2 Les 4 réglages

Exactement quatre entrées interactives, identiques dans les trois documents, mêmes valeurs par
défaut : `Validations seulement` (OFF), `Heures calmes` (23h à 7h), `Garder le Mac éveillé` (ON),
`Révoquer l'appairage` (action). Plus un bloc `Activité` de cinq lignes en lecture seule, dont le
Design précise explicitement qu'il ne compte pas comme une entrée, avec une règle de comptage
écrite pour lever l'ambiguïté au test. La divergence de valeur par défaut que j'avais trouvée en
passe 2 sur `Validations seulement` est résolue, et bien résolue : OFF partout, parce que depuis
C36 la notification qui compte est N2, et la mettre à ON éteindrait le produit à l'installation.
`Muter` est supprimé (C31), ce que je réclamais en passe 2 : c'était le sixième réglage déguisé,
et il n'avait aucun moyen de démutage.

### 0.3 Mes autres coupes de la passe 2

| Coupe | État |
|---|---|
| `Muter` par appui long | **Appliquée**, supprimé du produit |
| N4, `Mac de nouveau joignable` | Refusée, séquencée en lot 2, j'en prends acte |
| Écran Session fermée dédié | Refusé, séquencé en lot 2 |
| N2 hors du lot 1, `LastExchangeView` supprimé, `Composer` réduit | **Caduques et retournées par C36.** Le rendu du dernier échange et le composer ne sont plus des dépendances cachées à retirer, ils sont devenus le produit. Mes trois recommandations reposaient sur une prémisse qui est tombée, et le nouveau découpage est meilleur que celui que je proposais. |
| 3 compteurs d'Activité sur 5 | Refusée, les 5 restent |

### 0.4 Les suppressions des passes 1 et 2 tiennent-elles ?

Vérifié une par une dans `03-architecture.md` :

| Supprimé | État |
|---|---|
| Module natif Swift `kovalink-transport` | **Tient.** `fetch` et `WebSocket` standards, "aucun module natif en v1", et il n'est mentionné que comme repli documenté si `tailscale cert` échoue. |
| Écouteur LAN | **Tient.** Un seul chemin Tailscale, vérifié par test unitaire, et pas de `NSLocalNetworkUsageDescription` dans `app.config.ts`. |
| `dispatch-action` | **Tient.** Retiré du protocole, commandes de pane en union littérale fermée de quatre variantes. |
| Routes d'écriture de fichiers | **Tient.** Aucune route `mkdir`, `move`, `copy`, `delete`, `reveal`, `thumbnail`. |
| 17 réglages | **Tient et progresse.** 4. |

Aucune régression de dégraissage, à une exception près : `resize-pane`, voir défaut D3.

### 0.5 Le changement de prémisse

C'est le point le plus important de cette passe, et il ne vient pas de moi. Découvrir que Robin
travaille en `bypassPermissions`, donc que le produit avait été conçu autour d'un moment qui ne se
produit presque jamais, vaut plus que tout ce que le panel a produit en deux passes. Le PRD en
tire les conséquences jusqu'au bout : les 5 moments sont réécrits, les scénarios re-classés (S1
devient "l'agent a fini, je lui donne la suite" à 45 %, le déblocage de prompt tombe à 8 %), et
les indicateurs de la section 1.3 sont refaits. Au passage, la contradiction que je signalais
depuis la passe 1 ("plus de 15 ouvertures par semaine" contre "plus de 60 % traitées sans ouvrir
l'app") disparaît d'elle même : l'indicateur est devenu "part des ouvertures qui aboutissent à un
message envoyé, plus de 50 %", qui mesure la bonne chose.

Et C37 mérite d'être signalé : le document refuse de déclarer satisfaits six critères
d'acceptation qu'il ne peut pas exécuter faute d'échantillon réel de prompt, les marque comme
tels, et écrit la procédure d'une demi-heure pour les rendre exécutables. Un document qui refuse
de se donner une bonne note sur du non testé est rare. C'est noté.

---

## 1. Notes par axe

| # | Axe | Poids | P1 | P2 | **P3** | Justification (une ligne) |
|---|---|---|---|---|---|---|
| 1 | Justesse du problème | 15 % | 9,0 | 9,0 | **9,5** | Le produit a été repointé sur le moment qui se produit réellement plusieurs fois par jour, les scénarios re-classés et les indicateurs refaits en conséquence, ce qui résout au passage la contradiction d'indicateurs que je signalais depuis deux passes. |
| 2 | Complétude fonctionnelle | 15 % | 9,0 | 8,5 | **9,0** | Le trou du lot 1 de la passe 2 est bouché (l'état `unparsable` a désormais un composer pour y répondre), l'interruption est rétablie sur quatre surfaces, et les critères d'acceptation sont honnêtement séparés entre exécutables et non exécutables, mais CA-84 interdit une commande que l'architecture spécifie. |
| 3 | Qualité de l'UX mobile | 15 % | 8,0 | 8,5 | **9,0** | La saisie de texte libre depuis l'écran verrouillé est supprimée (elle permettait d'approuver en tapant `1` sans Face ID, sans hash et sans relecture), les catégories statiques affichent la liste numérotée dans le corps pour que Robin lise ce que fait chaque chiffre, et la règle de troncature ne retire jamais `Refuser` ni `Interrompre`. |
| 4 | Solidité de l'architecture | 20 % | 8,5 | 8,5 | **9,0** | Les trois divergences sont fermées, `KeyGate` est le point d'entrée unique vérifié par une règle de lint et un test de comptage d'appelants, 10 routes au lot 1, toutes les suppressions tiennent, et le seul reproche de fond est `resize-pane` spécifié contre le PRD. |
| 5 | Sécurité | 15 % | 9,0 | 9,0 | **9,5** | C20 est fermé par un invariant élégant ("tout ce qui est affiché pour décider entre dans le hash, et rien de ce qui n'entre pas dans le hash n'est affiché"), C23 par une garde d'état sur les trois chemins qui laissaient partir un `\r` nu, et C26 supprime la seule surface qui contournait les trois garde-fous à la fois. |
| 6 | Simplicité | 10 % | 5,0 | 7,5 | **8,5** | Chaque composant du lot 1 porte désormais une colonne "pourquoi il est en lot 1" avec une justification réelle, deux réglages de plus sont morts, aucune suppression n'a été reprise en douce, mais le lot 1 pèse en réalité 3 420 lignes contre 2 300 en passe 2, dont environ 700 d'appareillage de prompt sur un chemin que le projet déclare lui même rare et ne sait pas encore tester. |
| 7 | Implémentabilité | 10 % | 9,0 | 8,0 | **8,5** | Un ingénieur peut démarrer lundi (chiffrage par module, Swift réel, `hashPrompt` en TypeScript réel, règle de lint nommée, procédure de fixtures écrite), sauf qu'il lira trois tailles différentes pour le lot qu'il s'apprête à construire. |

---

## 2. Note pondérée, calcul

```
Axe 1  9,5 x 0,15 = 1,425
Axe 2  9,0 x 0,15 = 1,350
Axe 3  9,0 x 0,15 = 1,350
Axe 4  9,0 x 0,20 = 1,800
Axe 5  9,5 x 0,15 = 1,425
Axe 6  8,5 x 0,10 = 0,850
Axe 7  8,5 x 0,10 = 0,850
                    -----
Total             = 9,050
```

**9,05 / 10.** Au dessus de la barre de 9,0. Aucun axe sous 7, le plus bas est à 8,5.

Progression : 8,35 puis 8,50 puis 9,05.

---

## 3. La liste de coupe restante

Une seule coupe mérite encore d'être discutée, le reste est de la coquille.

| # | Ce qui sort | Économie | Pourquoi en une phrase |
|---|---|---|---|
| 1 | **Le chemin de prompt *parsé* passe en lot 2** : grammaire du `PromptParser` (250 vers 60), `ValidationBar` et ses boutons (200 vers 0), catégories de notification à options (150 vers 60), `promptHash` et son transport. Le lot 1 garde le chemin *défensif* : détection de `awaiting`, état `unparsable`, repli monospace, pavé numérique, `Interrompre`. | ~510 l. | Le projet déclare lui même que ce chemin pèse 8 % des ouvertures et qu'il **ne peut pas être recetté** faute d'échantillon réel (C37, critères 11 à 16 non exécutables) : ce sont 700 lignes non testables sur le chemin critique du premier lot, pour un cas rare. |
| 2 | Rien d'autre. | | Les grosses coupes sont faites depuis la passe 2 et elles tiennent. |

**Ce n'est pas une coupe de protection, et je tiens à le dire explicitement.** Le `promptHash`
existe pour protéger des boutons. Sans boutons, il n'y a rien à protéger, et le comportement du
lot 1 devient le plus sûr qui existe : aucun bouton, jamais, Robin lit le pane en monospace et
tape le chiffre lui même. C'est exactement A6 règle 2, appliquée comme seul régime au lieu d'être
un repli. Ce qui reste en lot 1 et que je ne touche pas : la garde d'état de `KeyGate` (C23), qui
protège l'envoi de texte libre et qui est la protection qui compte vraiment maintenant que le
composer est le geste de tous les jours, la liste noire en écriture, l'authentification
asymétrique, la NSE, et l'interruption sans authentification.

Si le coordinateur refuse (argument recevable : le parseur est déjà écrit dans le document, et
capturer une fixture prend une demi-heure), alors la conséquence est arithmétique et doit être
assumée : le lot 1 fait 3 420 lignes et 7 jours, pas 2 620 et 5 à 6.

---

## 4. Le lot 1 : bon contenu, chiffrage faux

### 4.1 Le contenu est juste

"L'agent a fini, je donne la suite" est la bonne cible, et le fait que le rendu du transcript
remonte en lot 1 est la conséquence correcte du basculement, pas une dérive. Je l'avais moi même
exclu du lot 1 en passe 1 et en passe 2, et j'avais raison **sous l'ancienne prémisse** : quand le
produit servait à approuver, le transcript était du confort ; maintenant que le produit sert à
donner l'instruction suivante, le transcript est ce que Robin doit lire pour la formuler. Le
retournement est justifié et je le valide.

Le lot 1 n'a pas regonflé au delà de ce que le basculement justifie. Ce que C36 ajoute :
`TranscriptTailer` (400), rendu des turns (320), composer (120), soit 840 lignes. Ce que C21 et
C20 ajoutent : `KeyGate` et l'interruption, environ 180. Somme cohérente avec la croissance
observée. Rien n'est entré en fraude.

### 4.2 Le chiffrage, en revanche, est faux, et pour la troisième passe consécutive

`03-architecture.md` §7 annonce **2 620 lignes** et écrit deux paragraphes plus haut : "Celles-ci
sont les totaux réels des tableaux, dépendances comprises" et "Une estimation flatteuse ne rend
service à personne". Le tableau qui suit immédiatement totalise :

```
Daemon : 300 + 150 + 400 + 250 + 180 + 400 + 180 + 100        = 1 960
App    : 150 + 220 + 320 + 120 + 200 +  30 + 120 + 150 + 150  = 1 460
Total                                                          = 3 420
```

**3 420, soit 31 % au dessus des 2 620 annoncés**, dans le même écran, sous une phrase qui promet
le contraire. C'est le même défaut qu'en passe 2 (1 850 annoncés pour 2 300 réels) et qu'en
passe 1, en plus grand.

Et le PRD donne un troisième chiffre. Sa section 3.0 annonce "~3 200 lignes (2 600 établies avant
l'absorption du rendu du dernier échange, plus environ 600 pour ce rendu)". Or les 2 620 de
l'architecture **incluent déjà** le `TranscriptTailer` et le rendu des turns : l'absorption est
comptée deux fois. Trois documents, trois tailles pour le lot qu'on s'apprête à construire :
2 620, 3 200, 3 420.

### 4.3 Le total du projet

| Lot | Archi | PRD | Mon estimation |
|---|---|---|---|
| 1 | 2 620 annoncés | 3 200 | **3 420**, total du tableau de l'architecture |
| 2 | 2 500 | 2 400 | 2 500 à 2 800, crédible |
| 3 | 1 600 | 1 400 | 1 600 à 1 800, crédible |
| 4 | 550 | **absent** | 550 |
| **Total** | **7 270** | **7 000** | **environ 8 100** |

Deux remarques. Le total de 7 000 du PRD **oublie purement et simplement le lot 4** (durcissement
et distribution) : 3 200 plus 2 400 plus 1 400 font bien 7 000, et il n'y a pas de quatrième
ligne. Et l'écart global s'est réduit, de 26 % en passe 2 à environ 11 % ici : le chiffrage
progresse, il n'est pas encore juste.

**Chiffres honnêtes à écrire : lot 1 à 3 420 lignes et 6 à 7 jours, total à 8 100 lignes et 18 à
20 jours.** Avec la coupe de la §3, lot 1 à 2 900 lignes et 5 jours, total à 7 600.

---

## 5. Défauts bloquants

Aucun ne bloque l'implémentation. Ce sont trois corrections à appliquer avant le premier jour, pas
un motif de quatrième passe.

| # | Défaut | Correction |
|---|---|---|
| **D1** | **Le lot 1 porte trois tailles différentes** (2 620 en titre d'architecture, 3 420 dans le tableau juste en dessous, 3 200 dans le PRD qui compte l'absorption du transcript deux fois), sous une phrase qui promet des totaux réels. Troisième occurrence du même défaut. | Additionner le tableau, écrire 3 420 (ou 2 900 avec la coupe de la §3) dans les deux documents, et passer le délai de "5 à 6 jours" à "6 à 7". Une estimation est un engagement, pas un argument de vente. |
| **D2** | **Le total de 7 000 du PRD omet le lot 4.** Trois lignes additionnées sur quatre lots existants. | Ajouter la ligne du lot 4 et recalculer. |
| **D3** | **Régression de périmètre sur `resize-pane`.** Le PRD B6 écrit "le pane du Mac n'est jamais redimensionné depuis le téléphone, `resize-pane` n'est pas utilisée en v1", et CA-84 en fait un critère binaire ("le journal ne contient aucune commande `resize-pane`"). L'architecture met `resize-pane` dans l'union des commandes IPC, spécifie `Adapter à mon écran` qui l'envoie, le place en lot 2, et cite un "PRD B5" qui n'existe plus sous cette forme. CA-84 est donc conçu pour échouer. C'est le défaut que j'avais ouvert en passe 1 (B7) et qui avait été corrigé en passe 2. | Trancher pour le PRD, qui est le document normatif de périmètre : retirer `resize-pane` de l'union des commandes, remplacer `Adapter à mon écran` par le `Fit` purement client déjà spécifié, et corriger la référence croisée. |

### Améliorations souhaitables, non bloquantes

- Le PRD écrit `GET /v1/prompt/{prompt_ref}` en `snake_case`, le Design et l'architecture
  `{promptRef}`. Même route, deux graphies. Harmoniser sur `{promptRef}`.
- Le lot 1 annonce "11 routes", la table en liste 10. Compter.
- La table d'exclusion du `promptHash` justifie l'exclusion des espaces répétés par le fait qu'un
  `resize-pane` invaliderait sinon une réponse en vol. Une fois D3 corrigé, la justification tient
  toujours (Robin peut redimensionner depuis son Mac), mais il faut réécrire la phrase pour
  qu'elle ne s'appuie plus sur une commande qui n'existe pas.

---

## 6. Verdict

**PASSE.** Note pondérée **9,05**, au dessus de la barre de 9,0, aucun axe sous 7, le plus bas
à 8,5.

L'implémentation peut démarrer, sous réserve d'appliquer D1, D2 et D3 avant le premier jour de
code, ce qui prend une heure et ne demande aucun arbitrage : additionner un tableau, ajouter une
ligne à un total, retirer une commande.

Ce que je retiens des trois passes. Le corpus est passé de 4 636 lignes de spécification pour
8 700 lignes de code estimées à un projet dont chaque composant porte sa justification, dont
chaque suppression tient d'une passe à l'autre, et qui a eu l'honnêteté de changer de cible quand
il s'est avéré que le moment autour duquel il était construit ne se produisait presque jamais. Les
protections que je n'avais pas le droit de couper ont été renforcées, pas allégées : le hash
couvre maintenant la charge décisionnelle complète, un `\r` nu ne peut plus partir sans
vérification d'état, et la seule surface qui permettait d'approuver depuis un écran verrouillé
sans Face ID a disparu.

Ce qui reste à surveiller pendant l'implémentation, et ce n'est pas un défaut de document : le
lot 1 fera 3 420 lignes, pas 2 620. Au sixième jour, quand il ne sera pas fini, ce sera normal.
Autant l'écrire maintenant.
