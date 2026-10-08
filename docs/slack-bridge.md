# Slack bridge (`@kova`)

Drive any Claude Code session running in Kova from Slack:

```
@kova claap-agent regarde mes mails
@kova perso-agent relance le build
@kova list
```

In a DM to the bot, the `@kova` prefix is optional (`claap-agent regarde mes mails`).

## How it works

- Transport: Slack Socket Mode, run by `kovalinkd` (`daemon/src/slack/`). No public URL.
- Authorization: the daemon acts only on messages whose author is `slack.allowedUserId`
  (default `U01DYDY2WR1`, Robin) AND whose team is the team of the bot token (read once
  with `auth.test`). Bots, edited or deleted messages, other users and Slack Connect
  users are ignored without any reply. Ignored human mentions are written to the log and
  to the audit file (`slack.ignored`: user id, channel, reason, never the content).
- Session name: first word after the mention. Matched against the pane session name
  (`/rename`), then the Kova pane title, case-insensitive; a unique prefix also works.
  Unknown or ambiguous name: the bot replies with the available names.
- Delivery: the message goes through `KeyGate.emitText`, the same path as the iPhone
  app, followed by a context line telling the agent the channel and thread, and that it
  can read the thread with `slk thread <channel> <ts>`.
- Feedback, always in the thread of the message:
  - `:hourglass:` queued: the session is mid-turn, or another Slack message is in flight.
    Nothing is typed into a busy session: the message goes in when the turn ends;
  - `:hourglass_flowing_sand:` delivered;
  - the final assistant text of the turn is posted when the turn ends, then
    `:white_check_mark:`;
  - `:raising_hand:` and "Session X is waiting for your input in Kova" when a permission
    prompt shows up;
  - `:x:` plus the error when delivery fails.
- One Slack command in flight per session, up to 5 queued, delivered in order. After 30 min
  without a turn end, one "still running, check Kova" message.
- Busy or idle: Kova's `working` (title spinner) stays on while a background subagent runs,
  even when the session is back at its prompt. So "busy" is `working` AND the transcript
  turn still open (no final assistant answer yet), and the end of a Slack turn is read from
  the transcript every 3 s, on top of the `working` falling edge. The queue lives in the
  daemon's memory: a daemon restart drops queued messages. Turns started on the Mac or the iPhone
  never post to Slack.
- Every accepted command is audited (`slack.command`: session, channel, ts, length).

## @kova in Robin's DMs with other people

Slack never lets an app into a 1:1 DM between two people, so `app_mention` never fires there.
With Robin's user token (optional third keychain entry `user-token`), the app also receives
Robin's DM and group DM messages (`message.im`, `message.mpim` user events):

- Only Robin's messages that mention the bot are commands. Everything else in those DMs
  (the other person's messages, Robin's messages without `@kova`) is dropped silently,
  never logged.
- The turn's answer and the reactions (⏳ then ✅) are posted **as Robin**, in the DM thread:
  the bot is not in that conversation.
- Bridge notices (unknown session, list, still running, waiting for input, errors) go to
  Robin's DM with the bot, never in front of the other person.
- The token must belong to `slack.allowedUserId` (checked with `auth.test` at boot),
  otherwise the DM path stays off and the bot path works as before.

Setup: update the app with the current manifest (it adds the user scopes and user events),
reinstall, then copy the **User OAuth Token** (`xoxp-...`):
```
security add-generic-password -U -s kovalink-slack -a user-token -w "$(pbpaste)"
launchctl kickstart -k gui/$(id -u)/io.claap.kovalinkd
```
The log then says `slack: DM path on`.

## Setup (once)

1. Go to https://api.slack.com/apps, **Create New App**, **From a manifest**, pick the
   Claap workspace, paste `daemon/slack/kova-app-manifest.json`, create.
2. **Install to Workspace** and allow. Copy the **Bot User OAuth Token** (`xoxb-...`):
   ```
   security add-generic-password -U -s kovalink-slack -a bot-token -w "$(pbpaste)"
   ```
3. **Basic Information**, **App-Level Tokens**, **Generate Token and Scopes**, name it
   `socket`, scope `connections:write`, generate. Copy the token (`xapp-...`):
   ```
   security add-generic-password -U -s kovalink-slack -a app-token -w "$(pbpaste)"
   ```
4. Restart the daemon:
   ```
   launchctl kickstart -k gui/$(id -u)/io.claap.kovalinkd
   ```
5. Check `~/.kovalink/logs/kovalinkd.log` for `slack: bridge on` and
   `slack: socket mode connected`. Without tokens the log says
   `slack: tokens missing, Slack bridge off` and the rest of the daemon runs as before.
6. Invite `@kova` to the channels where you want to use it (`/invite @kova`), or just DM it.

## Config

`~/.kovalink/config.json`, key `slack` (tokens never go there):

```json
"slack": { "allowedUserId": "U01DYDY2WR1", "jobTimeoutMs": 1800000 }
```

## Limitations

- The reply is the final assistant text of the turn (text after the last tool call).
  Tool output, files and images are not posted.
- A message sent to a session already waiting on a permission prompt is not delivered:
  answer in Kova (or the iPhone app), then send it again.
- If a turn never ends cleanly (killed agent), the bridge stops tracking it after 6 h
  and moves on to the next queued message.
