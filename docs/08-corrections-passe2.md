# Ordre de correction consolidé, passe 2

Panel passe 2 : produit 8,30 · pragmatisme 8,50 · technique 8,48. Moyenne 8,43 (contre 7,40).
**Aucun axe sous 7 sur les trois revues**, les plafonds de la passe 1 sont levés.
Trois verdicts NE PASSE PAS, la barre restant à 9,0.

Les défauts restants sont de deux natures seulement : un garde-fou insuffisant, et de la
désynchronisation entre les trois documents. C'est une passe de convergence, pas de refonte.

---

## Partie 0. Changement de prémisse validé par Robin

Le relecteur technique a établi que **toutes les sessions de Robin tournent en
`bypassPermissions` ou `auto`**. Les prompts de permission sont donc rares, voire absents.
Robin a confirmé et a tranché : **le lot 1 change de cible.**

Ce qui ne change pas : le déclencheur reste `pane-status.awaiting`, qui se lève aussi bien
quand l'agent demande une permission que quand il a fini et attend l'instruction suivante.
La chaîne de notification est identique. Seul le rendu à l'ouverture diffère.

### C36. Nouveau lot 1 : "l'agent a fini, je donne la suite"
Contenu du lot 1 :
1. Appairage (QR, Tailscale, `tailscale cert`).
2. Liste des sessions avec état live (`working`, `awaiting`, `idle`).
3. Notification push sur front montant de `awaiting`.
4. Ouverture d'une session : **rendu du dernier échange** depuis le JSONL (message
   utilisateur, réponse assistant regroupée par `requestId`, appels d'outils repliés).
   Le rendu du transcript **remonte du lot 2 au lot 1**, il est désormais sur le chemin critique.
5. Composer : envoi d'un message texte (assaini, bracketed paste).
6. **Interrompre**, depuis la liste et depuis la session (voir C21).
7. Barre de validation : **conservée**, mais elle n'est plus la justification du lot.
   Elle sert quand un prompt survient malgré le mode bypass (mode plan, question explicite).

Sort du lot 1 : le terminal xterm.js complet (lot 2), le bloc fichiers et la Share
Extension (lot 3). Le repli monospace de A6 reste dans le lot 1.

### C37. Le parseur de prompts n'a aucun échantillon réel
Conséquence directe du mode bypass. Interdiction d'inventer une grammaire crédible et de
la présenter comme vérifiée. Le parseur doit être écrit **défensif par défaut** (A6) : en
l'absence d'échantillon, l'état `unparsable` est le comportement attendu et non un cas
d'erreur. Les critères d'acceptation portant sur le parsing doivent être marqués comme
**non exécutables en l'état**, avec la procédure pour les exécuter (lancer une session en
mode permissions par défaut et capturer un prompt réel). Ne pas les déclarer satisfaits.

---

## Partie I. Le garde-fou insuffisant

### C20. Le `promptHash` doit couvrir le détail, pas seulement la question
Défaut le plus grave de la passe 2, trouvé par le relecteur technique.
Le hash porte aujourd'hui sur la ligne de question et les libellés d'options. Or deux
demandes `Bash` consécutives partagent la même question et les mêmes libellés, donc
**produisent le même hash**. Le scénario revendiqué comme neutralisé depuis la passe 1
(prompt N en lecture, prompt N+1 en `rm -rf`, approbation de la mauvaise) ne l'est pas.

Le hash doit être calculé sur la **charge décisionnelle complète** : la question, les
libellés d'options dans l'ordre, **et le bloc de détail** (commande, chemin de fichier,
diff). Le marqueur de surlignage reste exclu. Documenter explicitement ce qui entre dans
le hash et ce qui en est exclu, avec la justification pour chaque exclusion.

### C21. L'interruption doit être rétablie en lot 1
Régression du dégraissage de la passe 1 : `dispatch-action` retiré et `pane.sendKeys`
repoussé en lot 2 ont orphelin le geste que A7 rend explicitement le plus facile.
Aujourd'hui : aucun message, aucune route, aucune action de notification, et CA-15
inexécutable. À rétablir comme opération de premier ordre : message dédié
`pane.interrupt {paneId}`, route, action depuis la liste, action depuis la session, action
de notification. Aucune authentification (A2). Passe par `KeyGate` comme tout le reste.

### C23. Les chemins résiduels qui laissent partir un retour chariot seul
Trois chemins identifiés émettent encore `\r` sans revérifier l'état : le second appel de
`pane.sendText`, `sendKeys(['enter'])`, et `term.input(['enter'])`. Le mot `awaiting`
n'apparaît nulle part dans `KeyGate`.
Règle imposée : **aucun retour chariot ne part sans passer par une vérification d'état**.
Soit la réponse à un prompt, protégée par `promptHash` (C20), soit l'envoi d'un texte
utilisateur, qui doit vérifier que le pane n'est pas en `awaiting` avec un prompt parsé,
et refuser sinon. `KeyGate` est le seul point d'entrée et porte cette règle.

---

## Partie II. Convergence des trois documents

Chaque ligne désigne la version qui **fait foi**. Les autres s'alignent, sans débat.

| Réf | Conflit | Version qui fait foi |
|---|---|---|
| C24 | Route de récupération de la question par la NSE, deux versions | `GET /v1/prompt/{promptRef}`, référence opaque à usage unique, jeton court dédié à la NSE. Ne fuite pas l'identifiant de pane. |
| C25 | La NSE peut-elle ré-enregistrer une catégorie pour afficher les vrais libellés ? | **Capacité non documentée, abandonnée.** Catégories **pré-enregistrées statiquement** (2, 3 ou 4 options). Les boutons portent les chiffres. La NSE réécrit le **corps** de la bannière avec la question, le détail et la liste numérotée des options. Robin lit ce que fait chaque chiffre, et tout reste dans le comportement documenté par Apple. |
| C26 | Saisie de texte libre depuis la bannière (`Répondre…`, `Continuer…`) | **Supprimée.** Version de l'architecture. Le Design l'exposait avec `authenticationRequired: false`, ce qui permet d'approuver l'option 1 en tapant `1` depuis un iPhone verrouillé, sans Face ID, sans hash, sans relecture. Contourne les trois garde-fous à la fois. |
| C27 | Repli quand la NSE échoue, trois versions | Bannière "Validation requise", **aucune action d'approbation**, actions `Ouvrir` et `Interrompre` uniquement, ouverture forcée de l'app. Satisfait CA-09. |
| C28 | Réglage "Extraits dans les notifications", sémantiques opposées | **Réglage supprimé.** La NSE récupère toujours la question sur le canal chiffré direct, donc la charge utile n'a jamais besoin de contenu sensible. Le réglage n'a plus d'objet et sa version Archi, désactivée, tuait toutes les actions rapides. Réglages : **5 vers 4**. |
| C29 | Seuil de la notification N2 : 60 s ou 20 s | **60 s**, valeur du PRD, qui la déclare opposable. |
| C30 | 7 actions de notification pour une limite iOS de 4 | Règle de troncature explicite : les options par ordre d'index, puis `Interrompre`. `Refuser` et `Interrompre` ne sont **jamais** retirés. Au delà de 4 options, **aucune action rapide**, ouverture forcée. |
| C31 | `Muter` par balayage, sans moyen de démuter | **Supprimé.** Couper silencieusement et définitivement la notification qui justifie le produit est un piège. Les heures calmes couvrent déjà le besoin. |
| C32 | `Interrompre` inatteignable depuis la liste pour un pane qui travaille | Rendu atteignable. C'est le cas S4. Voir C21. |
| C22 | `queue-operation` rendu en bulle utilisateur | **Ignoré, jamais rendu.** Mesure du relecteur : 20 entrées, 11 blobs XML de notification, 9 `null`, zéro message de Robin. La règle injecterait du XML dans le fil. |
| C34 | Marqueur `Full output saved to:` pour `tool-results/` | **Mécanisme retiré.** Le marqueur n'existe pas dans les transcripts réels : les 5 occurrences trouvées étaient des citations de la revue elle même. Ne pas spécifier une route qui promet un résultat complet inaccessible. |
| C35 | Budget de rejeu du `.raw`, trois valeurs | Une seule valeur dans les trois documents. Retenu : **2 Mo**. |
| C33 | Estimations de volume optimistes | Chiffres honnêtes : lot 1 environ **2 600 lignes** (et non 1 850), total environ **7 000** (et non 5 550). Le lot 1 ayant absorbé le rendu du transcript (C36), réestimer. Une estimation flatteuse ne rend service à personne. |

---

## Barre de sortie

Passe 3 du panel. Barre inchangée : **> 9,0 de moyenne pondérée et aucun axe sous 7**,
sur les trois revues. C20, C21, C23 et C26 sont éliminatoires.
Effort estimé par le panel pour cette passe : une demi-journée.
