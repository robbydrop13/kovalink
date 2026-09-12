# Fixtures du parseur de prompt

Captures REELLES, pas inventees (C37). Le contenu est le champ `text` de
`get-pane-content` en `mode: "visible"`, `trim_trailing_blank_lines: true`, copie tel
quel, octet pour octet. Ne pas les reformater : le parseur est ecrit contre elles.

| Fichier | Contenu | Usage |
|---|---|---|
| `prompt-bash.txt` | Prompt `Bash command` pour `echo bonjour > hello.txt`, 4 options | grammaire de base, mutations |
| `prompt-bash-consecutive-1.txt` | Premier de deux prompts `Bash` consecutifs : `echo un > un.txt` | C20 / CA-62 |
| `prompt-bash-consecutive-2.txt` | Second, obtenu apres avoir repondu `1` au premier : `echo deux > deux.txt` | C20 / CA-62 : meme question, memes libelles, detail different, hash different |
| `prompt-write.txt` | Prompt `Create file` pour `notes.md`, 3 options, contenu du fichier entre filets `╌` | grammaire Write, gabarit B |
| `screen-trust-dialog.txt` | Dialogue de confiance du dossier, options SANS numero | doit rendre `unparsable` |
| `screen-idle.txt` | Ecran au repos apres un tour, composer vide | doit rendre `unparsable` |

## Conditions de capture

- Date : 11 septembre 2026.
- Claude Code **v2.1.268**, lance par `claude --permission-mode default` (mode « manual »).
- Kova 1.11.0, pane jetable cree par `new-tab` avec `cwd` sous `/tmp`, 221 colonnes,
  64 lignes. Aucun pane de Robin n'a ete touche.
- Le prompt est provoque par une consigne explicite (« Run exactly this shell command
  with the Bash tool ») ; `cat` et les commandes en lecture ne demandent pas de permission
  en mode par defaut, seules les ecritures en demandent.

## Grammaire observee

```
─────────────────────────────────────        filet de cadre, pleine largeur, `─` uniquement
 Bash command                                en-tete : nature de l'action
 Tip: auto mode handles these prompts …      conseil, parfois present, decoratif

   echo bonjour > hello.txt                  detail : la commande puis sa description
   Write "bonjour" to hello.txt              (Write : nom du fichier, puis contenu numerote
                                              entre deux filets `╌`)
 Do you want to proceed?                     question, termine par `?`
 ❯ 1. Yes                                    options `N. libelle`, numerotees a partir de 1,
   2. Yes, and always allow access to …      consecutives ; `❯` marque la ligne surlignee
   3. Yes, and switch to auto mode · …       cote Mac (exclu du hash)
   4. No

 Esc to cancel · Tab to amend                pied de cadre, DERNIERE ligne non vide
```

Le nombre d'options varie : 4 pour `Bash`, 3 pour `Write`. Jamais 3 en dur.

## Ce que la capture a aussi etabli (mesure, pas suppose)

1. **Kova ne leve jamais `pane-status.awaiting` sur un prompt de permission**, pane focalise
   ou non, meme en mode de permission par defaut. Seul `pane-working` bascule : `true` au
   depart de l'agent, `false` a l'instant ou le cadre s'affiche. Le declencheur du chemin de
   prompt est donc le front descendant de `pane-working` (`src/prompt/detector.ts`), comme
   pour la fin de tour (D1). Le fichier `~/.claude/sessions/<pid>.json` porte bien
   `status: "waiting"`, `waitingFor: "permission prompt"`, mais Kova ne le relaie pas.
2. Kova ignore comme « stale » un fichier de session dont `startedAt` est eloigne du
   demarrage du processus (cas du dialogue de confiance qui retarde le demarrage) : le pane
   apparait alors avec `agent: null`. Relancer `claude` dans le dossier deja approuve
   corrige. Le pane 9 de la capture (onglet « Projet B ») est dans ce cas.
3. La ligne assistant portant le `tool_use` n'est pas toujours ecrite dans le JSONL pendant
   que le prompt est affiche : le JSONL ne suffit pas a detecter un prompt, seul l'ecran
   fait foi (A6).

## Rejouer la procedure

1. `{"cmd":"new-tab","cwd":"/tmp/<dossier>"}` sur le socket Kova, noter le `pane_id`.
2. `send-keys` : `claude --permission-mode default\r`, accepter le dialogue de confiance
   (fleche bas, Entree), puis `/exit` et relancer `claude --permission-mode default` pour
   que Kova detecte l'agent.
3. `send-keys` d'une consigne qui ecrit un fichier via Bash ou Write.
4. `{"cmd":"get-pane-content","panes":[<id>],"mode":"visible","trim_trailing_blank_lines":true}`,
   sauvegarder `text` tel quel.
5. Repondre `1\r` en un seul `send-keys` pour obtenir le prompt suivant (C20).
6. `/exit`, puis `{"cmd":"close-pane","pane_id":<id>}`.
