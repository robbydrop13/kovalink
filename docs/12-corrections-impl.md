# Ordre de correction, implementation, passe 1

Panel implementation : fonctionnel 6,8 (plafonne 6,0) · securite 7,55. Deux NE PASSE PAS.
L'eliminatoire du tiret cadratin est deja corrige. Reste ce qui suit, par gravite.

## P0. Securite (eliminatoire reproduit)

**S1. Liste noire en ecriture trop etroite.** Reproduit : `upload/init` vers `~/.zlogin` autorise.
Regle imposee, simple et fermee : **toute ecriture sous `$HOME` dont un composant de chemin
commence par un point est refusee** (`~/.zlogin`, `~/.config/**`, `~/.hammerspoon/**`,
`~/.npmrc`, `~/.vimrc`, `~/.local/**`, `~/.ssh`, tout). Les vrais fichiers de Robin ne sont
jamais des fichiers caches, et les mecanismes de persistance d'un utilisateur le sont tous.
On remplace une enumeration incomplete par une regle structurelle. Conserver en plus les
entrees explicites existantes (LaunchAgents, `.app`, executables, `/etc`, le daemon lui meme).
Tests : un par fichier cite par le relecteur, plus `~/.config/git/config` inexistant.

**S2. La regle `/etc` est morte.** `realpath` rend `/private/etc` avant `checkWrite`, la
regle compare `/etc`. Passer les regles elles memes par `realpath` au chargement, et
comparer sur chemins reels des deux cotes. Test : ecriture vers `/etc/hosts` refusee par
la liste noire (message explicite), pas par EACCES.

**S3. Certificat jamais reemis a chaud.** `ensureCertificate` n'est appele qu'au demarrage,
le daemon tourne en KeepAlive, le certificat vit 90 jours. Minuterie quotidienne qui rejoue
`tailscale cert` a moins de 30 jours de l'expiration et recharge le contexte TLS sans
redemarrage (`server.setSecureContext`). Journal explicite a chaque renouvellement.

**S4. Codes de fermeture WebSocket** (4401, 4426, 1008) declares dans `packages/protocol`,
branche fantome `4426` supprimee ou reellement emise.

## P0. Le scenario 1 est casse

**H1. Le daemon ne detecte jamais un client WebSocket mort.** Aucun ping serveur,
`foreground` jamais ecrit. Consequences prouvees dans le journal : push de fin de tour
supprime pour « session ouverte » sur un telephone qui n'est plus la, et `caffeinate -i`
orphelin depuis 19 h.
Corrections : ping serveur toutes les 20 s, client declare mort apres 2 pings sans pong,
fermeture et nettoyage de tout son etat (foreground, attaches, assertion anti-veille).
La suppression d'un push n'est autorisee que si un client est **vivant ET au premier plan
sur ce pane depuis moins de 60 s** (A1, CA-31). `caffeinate` lance avec `-w <pid>` du
daemon pour qu'il meure avec lui, et plafond de 4 h **implemente par une minuterie**.

**H2. Instantane vide a la reconnexion.** `tailer.attach` renvoie `[]` si deja attache :
un client qui se reconnecte voit un ecran vide. `attach` doit toujours renvoyer l'etat
courant, l'idempotence portant sur l'abonnement, pas sur les donnees.

## P1. Fonctionnel

**F1. `tool_result` jamais rattaches.** Le daemon les emet en tours separes, l'app les
cherche dans le tour assistant. Choisir UNE representation dans `packages/protocol` (le
resultat porte `toolUseId`, l'app fait la jointure) et l'appliquer des deux cotes. Test
de jointure. Symptome a faire disparaitre : bloc d'outil deplie vide et « en cours »
permanent.

**F2. Deux morceaux du lot 1 servis mais jamais appeles** : repli monospace (CA-44) et
« Ouvrir sur le Mac » (CA-11). Brancher cote app.

**F3. Reglage anti-veille placebo** : stocke, jamais transmis ni lu (CA-126). Le transmettre
au daemon et le lire, ou le retirer. On le transmet : c'est une decision A1.

**F4. Kova quitte** : panes fantomes, etat « Kova n'est pas lance » inatteignable (CA-123).
Sur perte du socket sans redecouverte en 10 s : vider la liste, emettre l'etat, l'app
affiche l'ecran prevu par le design.

**F5. Ecarts de valeurs.** Le PRD est perime sur le QR (5 min est decide, corriger le PRD).
Les autres suivent le PRD : file d'interruption hors ligne 5 min (CA-72), heures calmes
en notification passive et non supprimee (CA-130), reprise a 60 s apres `mac_focused`
(CA-31), plafond horaire de notifications (CA-32), une seule banniere par pane (CA-14),
etat « Non confirme » (CA-48), verification SHA-256 reelle cote app (CA-101).

## P1. Garde de `KeyGate`

**K1.** `requestUnchecked` est public et non compte par le test des appelants. Le rendre
prive au module. Le test grep doit couvrir les deux styles de guillemets et les gabarits,
ou mieux, compter par analyse syntaxique. **Attention** : le chemin de prompt parse est en
cours d'implementation sur la branche `lot2/prompt-parse` et touche `KeyGate` (ajout de
`emitAnswer`). Faire K1 apres la fusion de cette branche, pas avant.

## P2. Tests et exploitabilite

**T1.** Tests manquants les plus graves : `Hub` (0 test), suppression de push et heures
calmes (0), `SleepAssertion` (0), seuil de 60 s force a 0 dans le test existant. Cote app,
zero test alors que `withoutEchoed`, `merge`, `purgeExpired` sont pures et ont porte
plusieurs des 40 bugs : ajouter un lanceur de tests et couvrir ces trois fonctions.

**T2.** README app perime (miroir de protocole, lot 3 « absent », `--go`). Ajouter : le
cache Metro et le lien de protocole, l'acces complet au disque a accorder au binaire Node
et non a Kova (non signe), le chemin nvm fige dans le plist, `npm start` qui reconstruit.

## Barre de sortie
Nouvelle passe des deux relecteurs. > 9,0 et aucun axe sous 7. S1, S2 et H1 sont
eliminatoires.
