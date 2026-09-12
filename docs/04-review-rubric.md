# Grille de notation du panel, KovaLink

Le panel note le PRD (01), le Design (02) et l'Architecture (03) **avant toute
implémentation**. Barre de passage : **> 9.0 / 10 sur chaque axe**, et aucun critère
individuel en dessous de 7. Un seul critère sous 7 bloque le lot entier, même si la
moyenne passe.

## Axes de notation (pondérés)

| # | Axe | Poids | Ce qui est noté |
|---|---|---|---|
| 1 | Justesse du problème | 15% | Le produit résout-il le vrai moment d'usage (débloquer un agent en 10s, en marchant, d'une main) ou une version imaginaire du besoin ? Les scénarios sont-ils classés par fréquence réelle ? |
| 2 | Complétude fonctionnelle | 15% | Les 3 blocs (Sessions, Terminal, Fichiers) sont-ils couverts ? Les cas d'erreur, vides, hors ligne, Mac en veille, Kova fermé sont-ils traités ? |
| 3 | Qualité de l'UX mobile | 15% | Utilisable au pouce ? La barre de validation est-elle traitée comme le composant central ? Le chat est-il lisible sur 6 pouces ? Les états sont-ils tous spécifiés ? |
| 4 | Solidité de l'architecture | 20% | Le protocole client/serveur est-il exhaustif et typé ? Reconnexion, socket Kova qui change de PID, tail incrémental, gros fichiers, veille : tout est-il traité ? |
| 5 | Sécurité | 15% | Les 5 contraintes de la section 6 du contexte sont-elles implémentées concrètement, pas juste évoquées ? L'accès disque total est-il correctement encadré (bind, token, TLS épinglé, audit) ? |
| 6 | Simplicité | 10% | Sur-ingénierie pénalisée lourdement. Un utilisateur, une machine. Chaque composant doit justifier son existence. |
| 7 | Implémentabilité | 10% | Un ingénieur peut-il coder sans reposer de question ? Wireframes présents, tokens chiffrés, schémas de payload réels, plan par lots ordonné par dépendances ? |

## Éliminatoires (note plafonnée à 6 si violé)

- [ ] Présence d'un tiret cadratin "—" dans un livrable. Exigence explicite de Robin.
- [ ] Contradiction avec une décision arrêtée en section 5 du contexte.
- [ ] Proposition de re-débattre d'un choix déjà tranché (réseau, stack, UX, compte Apple, périmètre fichiers).
- [ ] Critère d'acceptation non testable par oui/non.
- [ ] Faille de sécurité : bind sur 0.0.0.0, absence d'authentification, token en clair.

## Format de sortie du panel

Chaque relecteur produit :
1. Une note par axe, sur 10, avec **une justification d'une ligne**. Une note sans
   justification ne compte pas.
2. La note pondérée globale.
3. Les **défauts bloquants** (ce qui empêche de passer 9), formulés comme des
   corrections actionnables, pas comme des critiques générales.
4. Les **améliorations souhaitables** (non bloquantes).

Un relecteur qui met 9+ partout sans avoir identifié de vrai défaut est un mauvais
relecteur : le rôle du panel est de trouver ce qui casse, pas de valider par politesse.
