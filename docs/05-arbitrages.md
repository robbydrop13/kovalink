# Arbitrages du coordinateur

Décisions prises par le coordinateur sur les points laissés ouverts par les spécialistes.
Elles ont valeur de décision arrêtée : les livrables doivent s'y conformer.

## A1. Veille du Mac pendant qu'un agent travaille
**Décision : oui, avec un périmètre strict.**
Le daemon pose une assertion d'alimentation IOKit de type `PreventUserIdleSystemSleep`
uniquement tant qu'au moins un pane a `working: true`, et la relâche dès que le dernier
agent s'arrête. Équivalent d'un `caffeinate -i` conditionnel.
On ne cherche PAS à contrer la fermeture du capot : c'est un comportement attendu par
l'utilisateur et le contrer serait une mauvaise surprise (batterie, chaleur dans un sac).
Conséquence à documenter dans l'app : capot fermé sur batterie, la session est suspendue.
L'écran Réglages doit exposer un interrupteur pour désactiver l'assertion.

## A2. Face ID sur les réponses de validation
**Décision : asymétrique, sur le sens du risque.**
- **Approuver** (toute réponse qui autorise une action) : Face ID obligatoire depuis
  l'écran verrouillé. C'est l'action qui engage le disque entier.
- **Refuser, et Interrompre (Esc)** : aucune authentification.
Justification : refuser est l'action sûre par défaut. Exiger Face ID dessus ajoute de la
friction sur le geste défensif, ce qui pousse l'utilisateur à approuver par facilité.
C'est exactement l'incitation inverse de celle qu'on veut. Le pire cas d'un refus non
authentifié est un agent bloqué, pas un disque modifié.

## A3. Ordre de livraison
**Décision : A puis B puis C, confirmé.**
Bloc A (Sessions et chat) livre à lui seul 90% de la valeur. Bloc B (terminal) est le
filet de sécurité. Bloc C (fichiers) est autonome et peut donc être décalé sans rien
casser. Le lot 1 doit rester la plus petite chaîne bout en bout démontrable.

## A4. Taille des fichiers
**Décision : pas de plafond arbitraire, mais du flux et de la reprise.**
Le plafond de 200 Mo est rejeté : Robin travaille sur de la vidéo, il buttera dessus.
À la place : transferts en flux dans les deux sens (jamais de fichier entier en mémoire,
ni sur le daemon ni dans l'app), upload découpé en morceaux avec reprise après coupure
réseau, et **avertissement explicite au delà de 100 Mo en données cellulaires** avec
choix de différer jusqu'au Wi-Fi. La limite réelle devient l'espace disque, pas un chiffre
inventé.

## A5. Agents non-Claude
**Décision : rendu chat réservé à `agent == "claude"`, repli terminal sinon, confirmé.**
Codex et tout futur agent tombent sur l'onglet Terminal, qui est universel par
construction. Aucun effort d'adaptation en v1. La bascule doit être silencieuse et
explicable : un bandeau "Vue chat indisponible pour cet agent" avec le bouton vers le
terminal, pas un écran vide.

## A6. Source de vérité des prompts de permission (issue de la découverte du PM)
**Décision : `get-pane-content` en `mode: visible`, avec parseur défensif.**
Le PM a établi que le prompt de permission de Claude Code n'apparaît pas dans le
transcript JSONL. Le rendu chat se construit donc sur DEUX sources jointes :
- le JSONL pour l'historique de conversation (messages, appels d'outils, résultats),
- `get-pane-content` pour l'état interactif courant (question de permission en attente).

Règles imposées au parseur, non négociables :
1. Le nombre d'options est **variable**. Jamais 3 en dur.
2. Si le parsing échoue ou est ambigu, l'app **n'affiche aucun bouton** et bascule sur
   le terminal avec un message clair. On ne devine jamais un bouton.
3. Chaque réponse rapide porte le `prompt_hash` (SHA-256 de la question et des options
   telles qu'affichées). Le daemon **revérifie ce hash contre l'état courant du pane juste
   avant d'émettre `send-keys`**. Si l'écran a changé, l'envoi est refusé et l'app le
   signale. C'est le garde-fou qui empêche d'approuver la mauvaise action.
4. Le sondage de `get-pane-content` est déclenché par l'événement `pane-status.awaiting`,
   jamais en boucle permanente.

## A7. Boutons Oui / Non directement sur l'écran Sessions
**Décision : non pour approuver, oui pour interrompre.**
Un bouton "Oui" dans une liste permet d'autoriser une action dont on n'a pas lu l'énoncé.
C'est le scénario d'accident le plus probable de toute l'application, et il est en
contradiction directe avec le garde-fou du `prompt_hash` (A6) : valider sans avoir lu
rend le hash inutile, puisqu'il ne protège que contre un changement d'écran, pas contre
l'absence de lecture. Approuver exige donc d'ouvrir la session.
En revanche, **Interrompre (Esc)** est autorisé depuis la liste : action sûre, sans
conséquence, et c'est le geste qu'on veut rendre le plus facile possible.
La ligne de la liste affiche donc : un aperçu tronqué de la question, un bouton
"Ouvrir" proéminent, et une action secondaire "Interrompre".

## A8. Extraction des options de permission
**Résolu par A6.** Le parseur est défensif, le nombre d'options est variable, et l'échec
de parsing conduit au repli terminal sans aucun bouton. Le design doit donc spécifier
l'état "question détectée mais non parsable", qui est un état de premier ordre et non un
cas limite. L'ingénieur daemon et le designer sont alignés sur ce contrat.

## A9. Mode clair
**Décision : v1 sombre uniquement, mode clair en v1.1.**
Les tokens du mode clair sont déjà spécifiés dans le design, ils restent dans le
document. Ils ne sont simplement pas câblés dans le lot 1. Cela ne coûte rien plus tard
puisque la couche de tokens existe dès le départ.

## A10. Authentification sur les actions rapides de notification
**Résolu par A2.** `authenticationRequired: true` sur l'action Approuver,
`false` sur Refuser et Interrompre.

## A11. Écouteur LAN séparé : supprimé
**Décision : on renonce à un second écouteur LAN. L'intention de Robin est préservée.**
Robin a demandé "Tailscale + fallback LAN" pour une raison : la latence quand il est chez
lui. Or Tailscale établit **déjà** une connexion directe de pair à pair quand les deux
appareils sont sur le même réseau local, sans passer par un relais. La latence LAN est
donc obtenue sans écrire une seule ligne de code supplémentaire.
Un second écouteur ajouterait une surface d'écoute, une seconde identité TLS, une logique
de bascule, et environ 200 lignes de Swift, pour dupliquer un comportement déjà fourni.
C'est de la sur-ingénierie, pénalisée par la grille.
Limite acceptée et documentée : au démarrage à froid sans aucun accès Internet, Tailscale
peut échouer à s'authentifier. Cas marginal pour un usage mono-utilisateur, on l'assume.
L'indicateur de connexion dans l'app doit distinguer "direct" de "relayé", information que
Tailscale expose, pour que Robin comprenne sa latence sans avoir à deviner.

## A12. TLS : `tailscale cert` plutôt qu'auto-signé épinglé
**Décision : certificat Let's Encrypt via `tailscale cert` sur le nom MagicDNS.**
Conséquence majeure : l'épinglage SPKI disparaît, et avec lui la justification principale
du module natif Swift. Un `WebSocket` et un `fetch` standards suffisent, puisque le
certificat est validé par la chaîne de confiance système.
**Le module natif Swift sort donc du lot 1.** Il pourra revenir plus tard, et uniquement
si les transferts de fichiers en arrière-plan (`URLSession` background) le justifient,
ce qui est un besoin du bloc C, pas du bloc A.
Repli documenté si la fonction HTTPS du tailnet ne peut pas être activée : on retombe sur
l'auto-signé épinglé tel que spécifié par l'architecte, qui reste valide.
Renouvellement du certificat : tâche périodique, la clé privée n'est jamais régénérée.

## A13. Anti-veille
**Décision : assertion active tant qu'un pane a `working: true`, plafond 4 h.**
Précision sur la proposition de l'architecte : le déclencheur est l'agent qui travaille,
**pas** la présence d'un client connecté. Tout l'intérêt du produit est que l'agent
continue à tourner pendant que Robin est parti, téléphone rangé, app fermée.
Le plafond de 4 h est retenu comme filet de sécurité contre une assertion oubliée.

## A14. Contenu des notifications push
**Décision : aucun extrait de transcript dans la charge utile, par défaut.**
La charge utile transite par le service de push d'Expo puis par APNs. Elle ne doit
contenir que : le nom du projet, l'identifiant du pane, et le type d'événement.
Le texte de la question se récupère à l'ouverture, par le canal chiffré direct.
Un interrupteur dans les Réglages permet à Robin d'activer les extraits s'il juge le
compromis acceptable, désactivé à l'installation.

## A15. Historique du terminal
**Contrainte imposée par la découverte de l'architecte.**
`mode: "scrollback"` renvoie zéro octet sur un pane Claude Code, car l'agent occupe
l'écran alterné. Il est donc **interdit de s'appuyer dessus** pour l'historique.
Sources retenues : le JSONL pour la conversation, le fichier `.raw` pour le terminal.
Le `.raw` étant un flux de redessin avec positionnement absolu et non un journal
append-only, la stratégie est la **resynchronisation** (rejouer depuis un point sûr et
laisser l'émulateur converger), jamais le rejeu intégral.
Le daemon doit aussi purger les `.raw` orphelins d'instances Kova mortes, repérables par
un PID qui ne tourne plus (exemple observé : PID 21975).

## A16. Regroupement des lignes du transcript
**Contrainte imposée.** Les lignes `assistant` du JSONL sont éclatées à raison d'un bloc
par ligne. Le parseur **doit** les regrouper par `requestId`, faute de quoi une réponse
unique s'affiche en trois bulles distinctes. Le champ `usage` est répété à l'identique sur
chacune de ces lignes : il ne doit jamais être sommé.
Les transcripts de sous-agents (`<sessionId>/subagents/agent-*.jsonl`) sont joints par
`toolUseId` et rendus comme un bloc pliable dans la bulle de l'outil parent, jamais comme
une conversation de premier niveau.
