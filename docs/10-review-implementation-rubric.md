# Grille de notation du panel, implementation

Le panel note le CODE tel que committe en `2212651`, pas les documents. Barre de passage :
**> 9,0 / 10 en moyenne ponderee et aucun axe sous 7**, comme pour les specs.

Le code a deja subi deux audits qui ont trouve et corrige 40 bugs. Le panel ne doit pas
refaire ces audits : il doit juger ce qui reste, et trouver ce que les audits ont manque.

## Axes

| # | Axe | Poids | Ce qui est note |
|---|---|---|---|
| 1 | Justesse fonctionnelle | 15% | Le code fait-il ce que le PRD (`01-prd.md`) et la decision finale (`09-decision-finale.md`) demandent pour les lots 1 et 3 ? Les criteres d'acceptation marques executables passent-ils reellement ? |
| 2 | Securite | 20% | `KeyGate` point d'entree unique, `promptHash` sur la charge complete, liste noire en ecriture apres resolution des liens, jeton jamais journalise, bind jamais sur `0.0.0.0`, aucune route destructrice. Chaque protection doit etre VERIFIEE dans le code et si possible testee en vrai, pas lue dans un commentaire. |
| 3 | Robustesse | 15% | Reconnexions, socket Kova qui change, lignes JSONL partielles, pane ferme pendant l'affichage, Mac en veille, Expo Go sans push, aucun ecran vide, aucun echec silencieux. |
| 4 | Contrat partage | 15% | Tout ce qui traverse la frontiere daemon/app vit-il dans `packages/protocol` ? Reste-t-il une constante, une route, un format ou une unite declaree en double ? C'est la famille de bugs la plus couteuse de ce projet. |
| 5 | Simplicite | 10% | Sur-ingenierie penalisee. Code mort, abstractions sans second usage, options jamais lues. |
| 6 | Tests | 15% | Les 221 tests couvrent-ils ce qui casse en production ? Testent-ils des comportements ou des details d'implementation ? Qu'est-ce qui n'est pas teste et devrait l'etre ? |
| 7 | Exploitabilite | 10% | README exacts, service launchd, journaux utiles, un nouveau developpeur peut-il installer et lancer en suivant les instructions sans rien deviner ? |

## Eliminatoires (note plafonnee a 6)
- Une protection de securite contournable trouvee et reproduite.
- Un tiret cadratin dans le code, les commentaires ou les README.
- Un echec silencieux qui affiche un message trompeur (regle du projet).

## Format de sortie
Note par axe justifiee en une ligne, note ponderee, defauts bloquants actionnables avec
fichier et ligne, verifications empiriques avec resultat brut, verdict PASSE ou NE PASSE PAS.
