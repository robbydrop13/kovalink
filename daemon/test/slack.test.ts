import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { ActionResponse } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-slack-'));
process.env['KOVALINK_CLAUDE_PROJECTS'] = mkdtempSync(join(tmpdir(), 'kovalink-slack-projects-'));
process.env['KOVALINK_QUIET'] = '1';

const {
  authorizeEvent,
  parseCommand,
  resolveSession,
  availableNames,
  formatSessionList,
  formatUnresolved,
  slackToPlain,
  mentionedUserIds,
  paneMessage,
  markdownToMrkdwn,
  chunkText,
  formatReply,
  Dedupe,
  CHUNK_MAX,
} = await import('../src/slack/logic.js');
const { SlackBridge, REACT } = await import('../src/slack/bridge.js');
const { toPane } = await import('../src/kova/panes.js');
const { finalTurnText } = await import('../src/transcript/jsonl.js');
const { paths } = await import('../src/paths.js');

type Pane = ReturnType<typeof toPane>;

const ROBIN = 'U01DYDY2WR1';
const TEAM = 'T0CLAAP';
const BOT = 'UBOTKOVA';
const ctx = { allowedUserId: ROBIN, teamId: TEAM };

function env(event: Record<string, unknown>, team = TEAM): Parameters<typeof authorizeEvent>[0] {
  return { team_id: team, event_id: `Ev${Math.random()}`, event: { type: 'app_mention', channel: 'C1', ts: '1.1', ...event } };
}

function pane(id: number, o: Record<string, unknown> = {}): Pane {
  return toPane({ id, cwd: '/tmp/x', title: null, agent: 'claude', agent_session_id: `s-${id}`, ...o });
}

describe('slack: authorizeEvent', () => {
  it('accepte Robin dans son equipe', () => {
    assert.deepEqual(authorizeEvent(env({ user: ROBIN, team: TEAM }), ctx), { ok: true });
  });
  it('refuse un autre utilisateur, et le signale', () => {
    const d = authorizeEvent(env({ user: 'U999' }), ctx);
    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.reason, 'other_user');
    assert.equal(!d.ok && d.notable, true);
  });
  it('refuse un message de bot, silencieusement', () => {
    const d = authorizeEvent(env({ user: ROBIN, bot_id: 'B1' }), ctx);
    assert.equal(!d.ok && d.reason, 'bot');
    assert.equal(!d.ok && d.notable, false);
  });
  for (const subtype of ['bot_message', 'message_changed', 'message_deleted', 'channel_join']) {
    it(`refuse le sous-type ${subtype}`, () => {
      const d = authorizeEvent(env({ type: 'message', channel_type: 'im', user: ROBIN, subtype }), ctx);
      assert.equal(!d.ok && d.reason, 'subtype');
    });
  }
  it('refuse un evenement sans utilisateur', () => {
    assert.equal((authorizeEvent(env({}), ctx) as { reason: string }).reason, 'no_user');
  });
  it('refuse une autre equipe dans l enveloppe', () => {
    assert.equal((authorizeEvent(env({ user: ROBIN }, 'T0OTHER'), ctx) as { reason: string }).reason, 'other_team');
  });
  it('refuse un utilisateur externe (Slack Connect) meme avec le bon identifiant', () => {
    for (const k of ['team', 'user_team', 'source_team']) {
      const d = authorizeEvent(env({ user: ROBIN, [k]: 'T0EXT' }), ctx);
      assert.equal((d as { reason: string }).reason, 'other_team', k);
    }
  });
  it('refuse tout quand l equipe du bot est inconnue', () => {
    const d = authorizeEvent(env({ user: ROBIN }), { allowedUserId: ROBIN, teamId: '' });
    assert.equal(d.ok, false);
  });
  it('refuse une enveloppe sans evenement ou d un autre type', () => {
    assert.equal(authorizeEvent({ team_id: TEAM }, ctx).ok, false);
    assert.equal(authorizeEvent(env({ type: 'reaction_added', user: ROBIN }), ctx).ok, false);
  });
});

describe('slack: parseCommand', () => {
  it('retire la mention du bot et coupe au premier mot', () => {
    assert.deepEqual(parseCommand(`<@${BOT}> claap-agent regarde mes mails`, BOT), {
      kind: 'send',
      session: 'claap-agent',
      message: 'regarde mes mails',
    });
  });
  it('garde le message multi-lignes intact', () => {
    const c = parseCommand(`<@${BOT}>  perso   ligne 1\nligne 2`, BOT);
    assert.deepEqual(c, { kind: 'send', session: 'perso', message: 'ligne 1\nligne 2' });
  });
  it('DM sans mention', () => {
    assert.deepEqual(parseCommand('perso-agent fais ca', BOT), { kind: 'send', session: 'perso-agent', message: 'fais ca' });
  });
  it('list et mention seule', () => {
    assert.deepEqual(parseCommand(`<@${BOT}>`, BOT), { kind: 'list' });
    assert.deepEqual(parseCommand(`<@${BOT}> list`, BOT), { kind: 'list' });
    assert.deepEqual(parseCommand('LIST', BOT), { kind: 'list' });
  });
  it('session sans message', () => {
    assert.deepEqual(parseCommand(`<@${BOT}> claap-agent`, BOT), { kind: 'send', session: 'claap-agent', message: '' });
  });
  it('mention avec libelle', () => {
    assert.equal((parseCommand(`<@${BOT}|kova> a b`, BOT) as { session: string }).session, 'a');
  });
});

describe('slack: resolveSession', () => {
  const panes = [
    pane(1, { claude_session_name: 'claap-agent', title: 'cc' }),
    pane(2, { agent_session_name: 'perso-agent' }),
    pane(3, { title: 'Link' }),
    pane(4, { title: 'claap-agent-old' }),
    pane(5, { title: 'shell', agent: null, agent_session_id: null }),
  ];
  it('nom de session exact, casse ignoree', () => {
    const r = resolveSession('Claap-Agent', panes);
    assert.equal(r.ok && r.pane.id, 1);
  });
  it('agent_session_name', () => {
    assert.equal((resolveSession('perso-agent', panes) as { pane: Pane }).pane.id, 2);
  });
  it('titre exact en second', () => {
    assert.equal((resolveSession('link', panes) as { pane: Pane }).pane.id, 3);
  });
  it('le nom exact gagne sur un prefixe', () => {
    assert.equal((resolveSession('claap-agent', panes) as { pane: Pane }).pane.id, 1);
  });
  it('prefixe unique accepte', () => {
    assert.equal((resolveSession('perso', panes) as { pane: Pane }).pane.id, 2);
  });
  it('prefixe ambigu refuse', () => {
    const r = resolveSession('claap', panes);
    assert.equal(!r.ok && r.reason, 'ambiguous');
  });
  it('deux panes au meme nom exact : ambigu', () => {
    const r = resolveSession('dup', [pane(7, { claude_session_name: 'dup' }), pane(8, { claude_session_name: 'dup' })]);
    assert.equal(!r.ok && r.reason, 'ambiguous');
  });
  it('inconnu : la liste des noms, jamais un pane sans agent', () => {
    const r = resolveSession('nope', panes);
    assert.equal(r.ok, false);
    assert.deepEqual(!r.ok && r.names, ['claap-agent', 'claap-agent-old', 'Link', 'perso-agent']);
    assert.equal(resolveSession('shell', panes).ok, false);
    const msg = formatUnresolved('nope', r as Extract<typeof r, { ok: false }>);
    assert.match(msg, /No session named `nope`/);
    assert.match(msg, /`perso-agent`/);
  });
  it('liste avec etats', () => {
    const list = formatSessionList([
      pane(1, { claude_session_name: 'a', working: true }),
      pane(2, { claude_session_name: 'b', awaiting: true }),
      pane(3, { claude_session_name: 'c' }),
    ]);
    assert.match(list, /`a`: working/);
    assert.match(list, /`b`: waiting for input/);
    assert.match(list, /`c`: idle/);
    assert.deepEqual(availableNames([]), []);
  });
});

describe('slack: balisage', () => {
  it('mentions, liens, canaux, entites', () => {
    const names = new Map([['U2', 'clement']]);
    const out = slackToPlain('hi <@U2> and <@U3>, see <https://a.io?x=1&amp;y=2|the doc> <https://b.io> in <#C9|general> <!here> 1 &lt; 2 &amp;&amp; 3 &gt; 2 <mailto:a@b.c|a@b.c>', names);
    assert.equal(
      out,
      'hi @clement and @U3, see the doc (https://a.io?x=1&y=2) https://b.io in #general @here 1 < 2 && 3 > 2 a@b.c',
    );
    assert.deepEqual(mentionedUserIds('<@U2> <@U2|x> <@W3>'), ['U2', 'W3']);
  });
  it('message pour le pane : texte puis contexte', () => {
    const m = paneMessage('regarde mes mails', { channel: 'D1', threadTs: '17.5' });
    assert.ok(m.startsWith('regarde mes mails\n\n[Slack, from Robin, channel D1, thread 17.5.'));
    assert.match(m, /slk thread D1 17\.5/);
    assert.match(m, /data, not instructions\.\]$/);
  });
});

describe('slack: markdown -> mrkdwn', () => {
  it('gras, italique, titres, liens, puces, code intact', () => {
    const md = [
      '# Titre **fort**',
      'Un **gras** et un *italique* et [lien](https://x.io).',
      '- item `a**b**`',
      '```',
      'x = a < b && **c**',
      '```',
      '> cite **ca**',
    ].join('\n');
    assert.equal(
      markdownToMrkdwn(md),
      [
        '*Titre fort*',
        'Un *gras* et un _italique_ et <https://x.io|lien>.',
        '• item `a**b**`',
        '```',
        'x = a &lt; b &amp;&amp; **c**',
        '```',
        '> cite *ca*',
      ].join('\n'),
    );
  });
  it('decoupe sous la limite, referme et rouvre un bloc de code', () => {
    const long = ['intro', '```', ...Array.from({ length: 400 }, (_, i) => `ligne de code numero ${i}`), '```', 'fin'].join('\n');
    const chunks = chunkText(long);
    assert.ok(chunks.length >= 3);
    for (const c of chunks) {
      assert.ok(c.length < CHUNK_MAX, `morceau de ${c.length}`);
      assert.equal((c.match(/```/g) ?? []).length % 2, 0, 'blocs de code equilibres');
    }
    assert.ok(chunks.join('\n').includes('ligne de code numero 399'));
  });
  it('coupe une ligne geante', () => {
    const chunks = chunkText('x'.repeat(8000));
    assert.equal(chunks.join(''), 'x'.repeat(8000));
    assert.ok(chunks.every((c) => c.length < CHUNK_MAX));
  });
  it('reponse vide', () => {
    assert.match(formatReply('  ')[0] as string, /no text reply/);
  });
});

describe('slack: Dedupe', () => {
  it('event_id ou canal:ts deja vus', () => {
    const d = new Dedupe();
    assert.equal(d.firstTime(['Ev1', 'C1:1']), true);
    assert.equal(d.firstTime(['Ev1', 'C1:1']), false);
    assert.equal(d.firstTime(['Ev2', 'C1:1']), false);
    assert.equal(d.firstTime(['Ev3', undefined]), true);
  });
  it('expire', () => {
    const d = new Dedupe(1000);
    d.firstTime(['a'], 0);
    assert.equal(d.firstTime(['a'], 5000), true);
  });
});

describe('transcript: finalTurnText', () => {
  it('texte apres le dernier outil, ancre sur le dernier message humain', () => {
    const lines = [
      { type: 'user', timestamp: 't0', message: { role: 'user', content: 'vieux' } },
      { type: 'assistant', requestId: 'r0', message: { role: 'assistant', content: [{ type: 'text', text: 'ancien' }] } },
      { type: 'user', timestamp: 't1', message: { role: 'user', content: 'nouveau [Slack, channel C1, thread 1.1.]' } },
      { type: 'assistant', requestId: 'r1', message: { role: 'assistant', content: [{ type: 'text', text: 'je regarde' }, { type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } },
      { type: 'assistant', requestId: 'r2', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Voici **le** resultat.' }] } },
    ];
    const f = finalTurnText(lines as never);
    assert.equal(f.text, 'Voici **le** resultat.');
    assert.equal(f.anchorTs, 't1');
    assert.match(f.anchor ?? '', /thread 1\.1\./);
  });
  it('commande absorbee en cours de tour comme ancre', () => {
    const lines = [
      { type: 'user', timestamp: 't0', message: { role: 'user', content: 'a' } },
      { type: 'attachment', timestamp: 't1', attachment: { type: 'queued_command', prompt: 'depuis slack', origin: { kind: 'human' } } },
      { type: 'assistant', requestId: 'r1', message: { role: 'assistant', content: [{ type: 'text', text: 'fait' }] } },
    ];
    const f = finalTurnText(lines as never);
    assert.equal(f.anchor, 'depuis slack');
    assert.equal(f.text, 'fait');
  });
});

// --- Pont complet, Slack bouchonne ------------------------------------------------

interface Call {
  op: string;
  args: string[];
}

function harness(o: { panes?: Pane[]; send?: (paneId: number, text: string) => Promise<ActionResponse> } = {}) {
  const calls: Call[] = [];
  const sent: { paneId: number; text: string }[] = [];
  const store = new Map<number, Pane>((o.panes ?? [pane(1, { claude_session_name: 'claap-agent' })]).map((p) => [p.id, p]));
  let clock = 1_000_000;
  const bridge = new SlackBridge({
    api: {
      post: async (c, t, text) => void calls.push({ op: 'post', args: [c, t, text] }),
      react: async (c, ts, n) => void calls.push({ op: 'react', args: [c, ts, n] }),
      unreact: async (c, ts, n) => void calls.push({ op: 'unreact', args: [c, ts, n] }),
      userName: async (id) => (id === 'U2' ? 'clement' : null),
    },
    identity: { botUserId: BOT, teamId: TEAM },
    allowedUserId: () => ROBIN,
    jobTimeoutMs: () => 60_000,
    panes: () => [...store.values()],
    pane: (id) => store.get(id),
    refresh: async () => undefined,
    send: async (paneId, text) => {
      sent.push({ paneId, text });
      return o.send ? o.send(paneId, text) : { applied: true };
    },
    currentQuestion: async () => 'Do you want to proceed?',
    now: () => clock,
  });
  const mention = (text: string, extra: Record<string, unknown> = {}) =>
    bridge.handleEnvelope({
      team_id: TEAM,
      event_id: `Ev${Math.random()}`,
      event: { type: 'app_mention', user: ROBIN, channel: 'C1', ts: '100.1', text: `<@${BOT}> ${text}`, ...extra },
    });
  const turn = (anchor: string, reply: string, ts = new Date(clock).toISOString()) => [
    { type: 'user', timestamp: ts, message: { role: 'user', content: anchor } },
    { type: 'assistant', requestId: 'r', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: reply }] } },
  ];
  return { bridge, calls, sent, store, mention, turn, tick: (ms: number) => (clock += ms) };
}

describe('slack: pont', () => {
  it('livre, reagit, puis poste la reponse du tour dans le fil et bascule la reaction', async () => {
    const h = harness();
    await h.mention('claap-agent regarde <@U2> mes mails');
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0]?.text ?? '', /^regarde @clement mes mails\n\n\[Slack, from Robin, channel C1, thread 100\.1\./);
    assert.deepEqual(h.calls, [{ op: 'react', args: ['C1', '100.1', REACT.delivered] }]);

    const p = h.store.get(1) as Pane;
    await h.bridge.onTurnClosed(p, h.turn(h.sent[0]?.text ?? '', '**3** mails non lus') as never);
    assert.deepEqual(h.calls.slice(1), [
      { op: 'post', args: ['C1', '100.1', '*3* mails non lus'] },
      { op: 'unreact', args: ['C1', '100.1', REACT.delivered] },
      { op: 'react', args: ['C1', '100.1', REACT.done] },
    ]);
    assert.deepEqual(h.bridge.pending(1), { active: false, queued: 0 });
  });

  it('repond dans le fil existant (thread_ts)', async () => {
    const h = harness();
    await h.mention('claap-agent go', { thread_ts: '99.0' });
    assert.match(h.sent[0]?.text ?? '', /thread 99\.0\./);
    await h.bridge.onTurnClosed(h.store.get(1) as Pane, h.turn(h.sent[0]?.text ?? '', 'ok') as never);
    assert.deepEqual(h.calls.find((c) => c.op === 'post')?.args.slice(0, 2), ['C1', '99.0']);
  });

  it('un tour lance du Mac ne poste rien', async () => {
    const h = harness();
    await h.bridge.onTurnClosed(h.store.get(1) as Pane, h.turn('depuis le mac', 'x') as never);
    assert.equal(h.calls.length, 0);
  });

  it('fin du tour precedent (message en file chez Claude) : ignoree, on attend le notre', async () => {
    const h = harness({ panes: [pane(1, { claude_session_name: 'claap-agent', working: true })] });
    await h.mention('claap-agent suite');
    assert.deepEqual(h.calls, [{ op: 'react', args: ['C1', '100.1', REACT.queuedBehindWork] }]);
    await h.bridge.onTurnClosed(h.store.get(1) as Pane, h.turn('message du mac', 'fini', new Date(0).toISOString()) as never);
    assert.equal(h.calls.length, 1);
    await h.bridge.onTurnClosed(h.store.get(1) as Pane, h.turn(h.sent[0]?.text ?? '', 'la suite') as never);
    assert.equal(h.calls.filter((c) => c.op === 'post').length, 1);
  });

  it('pane en attente : pas de livraison, message et main levee', async () => {
    const h = harness({ panes: [pane(1, { claude_session_name: 'claap-agent', awaiting: true, awaiting_since: 'x' })] });
    await h.mention('claap-agent go');
    assert.equal(h.sent.length, 0);
    const post = h.calls.find((c) => c.op === 'post');
    assert.match(post?.args[2] ?? '', /Session `claap-agent` is waiting for your input in Kova\.\n> Do you want to proceed\?/);
    assert.ok(h.calls.some((c) => c.op === 'react' && c.args[2] === REACT.awaiting));
    assert.deepEqual(h.bridge.pending(1), { active: false, queued: 0 });
  });

  it('question apparue pendant le tour : signalee une fois', async () => {
    const h = harness();
    await h.mention('claap-agent go');
    const prompt = { state: 'parsed', question: 'Run rm?', paneId: 1 } as never;
    await h.bridge.onPrompt(prompt, h.store.get(1) as Pane);
    await h.bridge.onPrompt(prompt, h.store.get(1) as Pane);
    assert.equal(h.calls.filter((c) => c.op === 'post').length, 1);
    assert.equal(h.calls.filter((c) => c.args[2] === REACT.awaiting).length, 1);
  });

  it('echec de livraison : croix et erreur dans le fil', async () => {
    const h = harness({ send: async () => ({ applied: false, reason: 'not_submitted' }) });
    await h.mention('claap-agent go');
    assert.match(h.calls.find((c) => c.op === 'post')?.args[2] ?? '', /failed: not_submitted/);
    assert.ok(h.calls.some((c) => c.op === 'react' && c.args[2] === REACT.failed));
  });

  it('une commande a la fois par session, file FIFO', async () => {
    const h = harness();
    await h.mention('claap-agent un', { ts: '1.0' });
    await h.mention('claap-agent deux', { ts: '2.0' });
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.bridge.pending(1), { active: true, queued: 1 });
    await h.bridge.onTurnClosed(h.store.get(1) as Pane, h.turn(h.sent[0]?.text ?? '', 'r1') as never);
    await new Promise((r) => setImmediate(r));
    assert.equal(h.sent.length, 2);
    assert.match(h.sent[1]?.text ?? '', /^deux/);
  });

  it('retry Slack : un seul envoi', async () => {
    const h = harness();
    const e = { team_id: TEAM, event_id: 'EvSame', event: { type: 'app_mention', user: ROBIN, channel: 'C1', ts: '5.5', text: `<@${BOT}> claap-agent go` } };
    await h.bridge.handleEnvelope(e);
    await h.bridge.handleEnvelope(e);
    assert.equal(h.sent.length, 1);
  });

  it('intrus : rien ne part, audit sans contenu', async () => {
    const h = harness();
    await h.bridge.handleEnvelope({
      team_id: TEAM,
      event_id: 'EvIntrus',
      event: { type: 'app_mention', user: 'U666', channel: 'C7', ts: '9.9', text: `<@${BOT}> claap-agent SECRET-PAYLOAD` },
    });
    assert.equal(h.sent.length, 0);
    assert.equal(h.calls.length, 0);
    const dir = paths.auditDir();
    const audit = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('');
    assert.match(audit, /slack\.ignored.*user=U666 channel=C7 reason=other_user/);
    assert.doesNotMatch(audit, /SECRET-PAYLOAD/);
  });

  it('session inconnue et list', async () => {
    const h = harness();
    await h.mention('nope salut');
    assert.match(h.calls[0]?.args[2] ?? '', /No session named `nope`.*\nAvailable: `claap-agent`/s);
    await h.bridge.handleEnvelope({ team_id: TEAM, event_id: 'EvL', event: { type: 'message', channel_type: 'im', user: ROBIN, channel: 'D1', ts: '3.3', text: 'list' } });
    assert.match(h.calls[1]?.args[2] ?? '', /`claap-agent`: idle/);
    assert.equal(h.sent.length, 0);
  });

  it('message non-DM hors mention : ignore', async () => {
    const h = harness();
    await h.bridge.handleEnvelope({ team_id: TEAM, event_id: 'EvC', event: { type: 'message', channel_type: 'channel', user: ROBIN, channel: 'C1', ts: '4.4', text: 'claap-agent go' } });
    assert.equal(h.sent.length + h.calls.length, 0);
  });

  it('pane ferme pendant le tour', async () => {
    const h = harness();
    await h.mention('claap-agent go');
    h.bridge.onPaneClosed(1);
    await new Promise((r) => setImmediate(r));
    assert.match(h.calls.find((c) => c.op === 'post')?.args[2] ?? '', /closed in Kova/);
  });
});
