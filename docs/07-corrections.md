# Ordre de correction consolidé, passe 1

Panel : produit 7,20 · pragmatisme 8,35 · technique 6,65. Moyenne 7,40.
**Trois verdicts NE PASSE PAS.** Cinq axes sous le plancher de 7 sur l'ensemble des revues.

Ce document fusionne les trois revues, arbitre leurs conflits, et vaut ordre de correction.
Priorité absolue aux défauts C1 à C8 : ce sont ceux qui rendent le produit dangereux.

---

## Partie I. Les défauts qui rendent le produit dangereux

### C1. `approve` doit envoyer le chiffre, jamais un retour chariot seul
Trouvé par les revues produit et technique. Défaut le plus grave du lot.
`approve -> "\r"` valide **la ligne surlignée sur le Mac**, pas celle lue sur le téléphone.
Curseur sur "Yes, and don't ask again", et un tap accorde une permission permanente.

Contrat imposé :
1. Le client envoie `{action:"answer", paneId, optionIndex, promptHash}`. Jamais "approve".
2. Le daemon relit le pane, recalcule le hash, et **refuse** si différent.
3. Il émet le chiffre **et** l'Entrée dans **un seul `send-keys` atomique**. Le délai de
   300 ms entre les deux est supprimé : il ouvre une fenêtre où Claude peut enchaîner sur
   une autre question et recevoir l'Entrée.
4. La position du curseur du Mac n'est **jamais** une entrée de la décision.

### C2. `promptHash` doit exister dans le protocole
Le garde-fou central du PRD (A6) est absent des 400 lignes de types de l'architecture.
Le test `awaiting === true` ne détecte pas un changement de question, donc il ne protège
de rien. À ajouter comme type de premier ordre, calculé sur la question **et** la liste
des options telles qu'affichées au client, et revérifié juste avant émission.

### C3. Le prompt, le parseur et l'état "non parsable" doivent exister dans le protocole
Le composant central du design (section 4.3) est aujourd'hui inimplémentable : aucun
message `prompt`, aucun parseur, aucun état d'échec. À ajouter, avec le contrat A6 :
nombre d'options variable, aucun bouton deviné, repli terminal explicite si ambigu.

### C4. La notification doit afficher la question qu'elle fait approuver
Trou créé par mon arbitrage A14. Retirer l'extrait de la charge utile était juste, mais
laissait Robin approuver une question invisible.
Correction retenue : **Notification Service Extension** qui récupère la question sur le
canal chiffré direct et réécrit la bannière avant affichage. La charge utile reste vide de
contenu sensible. Si la récupération échoue, la bannière affiche "Validation requise" sans
aucune action rapide, et force l'ouverture de l'app.

### C5. Liste noire en écriture sur les chemins de persistance et de secrets
Faille la plus grave de la revue technique. Un jeton volé devient aujourd'hui une prise de
contrôle permanente du Mac via `~/Library/LaunchAgents/`, `~/.zshrc`, `~/.ssh/authorized_keys`.

**Décision du coordinateur, et écart assumé par rapport au périmètre initial :**
la **lecture** reste totale sur tout le disque, conformément au choix de Robin.
L'**écriture** est refusée sur une liste noire courte et explicite :
`~/Library/LaunchAgents`, `~/Library/LaunchDaemons`, `/Library/Launch*`, le plist et le
répertoire du daemon lui même, `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/kova`,
`~/.claude`, `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `~/.profile`, `/etc`,
tout `.app` et tout ce qui est exécutable.
Justification : ces chemins ne sont pas "les fichiers de Robin", ce sont les mécanismes de
démarrage automatique et d'authentification de la machine. Les exclure de l'écriture ne
retire aucun usage réel et supprime la transformation d'un vol de jeton en persistance.
La liste est déclarée dans un fichier de configuration, Robin peut la vider s'il le décide.

### C6. Assainissement de `send-keys` et de toute entrée terminale
Aucun filtrage aujourd'hui, et `TermInput{data:string}` contourne la liste blanche que le
document prétend appliquer. À imposer :
- Suppression des caractères de contrôle hors `\n`, `\t`, et les touches explicitement
  autorisées par le client (flèches, Esc, Ctrl+C), qui passent par un **type énuméré** et
  non par du texte libre.
- Interdiction des séquences OSC, en particulier OSC 52 (écriture du presse papier).
- Bracketed paste obligatoire sur tout envoi de texte utilisateur.
- `TermInput` passe par exactement le même filtre. Un seul point d'entrée, une seule règle.

### C7. `dispatch-action` doit être un type énuméré
Chaîne libre présentée comme "liste blanche stricte". Elle donne accès à
`close-pane-or-tab` et `paste`. Remplacer par une énumération TypeScript fermée,
limitée aux actions réellement utilisées par l'app. En v1 : aucune. La commande sort du
lot 1 tant qu'aucun écran n'en a besoin.

### C8. Cycle de vie du jeton
- Jamais dans `Sec-WebSocket-Protocol`. Authentification par en tête `Authorization`,
  ou par ticket court obtenu sur une route HTTP dédiée.
- Stockage côté Mac dans le **trousseau macOS** (`security add-generic-password`),
  jamais dans un `secret.bin` en clair. Motif aggravant : des agents de code tournent sur
  cette machine et peuvent lire un fichier en clair.
- Expiration et rotation. Révocation depuis l'écran Réglages, effective immédiatement.
- Règle de rédaction des journaux : le jeton n'apparaît dans aucun log, aucune URL,
  aucun message d'erreur.
- Le QR code d'appairage expire après 3 minutes et disparaît de l'écran.

---

## Partie II. Corrections de justesse technique (vérifications empiriques du panel)

### C9. Pane fermé pendant l'affichage
`get-pane-content` sur un pane inexistant renvoie `ok:true` avec `{"error":"not found","id":N}`,
cas jamais modélisé, qui laisse `cols`/`rows` à `undefined` et casse le rendu.
À modéliser explicitement, avec l'écran "cette session n'existe plus" côté app.

### C10. Purge des `.raw` orphelins
`kill(pid, 0)` est faux à cause de la réutilisation des PID (le PID 488 est aujourd'hui
`sociallayerd`). Croiser avec la liste réelle des sockets `/tmp/kova-*.sock` vivants et la
date de modification du fichier. Contexte : 1,1 Go de logs Kova présents, 5 PID, 1 vivant.

### C11. Regroupement par `requestId`
La distribution réelle va de 1 à 5 blocs, pas "2 ou 3". Aucune hypothèse sur le nombre.

### C12. Types de lignes JSONL
12 types réels contre 10 énumérés. Ajouter `queue-operation` et `system`. Traiter
`tool-results/` non documenté, alors qu'une route promet le résultat complet.
Règle générale : tout type inconnu est ignoré silencieusement, jamais une erreur bloquante.

### C13. Croissance du `.raw`
145,2 Ko par minute mesuré, soit 4,3 Mo pour une demi heure de déconnexion.
La resynchronisation est confirmée comme le bon choix. Fixer explicitement le budget
d'octets rejoués et le comportement au delà.

### C14. Certificat
`selfsigned.generate` régénère la clé à chaque appel, donc le SPKI "stable à vie" est
impossible. Sans objet sur le chemin principal depuis A12 (`tailscale cert`), mais le
repli documenté doit être corrigé ou retiré.

---

## Partie III. Mise en conformité avec les arbitrages

Ces documents ont été écrits avant, ou en parallèle, des arbitrages. À aligner sans débat.

| Réf | À corriger | Où |
|---|---|---|
| A2, A10 | Face ID sur Approuver uniquement. La revue technique a trouvé une section revendiquant l'approbation **sans** Face ID depuis l'écran verrouillé, et en faisant un critère d'acceptation. Inverse exact de la décision. | PRD 5.2, Design, Archi |
| A4 | Un seul plafond de fichier dans les trois documents : **aucun plafond**, flux et reprise, avertissement au delà de 100 Mo en cellulaire. Trois valeurs contradictoires circulent (200 Mo, 5 Go, autre). | Les trois |
| A7 | Suppression des boutons Oui/Non en ligne sur l'écran Sessions. Conserver "Ouvrir" et "Interrompre". | Design |
| A11 | Retrait de l'écouteur LAN et de tout indicateur de bascule LAN/Tailscale. Remplacé par l'indicateur direct/relayé. | Archi, Design |
| A12 | Retrait du module natif Swift et de l'épinglage SPKI du lot 1. | Archi |
| A13 | Assertion IOKit sur `working:true` avec plafond 4 h, et non `caffeinate -s` déclenché par client attaché. | Archi |
| PRD | Le Design ouvre suppression et renommage de fichiers, que le PRD exclut. Aligner sur l'exclusion. | Design |
| Tous | Supprimer les sections 9 qui rouvrent des décisions déjà tranchées. Un livrable ne rouvre pas un arbitrage. | Les trois |

---

## Partie IV. Périmètre et séquencement

### C15. Le lot 1 est redéfini : "le déblocage"
Le lot 1 actuel demande 6 jours pour livrer une liste en lecture seule inutilisable.
Nouveau lot 1, chaîne complète et minimale : **notification reçue, question lue et
vérifiée, approbation avec Face ID, agent reparti**. Environ 1 850 lignes.
Le rendu du transcript JSONL n'est pas sur ce chemin critique et sort du lot 1.

### C16. Ce qui sort du lot 1 sans sortir du projet
Décision du coordinateur, contre la recommandation du relecteur pragmatisme, qui proposait
de les supprimer de la v1. Robin a demandé explicitement ces fonctionnalités, réduire son
périmètre n'est pas notre décision. Elles sont **séquencées**, pas annulées :
- Bloc C, fichiers et Share Extension : lot 3.
- Terminal xterm.js complet : lot 2. Le repli obligatoire de A6 est un rendu monospace
  simple dans le lot 1, environ 30 lignes.
- Rendu complet du transcript, sous agents, diffs : lot 2.

### C17. Réglages ramenés à 5
17 interrupteurs aujourd'hui. Chaque réglage exposé est une décision non prise.
Conservés : validations seules, heures calmes, anti-veille, extraits dans les push,
révoquer l'appairage. Tout le reste passe en valeur en dur.

### C18. Routes d'écriture de fichiers hors upload
`mkdir`, `move`, `delete`, `reveal` sont exclues par le PRD mais présentes dans
l'architecture. Les retirer. Argument de sécurité autant que de simplicité.

### C19. Critères d'acceptation non testables
CA-25, CA-31, CA-45, CA-56 à reformuler en assertions vérifiables par oui/non.
Règle : un CA qui ne peut pas être exécuté par un tiers sans interprétation n'est pas un CA.

---

## Barre de sortie

Nouvelle passe du panel après corrections. Barre inchangée : **> 9,0 de moyenne pondérée
et aucun axe sous 7**, sur les trois revues. Les défauts C1 à C8 sont éliminatoires : un
seul non corrigé plafonne la note à 6.
