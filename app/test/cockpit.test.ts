// Le Cockpit sur le telephone : les regles de Kova (`kova/src/cockpit.rs`) en fonctions
// pures, et ce que devient une carte apres un geste. Noms inventes, aucune donnee de la
// machine de Robin.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AttentionEntry } from '@/protocol';
import {
  PAGE_SIZE,
  askRefOf,
  cockpitAge,
  cockpitButtons,
  cockpitGoLabel,
  cockpitIcons,
  cockpitLegacy,
  cockpitPage,
  cockpitPrimary,
  cockpitPrio,
  cockpitScope,
  cockpitZoneGestures,
  cockpitZoneShownFolded,
  draftToSend,
  inkOn,
  resolveAskId,
} from '@/features/cockpit/rules';
import {
  ClientIds,
  FILE_GUARD_MS,
  HIDE_MS,
  classifyGesture,
  clipped,
  failedToast,
  filedToast,
  gesturePayload,
  isoWithOffset,
  newClientId,
  pruneCards,
  settleGesture,
  snoozeDate,
  startGesture,
  visibleEntries,
  type CardsState,
} from '@/features/cockpit/gesture';
import { ATTENTION_CLIENT_ID_RE } from '@/protocol';

let seq = 0;
function card(partial: Partial<AttentionEntry> = {}): AttentionEntry {
  seq += 1;
  return {
    id: `a-${String(seq).padStart(6, '0')}`,
    ts: `2026-11-05T10:${String(seq % 60).padStart(2, '0')}:00+01:00`,
    from: 'chief',
    level: 'now',
    kind: 'info',
    title: `Carte ${seq}`,
    gestures: ['go', 'nogo', 'ask', 'seen', 'done', 'dismiss'],
    waiting: 'robin',
    ...partial,
  };
}

const EMPTY: CardsState = { texts: {}, drafts: {}, expanded: {}, running: {}, hidden: {}, holdUntil: 0, toasts: [] };

describe('cockpit : sections, filtre, page', () => {
  it('la priorite : prio, sinon now 2 et point 3 ; memo jamais', () => {
    assert.equal(cockpitPrio(card({ prio: 1, level: 'point' })), 1);
    assert.equal(cockpitPrio(card({ level: 'now' })), 2);
    assert.equal(cockpitPrio(card({ level: 'point' })), 3);
    assert.equal(cockpitPrio(card({ level: 'memo' })), null);
    assert.equal(cockpitPrio(card({ level: 'memo', prio: 1 })), null);
  });

  it('les sections dans l ordre, la plus ancienne d abord, l id departage', () => {
    const a = card({ level: 'point', ts: '2026-11-05T09:00:00+01:00', id: 'a-00000b' });
    const b = card({ level: 'point', ts: '2026-11-05T09:00:00+01:00', id: 'a-00000a' });
    const u = card({ prio: 1, ts: '2026-11-05T12:00:00+01:00' });
    const n = card({ level: 'now', ts: '2026-11-05T08:00:00+01:00' });
    const page = cockpitPage([a, b, u, n, card({ level: 'memo' })], 'all', PAGE_SIZE);
    assert.deepEqual(
      page.sections.map((s) => [s.name, s.count, s.cards.map((c) => c.id)]),
      [
        ['Urgent', 1, [u.id]],
        ["Aujourd'hui", 1, [n.id]],
        ['Cette semaine', 2, ['a-00000a', 'a-00000b']],
      ],
    );
    assert.equal(page.total, 4);
    assert.equal(page.urgent, 1);
  });

  it('le filtre : Claap par defaut, Perso par scope ; chaque compte est ce qu il garderait', () => {
    const list = [card({ scope: 'perso' }), card({ scope: 'pro' }), card({}), card({ level: 'memo', scope: 'perso' })];
    assert.equal(cockpitScope(list[2] as AttentionEntry), 'claap');
    const page = cockpitPage(list, 'perso', PAGE_SIZE);
    assert.deepEqual(page.filterCounts, { all: 3, claap: 2, perso: 1 });
    assert.equal(page.total, 1);
    assert.equal(cockpitPage(list, 'claap', PAGE_SIZE).total, page.filterCounts.claap);
  });

  it('10 cartes, puis Voir plus (N) ; la section compte toutes ses cartes', () => {
    const list = Array.from({ length: 23 }, () => card({ level: 'now' }));
    const first = cockpitPage(list, 'all', PAGE_SIZE);
    assert.equal(first.sections[0]?.cards.length, 10);
    assert.equal(first.sections[0]?.count, 23);
    assert.equal(first.more, 13);
    const second = cockpitPage(list, 'all', PAGE_SIZE * 2);
    assert.equal(second.more, 3);
    assert.equal(cockpitPage(list, 'all', PAGE_SIZE * 3).more, 0);
  });

  it('la page coupe a travers les sections, une section au dela n apparait pas', () => {
    const list = [...Array.from({ length: 8 }, () => card({ prio: 1 })), ...Array.from({ length: 5 }, () => card({ level: 'point' }))];
    const page = cockpitPage(list, 'all', PAGE_SIZE);
    assert.deepEqual(
      page.sections.map((s) => [s.prio, s.cards.length, s.count]),
      [
        [1, 8, 8],
        [3, 2, 5],
      ],
    );
    assert.equal(page.more, 3);
  });

  it('l age, comme le Mac', () => {
    const c = card({ ts: '2026-11-05T10:00:00+01:00' });
    const at = Date.parse(c.ts);
    assert.equal(cockpitAge(c, at + 30_000), "à l'instant");
    assert.equal(cockpitAge(c, at + 4 * 60_000), 'il y a 4 min');
    assert.equal(cockpitAge(c, at + 2 * 3600_000), 'il y a 2 h');
    assert.equal(cockpitAge(c, at + 30 * 3600_000), 'hier');
    assert.equal(cockpitAge(c, at + 3 * 86_400_000), 'il y a 3 j');
    assert.equal(cockpitAge(card({ ts: 'x' }), at), '');
  });
});

describe('cockpit : ce que montre une carte', () => {
  it('une carte qui attend un go : Go en un appui, et Repondre qui ouvre la zone', () => {
    const c = card({ kind: 'would' });
    assert.equal(cockpitPrimary(c), 'go');
    assert.deepEqual(cockpitButtons(c), ['respond', 'go']);
    assert.deepEqual(cockpitIcons(c, false), ['snooze', 'seen', 'dismiss', 'done']);
  });

  it('Decider, Tester, Brief selon le genre ; rien pour une info', () => {
    assert.equal(cockpitPrimary(card({ kind: 'decision' })), 'decide');
    assert.equal(cockpitPrimary(card({ kind: 'decision', action: 'https://x.test/pr/1' })), 'go');
    assert.equal(cockpitPrimary(card({ kind: 'test' })), 'test');
    assert.equal(cockpitPrimary(card({ kind: 'blocked' })), 'brief');
    assert.equal(cockpitPrimary(card({ kind: 'info' })), null);
  });

  it('une fiche kova-sheet : Decider ouvre la fiche, pas de zone', () => {
    const c = card({ kind: 'decision', action: 'kova-sheet:0b5c1c2e' });
    assert.equal(cockpitPrimary(c), 'sheet');
    assert.deepEqual(cockpitButtons(c), ['sheet']);
    assert.deepEqual(askRefOf('kova-ask:abcdef12'), { id: 'abcdef12', sheet: false });
    assert.equal(askRefOf('kova-sheet:abc'), null);
    assert.equal(resolveAskId('0b5c1c', ['0b5c1c2e-1111', 'ffff']), '0b5c1c2e-1111');
    assert.equal(resolveAskId('0b5c1c', ['0b5c1c2e', '0b5c1c99']), '0b5c1c', 'ambigu : tel quel');
  });

  it('Voir quand l action s ouvre dans le panneau', () => {
    assert.deepEqual(cockpitButtons(card({ kind: 'info', action: 'https://linear.app/x' })), ['open']);
  });

  it('un brouillon montre sa zone d office, Go dit Go, envoyer, sans bouton en tete', () => {
    const c = card({ kind: 'would', draft: { text: 'Hello', seen: '0123456789abcdef' } });
    assert.equal(cockpitZoneShownFolded(c), true);
    assert.equal(cockpitPrimary(c), null);
    assert.equal(cockpitGoLabel(c), 'Go, envoyer');
    assert.equal(cockpitGoLabel({ ...c, goLabel: 'Go' }), 'Go');
    assert.deepEqual(cockpitZoneGestures(c), ['seen', 'nogo', 'ask', 'go']);
    assert.deepEqual(cockpitIcons(c, true), ['snooze', 'dismiss', 'done'], 'Vu passe dans la rangee de la zone');
  });

  it('une carte qui attend l agent : l horloge, la coche si listee, rien d autre', () => {
    const c = card({ gestures: ['cancel', 'done'], waiting: 'agent', ask: { text: 'Pourquoi ?' } });
    assert.deepEqual(cockpitIcons(c, false), ['snooze', 'done']);
    assert.deepEqual(cockpitButtons(c), []);
    assert.deepEqual(cockpitZoneGestures(c), []);
  });

  it('un envoi incertain garde ses deux issues', () => {
    const c = card({ kind: 'would', gestures: [], uncertain: 'timeout', draft: { text: 'x' } });
    assert.deepEqual(cockpitButtons(c), []);
    const zoned = card({ kind: 'would', gestures: ['done'], uncertain: 'timeout', draft: { text: 'x' } });
    assert.deepEqual(cockpitButtons(zoned), ['parti', 'Renvoyer']);
  });

  it('une carte sans gestures (daemon d avant) garde la ligne d avant', () => {
    const { gestures: _g, ...old } = card();
    assert.equal(cockpitLegacy(old), true);
    assert.equal(cockpitLegacy(card()), false);
  });

  it('le brouillon ne part que reecrit', () => {
    const c = card({ draft: { text: 'Hello' } });
    assert.equal(draftToSend(c, undefined), undefined);
    assert.equal(draftToSend(c, 'Hello'), undefined);
    assert.equal(draftToSend(c, '  '), undefined);
    assert.equal(draftToSend(c, 'Hello Sacha'), 'Hello Sacha');
  });

  it('l encre d une pastille se lit sur sa couleur', () => {
    assert.equal(inkOn('#FDE68A'), '#111111');
    assert.equal(inkOn('#1E3A8A'), '#FFFFFF');
    assert.equal(inkOn('rouge'), '#FFFFFF');
  });
});

describe('cockpit : apres un geste', () => {
  const ok = (outcome: 'delivered' | 'noted' | 'said', line?: string) =>
    ({ ok: true, response: { outcome, ...(line ? { line } : {}) } }) as const;
  const http = (status: number, code: string, message = 'm') => ({ ok: false, kind: 'http', status, code, message }) as const;

  it('classe : les gestes qui rangent la carte, ceux qui la laissent', () => {
    assert.deepEqual(classifyGesture('go', ok('delivered')), { kind: 'filed' });
    assert.deepEqual(classifyGesture('seen', ok('noted')), { kind: 'filed' });
    assert.deepEqual(classifyGesture('ask', ok('delivered')), { kind: 'stays' });
    assert.deepEqual(classifyGesture('cancel', ok('delivered')), { kind: 'stays' });
    assert.deepEqual(classifyGesture('Renvoyer', ok('delivered')), { kind: 'stays' });
    assert.deepEqual(classifyGesture('parti', ok('delivered')), { kind: 'filed' });
    assert.deepEqual(classifyGesture('snooze', { ok: true, response: { applied: true } }), { kind: 'filed' });
    assert.deepEqual(classifyGesture('go', ok('said', 'déjà parti')), { kind: 'filed', said: 'déjà parti' });
  });

  it('les refus disent pourquoi, une coupure ou un 502 restent non confirmes', () => {
    assert.deepEqual(classifyGesture('go', http(409, 'ATTENTION_REFUSED', 'ce brouillon a change')), {
      kind: 'refused',
      reason: 'ce brouillon a change',
    });
    assert.deepEqual(classifyGesture('go', http(409, 'ATTENTION_CARD_CHANGED')), {
      kind: 'refused',
      reason: "la carte a changé depuis son affichage, relis-la : rien n'est noté ni fermé",
    });
    assert.equal(classifyGesture('go', http(409, 'ATTENTION_GESTURE_NOT_OFFERED')).kind, 'refused');
    assert.equal(classifyGesture('go', http(404, 'ATTENTION_NOT_FOUND')).kind, 'refused');
    assert.deepEqual(classifyGesture('go', http(502, 'ATTENTION_ERROR')), { kind: 'unknown' });
    assert.deepEqual(classifyGesture('go', { ok: false, kind: 'network', message: 'timeout' }), { kind: 'unknown' });
  });

  it('un report refuse par attn dit Non transmis avec sa ligne, jamais Envoi non confirmé', () => {
    const c = card({ title: 'T' });
    const result = classifyGesture('snooze', http(409, 'ATTENTION_REFUSED', "attn: a-f7c938 n'a pas d'envoi incertain"));
    assert.deepEqual(result, { kind: 'refused', reason: "attn: a-f7c938 n'a pas d'envoi incertain" });
    const st = settleGesture(startGesture(EMPTY, c.id, 'snooze'), c, 'snooze', result, { text: '' }, 1, 7);
    assert.deepEqual(st.toasts[0], { id: 7, ok: false, head: 'Non transmis', title: 'T', more: "attn: a-f7c938 n'a pas d'envoi incertain." });
    assert.deepEqual(st.hidden, {}, 'la carte reste');
  });

  it('le texte qui part : seulement sur les gestes qui le prennent ; Demander exige un texte', () => {
    const c = card({ draft: { text: 'x', seen: '0123456789abcdef' } });
    const st: CardsState = { ...EMPTY, texts: { [c.id]: '  pas encore  ' } };
    assert.deepEqual(gesturePayload(st, c, 'go', 0, 'nouveau'), { text: 'pas encore', draft: 'nouveau', seen: '0123456789abcdef' });
    assert.deepEqual(gesturePayload(st, c, 'nogo', 0, 'nouveau'), { text: 'pas encore' });
    assert.deepEqual(gesturePayload(st, c, 'cancel', 0, undefined), { text: '' });
    assert.deepEqual(gesturePayload(st, c, 'parti', 0, undefined), { text: '', seen: '0123456789abcdef' });
    assert.equal(gesturePayload(EMPTY, c, 'ask', 0, undefined), null);
  });

  it('une carte en vol, ou la garde de 700 ms, bloque tout appui', () => {
    const c = card();
    const running = startGesture(EMPTY, c.id, 'go');
    assert.equal(gesturePayload(running, c, 'seen', 0, undefined), null);
    const held: CardsState = { ...EMPTY, holdUntil: 1_000 };
    assert.equal(gesturePayload(held, c, 'go', 999, undefined), null);
    assert.ok(gesturePayload(held, c, 'go', 1_000, undefined));
  });

  it('classee : la carte part, la garde commence, le toast dit le geste, la carte et le texte', () => {
    const c = card({ title: 'Relancer Sacha' });
    let st: CardsState = { ...EMPTY, texts: { [c.id]: 'ok pour moi' }, expanded: { [c.id]: true } };
    st = startGesture(st, c.id, 'nogo');
    st = settleGesture(st, c, 'nogo', { kind: 'filed' }, { text: 'ok pour moi' }, 5_000, 1);
    assert.deepEqual(st.running, {});
    assert.equal(st.hidden[c.id], 5_000);
    assert.equal(st.holdUntil, 5_000 + FILE_GUARD_MS);
    assert.equal(st.texts[c.id], undefined);
    assert.equal(st.expanded[c.id], undefined);
    assert.deepEqual(st.toasts, [{ id: 1, ok: true, head: 'No go noté', title: 'Relancer Sacha', more: 'Ton texte, parti avec : ok pour moi' }]);
    assert.deepEqual(visibleEntries([c], st.hidden, 5_000 + 10), []);
    assert.deepEqual(visibleEntries([c], st.hidden, 5_000 + HIDE_MS), [c], 'apres 60 s, une carte encore listee revient');
  });

  it('refusee : la carte revient entiere, le texte et le brouillon restent, le toast dit Non transmis', () => {
    const c = card({ title: 'T', draft: { text: 'a' } });
    let st: CardsState = { ...EMPTY, texts: { [c.id]: 'mon texte' }, drafts: { [c.id]: 'b' } };
    st = startGesture(st, c.id, 'go');
    st = settleGesture(st, c, 'go', { kind: 'refused', reason: 'ce brouillon a change.' }, { text: 'mon texte', draft: 'b' }, 1, 2);
    assert.equal(st.texts[c.id], 'mon texte');
    assert.equal(st.drafts[c.id], 'b');
    assert.deepEqual(st.hidden, {});
    assert.equal(st.holdUntil, 0);
    assert.deepEqual(st.toasts[0], {
      id: 2,
      ok: false,
      head: 'Non transmis',
      title: 'T',
      more: 'ce brouillon a change. Ton texte est resté sur la carte.',
    });
  });

  it('sans reponse claire : rien ne change, Envoi non confirmé, pas de nouvel essai', () => {
    const c = card();
    const st = settleGesture(startGesture(EMPTY, c.id, 'go'), c, 'go', { kind: 'unknown' }, { text: '' }, 1, 3);
    assert.equal(st.toasts[0]?.head, 'Envoi non confirmé');
    assert.deepEqual(st.hidden, {});
    assert.deepEqual(st.running, {});
  });

  it('une question posee : la carte reste, le champ se vide', () => {
    const c = card();
    const st = settleGesture({ ...EMPTY, texts: { [c.id]: 'pourquoi ?' } }, c, 'ask', { kind: 'stays' }, { text: 'pourquoi ?' }, 1, 4);
    assert.equal(st.texts[c.id], undefined);
    assert.deepEqual(st.hidden, {});
  });

  it('le toast d une ligne de la file est neutre ; les textes longs sont coupes a 180', () => {
    const said = filedToast(5, 'go', 'T', '', 'envoi par le code (slack à U1)');
    assert.equal(said.neutral, true);
    assert.equal(said.head, 'envoi par le code (slack à U1)');
    const long = clipped('mot '.repeat(100));
    assert.ok(Array.from(long).length <= 181, 'coupe a 180, plus les points de suspension');
    assert.ok(long.endsWith('…'));
    assert.equal(failedToast(6, 'T', 'raison', false).more, 'raison.');
  });

  it('l identifiant de clic : repris pour le meme essai, neuf sinon, oublie une fois pris', () => {
    let n = 0;
    const ids = new ClientIds(() => `c-${++n}`);
    assert.equal(ids.for('a-1', 'go', 'x', undefined), 'c-1');
    assert.equal(ids.for('a-1', 'go', ' x ', undefined), 'c-1');
    assert.equal(ids.for('a-1', 'go', 'x', 'brouillon'), 'c-2');
    assert.equal(ids.for('a-1', 'nogo', 'x', undefined), 'c-3');
    ids.forget('a-1', 'go', 'x', undefined);
    assert.equal(ids.for('a-1', 'go', 'x', undefined), 'c-4');
    ids.keepCards(new Set());
    assert.equal(ids.for('a-1', 'nogo', 'x', undefined), 'c-5');
    assert.match(newClientId(), ATTENTION_CLIENT_ID_RE);
  });

  it('oublie l etat des cartes parties', () => {
    const st = pruneCards({ ...EMPTY, texts: { 'a-1': 'x', 'a-2': 'y' }, hidden: { 'a-1': 0, 'a-2': 0 } }, new Set(['a-1']), 10);
    assert.deepEqual(st.texts, { 'a-1': 'x' });
    assert.deepEqual(st.hidden, { 'a-1': 0 });
    assert.deepEqual(pruneCards(st, new Set(['a-1']), HIDE_MS + 1).hidden, {});
  });
});

describe('cockpit : report', () => {
  // Dates locales : les tests ne supposent pas le fuseau de la machine.
  const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

  it('Dans 1 h, Ce soir (ou demain une fois 19 h passe), Demain matin, Lundi prochain', () => {
    const wed = at(2026, 11, 18, 10, 30);
    assert.equal(snoozeDate('hour', wed).getTime(), wed.getTime() + 3600_000);
    assert.deepEqual(snoozeDate('evening', wed), at(2026, 11, 18, 19));
    assert.deepEqual(snoozeDate('evening', at(2026, 11, 18, 20)), at(2026, 11, 19, 19));
    assert.deepEqual(snoozeDate('morning', wed), at(2026, 11, 19, 9));
    assert.deepEqual(snoozeDate('monday', wed), at(2026, 11, 23, 9));
    assert.deepEqual(snoozeDate('monday', at(2026, 11, 23, 8)), at(2026, 11, 30, 9), 'un lundi : le suivant');
  });

  it('ISO avec decalage, relu a la meme date', () => {
    const d = at(2026, 11, 19, 9);
    const iso = isoWithOffset(d);
    assert.match(iso, /^2026-11-19T09:00:00[+-]\d{2}:\d{2}$/);
    assert.equal(Date.parse(iso), d.getTime());
  });
});
