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
  - `:hourglass_flowing_sand:` delivered (`:hourglass:` if the session was already busy,
    Claude Code queues it);
  - the final assistant text of the turn is posted when the turn ends, then
    `:white_check_mark:`;
  - `:raising_hand:` and "Session X is waiting for your input in Kova" when a permission
    prompt shows up;
  - `:x:` plus the error when delivery fails.
- One Slack command in flight per session, up to 5 queued. After 30 min without a turn
  end, one "still running, check Kova" message. Turns started on the Mac or the iPhone
  never post to Slack.
- Every accepted command is audited (`slack.command`: session, channel, ts, length).

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
