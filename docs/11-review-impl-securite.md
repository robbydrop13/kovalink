# Revue d'implementation, angle securite et robustesse (passe 2, commit 5ad003d)

Relecteur securite et robustesse. Perimetre : le code tel que committe en `5ad003d`
(fusion de `lot2/prompt-parse` sur les correctifs `8fac79d`). Grille appliquee :
`docs/10-review-implementation-rubric.md`, axes prioritaires 2, 3, 4. Toutes les
verifications ci dessous ont ete rejouees EN VRAI contre le daemon lance par launchd sur ce
code (pid 67780), avec un appareil de test appaire en curl puis revoque. Aucune ecriture
hors d'un dossier jetable sous `/tmp`, aucun contact avec les panes de Robin, aucune
modification du depot. Je n'ai cru aucune annonce : chaque contournement de passe 1 a ete
retente octet pour octet.

## Verdict : PASSE

Moyenne ponderee **9,20 / 10**, aucun axe sous 7. Les trois eliminatoires de la passe 1 et
de l'ordre de correction (S1, S2, tiret cadratin) sont fermes et verifies. Il reste des
defauts, aucun n'est bloquant ni eliminatoire.

## Etat des defauts de passe 1

| Ref | Defaut passe 1 | Etat | Preuve |
|---|---|---|---|
| B1 (S1) | Liste noire en ecriture trop etroite, `~/.zlogin` autorise | **Corrige** | Regle structurelle `hidden:` : `~/.zlogin`, `.zlogout`, `.vimrc`, `.npmrc`, `.config/**` tous refuses en direct. |
| B2 (S2) | Regle `/etc` morte (canonicalisation) | **Corrige** | `/etc/hosts` ET `/private/etc/hosts` refuses `PATH_DENIED rule path:/etc`. |
| B3 (K1) | Test de garde `KeyGate` evadable, `requestUnchecked` public | **Corrige** | `#enqueue` prive ES, `claimRawChannel` a usage unique, test par analyse syntaxique. 113 tests verts. |
| B4 (S3) | Certificat jamais reemis a chaud | **Corrige** | Minuterie quotidienne `renewCertificate` + `setSecureContext` sur chaque ecouteur (`main.ts:403-430`). |
| B5 (S4) | Codes de fermeture WS hors protocole, `4426` fantome | **Corrige** | `packages/protocol/src/ws.ts`, `4426` reellement emis (`hub.ts:282`), `wsCloseReason` cote app. |
| B6 | `hashPrompt` sans appelant ni test | **Corrige** | Appele par `answer.ts:82`, teste par `answer.test.ts` et `parser.test.ts`. |

## Notes par axe

| # | Axe | Poids | Note | Justification en une ligne |
|---|---|---|---|---|
| 1 | Justesse | 15% | 9,0 | Lots 1, 2 et 3 operationnels ; la regle `hidden:` bloque aussi des cibles legitimes (`.vscode`, `.config`), tradeoff assume. |
| 2 | Securite | 20% | 9,0 | Contournements de passe 1 tous fermes en direct, K1 verrouille au compilateur ; reste une non-atomicite du nonce sur `pane.answer`. |
| 3 | Robustesse | 15% | 9,0 | Clients morts detectes, certificat rechargeable a chaud, etat corrompu ferme ; suppression de push globale a un pane. |
| 4 | Contrat partage | 15% | 9,5 | Codes de fermeture WS et durees de battement desormais dans `packages/protocol`, importes des deux cotes. |
| 5 | Simplicite | 10% | 9,0 | La regle structurelle remplace une enumeration ; `claimRawChannel` est une mecanique juste, sans exces. |
| 6 | Tests | 15% | 9,5 | Le test K1 attrape un nouvel appelant par AST ; `Hub`, `SleepAssertion`, parser et `answer` couverts, fixtures reelles. |
| 7 | Exploitabilite | 10% | 8,5 | launchd verifie actif, route `kova/launch` bornee et auditee ; README app encore a verifier par le relecteur exploitabilite. |

Calcul : 9,0x0,15 + 9,0x0,20 + 9,0x0,15 + 9,5x0,15 + 9,0x0,10 + 9,5x0,15 + 8,5x0,10 = **9,20**.

---

## Defauts restants (aucun bloquant)

### D1. `pane.answer` : le nonce n'est pas atomique et il n'y a pas de verrou par pane

`daemon/src/prompt/answer.ts:65` (`nonces.seen`) puis `:92` (`nonces.remember`), avec
plusieurs `await` entre les deux (`prompts.fresh` en `:76`). `daemon/src/server/services.ts`
(`NonceStore.seen`/`remember` non atomiques).

Deux `pane.answer` concurrents portant le MEME nonce passent tous deux `seen()` avant que
`remember()` n'ait eu lieu. Avec des nonces distincts mais le meme prompt valide, les deux
franchissent aussi `awaitingSince` et le hash (relus avant que le premier `emitAnswer`
n'ait change l'ecran), et `emitAnswer` part deux fois : le second `chiffre + Entree` tombe
sur l'ecran suivant. Le garde-fou A6.3 est concu pour revalider "juste avant l'emission" ;
la revalidation n'est pas un compare-and-swap et rien ne serialise deux reponses sur le
meme pane. `answer.ts` ne pose aucun verrou par pane.

Preuve brute (NonceStore compile) :

```
les deux voient seen=false : true
=> seen/remember n est pas atomique : deux appels concurrents de meme nonce passent la garde.
grep verrou par pane dans answer.ts -> aucun
```

Exploitabilite faible : il faut deux requetes authentifiees a quelques millisecondes
d'ecart, et la file de l'app emet en serie. Mais c'est un vrai relachement du contrat A6.3.
Correctif : reserver le nonce AVANT les `await` (marquer puis liberer sur refus), ou un
verrou par pane autour de `answerPrompt`. La meme non-atomicite existe sur `pane.interrupt`
et `pane.sendText` (`hub.ts:359`, `:371`), sans consequence la (ESC idempotent, texte en
serie).

### D2. La regle structurelle bloque des cibles d'ecriture legitimes

`daemon/src/security/denylist.ts:89` (`hiddenSegmentUnderHome`).

Tout chemin sous `$HOME` traversant un segment commençant par un point est refuse. C'est
le bon choix de securite, mais il refuse aussi des ecritures parfaitement legitimes de
Robin : `~/.config/<outil>/reglage`, ou un upload vers un dossier de projet contenant
`.vscode`, `.github`, `.storybook`, `.venv`, `.expo`. Robin travaille dans
`~/dev/...`, donc sous `$HOME` : deposer un fichier dans le `.github` d'un projet
est desormais impossible.

Preuve brute :

```
~/.config/newtool.conf -> PATH_DENIED (regle hidden:.config)
```

Ce n'est pas un defaut de securite mais une regression d'usage a assumer et documenter dans
l'app (le message d'erreur est clair et actionnable, c'est deja ca). A surveiller si Robin
remonte des refus surprenants sur ses dossiers de projet.

### D3. La suppression de push est globale a un pane, pilotee par un seul client

`daemon/src/server/hub.ts:208` (`isWatching`) appele par `daemon/src/main.ts:262`
(`isWatchedLive`) : si UN client declare `foregroundPaneId` sur ce pane, session attachee et
signal frais (< `FOREGROUND_TTL_MS`), le push de fin de tour est supprime pour TOUS les
appareils, pas seulement pour lui. En mono-utilisateur multi-appareils c'est marginal, et
la fraicheur du signal plus l'exigence de session attachee ferment le cas de l'iPhone
range. A garder en tete si un second appareil est ajoute : `push/sender.ts` fait deja une
suppression par appareil, ce court-circuit global lui est anterieur. Non bloquant.

---

## Verifications empiriques, resultats bruts

**S1, contournements de passe 1 rejoues (init, refus AVANT tout octet).**
```
~/.zlogin              -> PATH_DENIED (regle hidden:.zlogin)
~/.zlogout             -> PATH_DENIED (regle hidden:.zlogout)
~/.vimrc               -> PATH_DENIED (regle hidden:.vimrc)
~/.npmrc               -> PATH_DENIED (regle hidden:.npmrc)
~/.config/git/config   -> PATH_DENIED (regle hidden:.config)
~/.hammerspoon/init.lua-> PATH_NOT_FOUND (dossier absent, pas de mkdir)
lien /tmp/../homelink (-> $HOME) + filename .zlogin -> PATH_DENIED (regle hidden:.zlogin)
controle : /tmp/.../ok/rapport.txt (non cache) -> AUTORISE
```
Le contournement flagship de la passe 1 est ferme, y compris via un lien symbolique de
dossier vers le home (le `realpath` du dossier ramene sous `$HOME` et le segment cache est
attrape).

**S2, regle `/etc` via canonicalisation.**
```
/etc/hosts          -> PATH_DENIED (regle path:/etc)
/private/etc/hosts  -> PATH_DENIED (regle path:/etc)
```
Refus par la liste noire, plus par EACCES : la regle est vivante des deux cotes.

**K1, point d'entree unique.** `requestUnchecked` a disparu (`#enqueue` prive ES),
`claimRawChannel` est a usage unique (une seconde reclamation jette). Le test compte les
appelants par analyse syntaxique TypeScript (imports, appels, chaines, gabarits,
concatenations, acces par crochet) : un appelant en guillemets doubles ou par gabarit est
vu. 113 tests verts sur `keygate/answer/denylist/hub`. Un nouvel appelant de
`claimRawChannel` ferait echouer `where(f => f.calls.has('claimRawChannel')) == [sendKeys.ts]`,
et au chargement une seconde reclamation ferait tomber le daemon bruyamment. Chemin ferme.

**pane.answer, garde sur pane idle.**
```
POST /v1/panes/1/answer {optionIndex:2, promptHash:"fake", ...} -> {"applied":false,"reason":"not_awaiting"}
audit: pane.answer paneId:1 result:denied detail:not_awaiting
```
Refus avant tout `send-keys`, audite avec la cause.

**fs/read?digest=true.** Empreinte calculee en flux (`pipeline(createReadStream, hash)`,
`fsRoutes.ts:94`), envoyee en en-tete AVANT le corps :
```
x-kovalink-sha256: 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
sha attendu (printf hello) : 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
content-length: 5
```

**kova/launch.** Borne a `/usr/bin/open -a Kova`, AUCUN parametre du client, limite en
debit, audite :
```
POST /v1/kova/launch -> {"launched":true,"alreadyUp":true}
audit: kova.launch result:ok detail:"deja lance"
```

**Bind.** `127.0.0.1:8765`, `[::1]:8765`, `100.x.y.z:8765`,
`[fd7a:115c:a1e0::x]:8765`. Ni `0.0.0.0` ni `*`.

**Redaction.** Jeton complet et signature (3e segment) : ABSENTS de `~/.kovalink/logs`,
`~/.kovalink/audit`, `state.json`.

**Revocation.** `DELETE /v1/pair/devices/<id>` -> `{"revoked":true}` ; requete suivante ->
`401`. Immediat.

**Certificat a chaud (lecture de code).** `renewCertificate` (`main.ts:403`) rejoue
`ensureCertificate` (seuil 30 jours), compare le materiel, et appelle
`setSecureContext({key,cert})` sur chaque ecouteur sans couper les sockets ; minuterie
`CERT_CHECK_INTERVAL_MS` (24 h), rejouee aussi au reveil. Conforme A12/S3.

**Clients morts (lecture de code + tests).** Ping serveur toutes les 20 s
(`WS_PING_INTERVAL_MS`), mort apres 2 pings sans pong (`WS_DEAD_AFTER_MISSED_PONGS`),
`remove()` nettoie `foregroundPaneId` et les sessions, fermeture `DEAD_CLIENT`. Couvert par
`hub.test.ts` (461 lignes). Repondre aux pings maintient bien la connexion, ce qui est
correct : un client qui pong EST vivant.

## Ce qui tient

Regle de liste noire structurelle et fermee, K1 verrouille au compilateur et au chargement,
`answer.ts` avec relecture fraiche, hash sur charge complete et comparaison a temps constant,
un seul `send-keys` atomique par reponse, `emitAnswer` a un seul appelant prouve, codes de
fermeture WS et durees centralises dans le protocole, certificat rechargeable a chaud,
detection des clients morts, route `kova/launch` bornee, digest en flux, redaction et
revocation verifiees en direct. Les defauts restants (non-atomicite du nonce sur `answer`,
regle qui bloque des dossiers de projet caches, suppression de push globale) sont reels mais
non bloquants. Le code a franchi la barre.
