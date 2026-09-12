# Décision finale : on implémente

Panel passe 3 : pragmatisme **9,05 PASSE**, produit 8,60, technique 8,18.
Moyenne 8,61 (7,40 puis 8,43 puis 8,61). Aucun axe sous 7 sur les trois revues.
Axe Sécurité passé de 5,0 à 9,0, et le relecteur technique écrit pour la première fois
"je ne trouve plus aucune faille de sécurité ouverte".

**Robin a décidé d'arrêter le cycle de revue et de lancer l'implémentation.** Les défauts
restants sont des raccords entre documents, pas des défauts de conception. Ils passent en
liste de reprise et se corrigent pendant le code, pas avant.

## D1. Le déclencheur de fin de tour : MESURÉ, et ce n'était pas celui annoncé

J'avais affirmé que `pane-status.awaiting` se levait à la fin d'un tour. **C'était faux.**
Capture du flux `subscribe` en lecture seule, 5 panes, plusieurs minutes, agents terminant
réellement leurs tours :
- `pane-status` : **0 événement**. `awaiting` reste `false` sur tous les panes.
- `pane-working` : **33 événements**, 11 vers `true`, 22 vers `false`, à chaque fin de tour.

**Décision : le déclencheur du lot 1 est le front descendant de `pane-working`**, confirmé
par le tail du JSONL (tour assistant clos, aucun `tool_use` en attente). Cette double
condition élimine les faux positifs d'un outil long qui rend la main brièvement.

`awaiting` n'est PAS utilisable sur cette machine (mode bypass, cf. C37). Le chemin de
prompt de permission reste écrit défensivement mais n'est ni testable ni sur le chemin
critique. Il descend en lot 2, conformément à la recommandation du relecteur pragmatisme.

Conséquence heureuse : la détection de fin de tour ne dépend plus du tout d'un drapeau
Kova non vérifiable, mais de données que le daemon lit déjà.

## D2. Liste de reprise (à corriger pendant l'implémentation, pas avant)

| # | Défaut | Où | Décision |
|---|---|---|---|
| R1 | Catalogue de catégories de notification divergent (`KL_AWAITING_2/3/BLIND` contre `KL_OPT2/KL_OPT3/KL_OPEN`) | 3 docs | **Le PRD fait foi.** Le code n'écrit qu'une seule fois cette énumération, dans `packages/protocol`, et les deux moitiés l'importent. Un identifiant non reconnu par iOS donne une bannière sans bouton, en silence : c'est le protocole partagé qui l'empêche, pas un document. |
| R2 | État `turn_end` absent de l'architecture, branchement NSE à 2 voies au lieu de 3 | Archi, Design | Union à 3 états : `turn_end`, `parsed`, `unparsable`. Discrimination par le JSONL (tour clos sans `tool_use` en attente), pas par le parsing du terminal. |
| R3 | `promptRef` déclaré à usage unique alors que 3 consommateurs le lisent (NSE, action rapide, lien profond) | Archi | Référence valable jusqu'à résolution du prompt ou 10 min, pas usage unique. L'usage unique cassait toutes les actions rapides dès la première notification. |
| R4 | `resize-pane` présent dans l'architecture alors que le PRD l'interdit et qu'un critère teste son absence | Archi | Retirer. Signalé en passe 1 et réapparu. |
| R5 | Chiffrage faux pour la troisième passe consécutive | PRD, Archi | Chiffre retenu : **environ 8 100 lignes, 18 à 20 jours**. Ne plus annoncer d'estimation qui ne soit pas la somme du tableau qui la précède. |

## D3. Périmètre du lot 1, définitif

1. Appairage (QR, Tailscale, `tailscale cert`), jeton en trousseau, TLS.
2. Client IPC Kova (découverte du socket par glob, reconnexion, PID qui change).
3. `subscribe` et suivi d'état des panes.
4. Liste des sessions avec état live et badge `permissionMode`.
5. **Détection de fin de tour** (front descendant de `pane-working` + JSONL) et push APNs.
6. Tail incrémental du JSONL et rendu du dernier échange (groupé par `requestId`).
7. Composer : envoi de texte via `KeyGate` (assaini, bracketed paste).
8. **Interrompre**, depuis la liste, la session et la notification.
9. Repli monospace (~30 lignes), pas de xterm.js.

Hors lot 1 : chemin de prompt parsé (lot 2), terminal xterm.js (lot 2), fichiers et Share
Extension (lot 3).
