# KovaLink, contexte technique partagé (source de vérité)

> Rédigé par le coordinateur après investigation directe de la machine de Robin.
> Tous les agents de l'équipe DOIVENT lire ce document avant de produire quoi que ce soit.
> Ne re-découvrez pas ces faits : ils sont vérifiés empiriquement.

## 1. Le problème

Robin Bonduelle (CEO de Claap) pilote ses sessions de développement via **Kova**, un
émulateur de terminal macOS natif. Il veut **continuer ses sessions depuis son iPhone**,
et transférer des fichiers dans les deux sens entre l'iPhone et son Mac, "comme AirDrop",
en atterrissant directement dans le bon dossier.

Nom de code du projet : **KovaLink**.

## 2. Qu'est-ce que Kova (faits vérifiés)

- App macOS native, **Rust**, rendu **Metal**. `github.com/micktaiwan/kova`.
- Bundle : `/Applications/Kova.app`, id `com.micktaiwan.kova`, version installée **1.11.0**.
- C'est un multiplexeur terminal (fenêtres → onglets → colonnes → panes) **conçu pour
  piloter des agents de code**. Chaque pane suit sa session Claude Code / Codex.
- Config : `~/.config/kova/config.toml` (TOML), sections `[font] [colors] [terminal]
  [status_bar] [tab_bar] [splits]`.
- État : `~/.config/kova/session.json` (+ rotations `session.N.json`),
  `bookmarks.json`, `recent_projects.json`, `claude_history.json`.
- Logs : `~/Library/Logs/Kova/kova.log`.

### Variables d'environnement injectées dans chaque pane
| Variable | Exemple observé | Usage |
|---|---|---|
| `KOVA_SOCKET` | `/tmp/kova-85882.sock` | socket IPC de l'instance (85882 = PID de Kova) |
| `KOVA_PANE_ID` | `66` | identifiant du pane courant |
| `KOVA_SHELL_INTEGRATION` | `1` | intégration shell active |
| `TERM_PROGRAM` | `Kova` | détection |

## 3. L'IPC Kova, LE pilier de l'architecture

Socket de domaine Unix `/tmp/kova-{pid}.sock`. Protocole **JSON-lines** : une requête JSON
par ligne, une réponse JSON par ligne. Toute réponse porte `ok: true|false`, les données
sous `data`, les erreurs sous `error`.

Test manuel : `echo '{"cmd":"list-panes"}' | nc -U "$KOVA_SOCKET"`

### Commandes de lecture
```json
{"cmd":"list-tabs"}
{"cmd":"list-panes"}
{"cmd":"get-pane-content","panes":"all"|[66],"mode":"visible"|"scrollback"|"all","trim_trailing_blank_lines":true}
{"cmd":"count-pane-content","panes":"all"|[66],"mode":"visible"|"scrollback"|"all"}
{"cmd":"wait-for-completion","pane_id":66,"timeout_ms":30000}
```
`get-pane-content` renvoie `{"data":{"panes":[{"id":66,"text":"...","cols":N,"rows":N,"cursor":{"row":R,"col":C}}]}}`.
ATTENTION : le champ s'appelle `panes` (pluriel), pas `pane_id`. Erreur classique.

### Commandes d'écriture / contrôle
```json
{"cmd":"send-keys","pane_id":66,"text":"..."}
{"cmd":"focus-pane","pane_id":66}
{"cmd":"new-tab","cwd":"<opt>","command":"<opt>"}        -> data:{tab_id,pane_id}
{"cmd":"split","direction":"horizontal"|"vertical","command":"<opt>","cwd":"<opt>"} -> data:{pane_id}
{"cmd":"close-pane","pane_id":N} / {"cmd":"close-tab","tab_id":N}
{"cmd":"rename-pane","pane_id":N,"title":"..."|null}
{"cmd":"set-tab-title","pane_id":N,"title":"..."|null}
{"cmd":"set-tab-color","pane_id":N,"color":0-5|null}   // 0=rouge 1=orange 2=jaune 3=vert 4=bleu 5=violet
{"cmd":"set-pane-status","pane_id":N,"status":"waiting"|"none"}
{"cmd":"resize-pane","pane_id":N,"axis":"horizontal"|"vertical","direction":"grow"|"shrink","amount_pct":0.1-50.0}
{"cmd":"swap-pane","pane_id_a":A,"pane_id_b":B}
{"cmd":"merge-tab","source_tab_id":A,"target_tab_id":B}
{"cmd":"merge-window","source_window":A,"target_window":B}
{"cmd":"notify","pane_id":N,"title":"...","message":"...","sound":true}
{"cmd":"dispatch-action","action":"<nom>","pane_id":N}
```
`dispatch-action` expose ~50 actions clavier : `new-tab`, `close-pane-or-tab`, `vsplit`,
`hsplit`, `equalize`, `prev-tab`, `next-tab`, `switch-tab-1..9`, `navigate-up|down|left|right`,
`swap-*`, `reparent-*`, `resize-*`, `minimize-pane`, `restore-minimized`, `next-attention`,
`history-back|forward`, `detach-tab`, `break-pane`, `open-recent-project`, `open-search`,
`open-pane-switcher`, `open-unread-switcher`, `copy`, `copy-raw`, `paste`, `toggle-filter`.

### Flux d'événements temps réel (essentiel pour les notifications push)
```json
{"cmd":"subscribe","events":["focus","pane-status","pane-working","pane-open","pane-close"]}
```
Réponse initiale = snapshot `{ok:true,data:{events,app_active,focus,panes:[...]}}`,
puis **un événement JSON par ligne** :

| Événement | Payload | Déclencheur |
|---|---|---|
| `focus` | `app_active`, `reason`, `pane` | focus changé / app activée |
| `pane-status` | `pane_id`, `awaiting`, `awaiting_since` | **l'agent attend ta validation** |
| `pane-working` | `pane_id`, `working` | **l'agent démarre / termine** |
| `pane-open` | `pane` | pane créé |
| `pane-close` | `pane_id`, `window`, `tab` | pane fermé |
| `ping` | (vide) | keepalive après 30s de silence |

`pane-status.awaiting` et `pane-working:false` sont les deux déclencheurs de push APNs.

### Objet pane (retourné par list-panes / subscribe), observé réellement
```json
{
  "id": 66, "window": 0, "tab": 1,
  "cwd": "~/dev/projet-a",
  "title": "cc", "focused": false, "pid": 28525,
  "child_processes": [{"name":"claude","pid":80247,"version":null}],
  "is_idle": false, "working": true,
  "awaiting": false, "awaiting_since": null, "awaiting_seen": false,
  "minimized": false,
  "agent": "claude",
  "agent_session_id": "2b1f5c3e-7a9d-4e6b-9c1a-0f8d7e6c5b4a",
  "agent_session_name": null,
  "claude_session_id": "2b1f5c3e-7a9d-4e6b-9c1a-0f8d7e6c5b4a"
}
```

### Objet tab
```json
{"id":32,"window":0,"tab_index":1,"title":"Link","pane_count":1,
 "focused_pane_id":66,"active":false,"has_bell":false,
 "has_completion":false,"has_running":true}
```

## 4. Deux sources de vérité pour le contenu d'une session

C'est LA décision d'architecture. Il y a deux flux complémentaires, on utilise les deux.

### (a) Flux ANSI brut par pane : fidélité terminal
Kova écrit un flux PTY brut par pane dans :
`~/Library/Logs/Kova/pty-capture-{kova_pid}-{pane_id}.raw`

VÉRIFIÉ ACTIF sur la machine de Robin : `pty-capture-85882-66.raw` grossissait en direct
pendant l'investigation (~214 Ko). Ce sont les octets ANSI bruts. Le daemon peut faire un
`tail -f` de ces fichiers et streamer les octets vers l'iPhone → rendu fidèle par xterm.js.
Fallback si absent/désactivé : polling `get-pane-content` avec `mode:"visible"`.
Note : ces fichiers grossissent sans limite (un ancien `kova.log.1` faisait 757 Mo).
Le daemon ne doit JAMAIS charger un `.raw` entier en mémoire : ouvrir, seek à la fin,
lire en flux à partir de là.

### (b) Transcript structuré Claude Code : c'est la vraie UX mobile
`~/.claude/projects/{cwd-slugifié}/{session_id}.jsonl`

Le slug remplace `/` et les espaces par `-`. Exemple réel :
cwd `/Users/<toi>/dev/mon projet`
→ `~/.claude/projects/-Users-<toi>-dev-mon-projet/2b1f5c3e-7a9d-4e6b-9c1a-0f8d7e6c5b4a.jsonl`

Le `agent_session_id` du pane EST le nom du fichier JSONL. La jointure
pane ↔ projet ↔ transcript est donc triviale et gratuite.
Format : une entrée JSON par ligne, `{"type":"user"|"assistant",...}` avec le contenu des
messages, les appels d'outils et leurs résultats. C'est ce qui permet une UI de chat native
(messages, outils pliables, boutons approuver/rejeter) au lieu d'un terminal illisible au doigt.
L'ÉCRITURE se fait toujours via `send-keys` sur le pane : on ne touche jamais au JSONL.

## 5. Décisions produit ARRÊTÉES par Robin (non négociables)

| Sujet | Décision |
|---|---|
| Réseau | **Tailscale + fallback LAN.** Le client tente le LAN d'abord (latence), bascule sur Tailscale hors réseau. |
| UX principale | **Chat natif + terminal en repli.** Le chat est l'expérience première, le terminal xterm.js est l'onglet de secours. |
| Compte Apple | Compte **Apple Developer payant de Claap**. Bundle `io.claap.kovalink`. Distribution **TestFlight interne**. Aucune publication App Store. **APNs activé.** |
| Fichiers | **Tout le Mac accessible** en navigation/lecture/écriture. Robin a été averti du risque et a confirmé. |
| Stack app | **Expo / React Native**, build via **EAS**, mises à jour **OTA**. Compte Expo déjà disponible. |
| Distribution | Privée. Éventuellement publique dans un second temps (à garder en tête, ne pas sur-concevoir pour). |

## 6. Contraintes de sécurité imposées par le coordinateur

L'accès disque étant total, le daemon est une clé du Mac entier. Non négociable :
1. **Bind exclusif** sur l'interface Tailscale (`100.x.x.x`) + loopback. **Jamais `0.0.0.0`.**
2. **Appairage par token** : secret généré au premier lancement, transmis hors bande
   (QR code affiché sur le Mac), stocké dans la **Keychain iOS** (`expo-secure-store`).
   Chaque requête est authentifiée.
3. **Journal d'audit** de chaque lecture et écriture de fichier, avec horodatage et chemin.
4. **TLS** même sur Tailscale (certificat auto-signé épinglé côté client).
5. Le daemon tourne sous l'utilisateur de Robin, **jamais en root**.

## 7. Style et préférences de Robin

- CEO, occupé. Va droit au but, déteste le remplissage corporate.
- Bilingue FR/EN. **Interdiction absolue du tiret cadratin (—) dans tout livrable écrit.**
  Utiliser virgule, deux-points, parenthèses, ou reformuler.
- Solutions simples et propres. **Ne pas sur-concevoir.**
- Privilégie la vitesse et le pragmatisme à la perfection.

## 8. Barre de qualité

Le PRD et le Design doivent être notés **> 9/10** par un panel avant toute implémentation.
L'implémentation doit elle aussi être notée **> 9/10**. Livrez en conséquence.
