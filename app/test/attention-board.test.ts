// La file d'attention dans l'onglet Asks, la ligne d'etat d'une session de l'equipe et la
// passation d'une question : des regles pures, prouvees sur des entrees construites a la
// main. Noms inventes, aucune donnee de la machine de Robin.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AskItem, AttentionEntry, RosterEntry } from '@/protocol';
import {
  attentionButtonEnabled,
  attentionButtons,
  attentionOpenTarget,
  attentionSections,
} from '@/features/asks/attention';
import { handoffView } from '@/features/asks/handoff';
import { teamStatusLine } from '@/features/agents/teamStatus';

let seq = 0;
function entry(partial: Partial<AttentionEntry> = {}): AttentionEntry {
  seq += 1;
  return {
    id: `a-${String(seq).padStart(6, '0')}`,
    ts: `2026-11-05T10:${String(seq).padStart(2, '0')}:00+01:00`,
    from: 'chief',
    level: 'now',
    kind: 'info',
    title: `Entree ${seq}`,
    ...partial,
  };
}

describe('attention : sections et comptes', () => {
  it('range par niveau, now du plus ancien au plus recent', () => {
    const late = entry({ ts: '2026-11-05T12:00:00+01:00' });
    const early = entry({ ts: '2026-11-05T08:00:00+01:00' });
    const point = entry({ level: 'point', topic: 'watch' });
    const memo = entry({ level: 'memo' });
    const s = attentionSections([late, point, memo, early]);
    assert.deepEqual(
      s.now.map((e) => e.id),
      [early.id, late.id],
    );
    assert.deepEqual(
      s.memo.map((e) => e.id),
      [memo.id],
    );
    assert.equal(s.pointCount, 1);
  });

  it('groupe le prochain point par sujet, sans sujet a la fin, et compte chaque ligne', () => {
    const a1 = entry({ level: 'point', topic: 'voice' });
    const loose1 = entry({ level: 'point' });
    const b1 = entry({ level: 'point', topic: 'watch' });
    const a2 = entry({ level: 'point', topic: 'voice' });
    const loose2 = entry({ level: 'point', topic: '  ' });
    const s = attentionSections([loose2, b1, a2, loose1, a1]);
    assert.deepEqual(
      s.point.map((g) => [g.topic, g.entries.map((e) => e.id)]),
      [
        ['voice', [a1.id, a2.id]],
        ['watch', [b1.id]],
        [null, [loose1.id, loose2.id]],
      ],
    );
    // Le compte est la longueur de ce que la section liste, tous groupes confondus.
    assert.equal(s.pointCount, s.point.reduce((n, g) => n + g.entries.length, 0));
    assert.equal(s.pointCount, 5);
  });

  it('une file vide ne donne rien a afficher', () => {
    const s = attentionSections([]);
    assert.deepEqual(s, { now: [], point: [], pointCount: 0, memo: [] });
  });
});

describe('attention : Ouvrir', () => {
  it('une URL http(s) va au panneau web', () => {
    assert.deepEqual(attentionOpenTarget('https://linear.app/x/CLA-1'), { kind: 'web', target: 'https://linear.app/x/CLA-1' });
  });

  it('un .md ou .html du Mac, ancre retiree, espaces gardes', () => {
    assert.deepEqual(attentionOpenTarget('/Users/alice/AI directory/prep/2026-11-05.md#P1'), {
      kind: 'markdown',
      target: '/Users/alice/AI directory/prep/2026-11-05.md',
    });
    assert.deepEqual(attentionOpenTarget('~/notes/plan.html'), { kind: 'html', target: '~/notes/plan.html' });
  });

  it('un texte libre, un chemin relatif ou un autre fichier ne s ouvrent pas', () => {
    for (const action of [undefined, '', 'relancer Francisco', 'notes/plan.md', '/tmp/data.json', 'ftp://x/y.md']) {
      assert.equal(attentionOpenTarget(action), null, String(action));
    }
  });
});

describe('attention : boutons', () => {
  it('would : Envoyer et Ignorer, Ouvrir d abord s il s applique', () => {
    assert.deepEqual(attentionButtons(entry({ kind: 'would' })), ['Envoyer', 'Ignorer']);
    assert.deepEqual(attentionButtons(entry({ kind: 'would', action: 'https://x.y' })), ['Ouvrir', 'Envoyer', 'Ignorer']);
  });

  it('decision, review, test : Fait', () => {
    for (const kind of ['decision', 'review', 'test']) {
      assert.deepEqual(attentionButtons(entry({ kind })), ['Fait'], kind);
    }
    assert.deepEqual(attentionButtons(entry({ kind: 'review', action: '/x/y.md' })), ['Ouvrir', 'Fait']);
  });

  it('les autres genres : Ouvrir seulement quand il s applique', () => {
    for (const kind of ['blocked', 'done', 'ask', 'auto', 'info', 'nouveau']) {
      assert.deepEqual(attentionButtons(entry({ kind })), [], kind);
      assert.deepEqual(attentionButtons(entry({ kind, action: 'https://x.y' })), ['Ouvrir'], kind);
    }
    assert.deepEqual(attentionButtons(entry({ kind: 'info', action: 'texte libre' })), []);
  });

  it('un geste en vol eteint tout ; apres Envoyer, rien ne repart, Ouvrir reste', () => {
    const e = entry({ kind: 'would', action: 'https://x.y' });
    for (const b of ['Ouvrir', 'Envoyer', 'Ignorer'] as const) {
      assert.equal(attentionButtonEnabled(b, 'sending', e, false), false, b);
      assert.equal(attentionButtonEnabled(b, 'idle', e, false), true, b);
      assert.equal(attentionButtonEnabled(b, 'failed', e, false), true, b);
    }
    assert.equal(attentionButtonEnabled('Envoyer', 'sent', e, false), false);
    assert.equal(attentionButtonEnabled('Ignorer', 'sent', e, false), false);
    assert.equal(attentionButtonEnabled('Ouvrir', 'sent', e, false), true);
  });

  it('Mac injoignable : seul Ouvrir d une URL reste actif', () => {
    assert.equal(attentionButtonEnabled('Ouvrir', 'idle', entry({ action: 'https://x.y' }), true), true);
    assert.equal(attentionButtonEnabled('Ouvrir', 'idle', entry({ action: '/x/y.md' }), true), false);
    assert.equal(attentionButtonEnabled('Fait', 'idle', entry({ kind: 'test' }), true), false);
  });
});

describe('equipe : ligne d etat', () => {
  const base: RosterEntry = { name: 'byok', role: 'product-manager', state: 'working' };

  it('glyphe, mot, puis ce qu elle attend, sur une seule ligne', () => {
    assert.deepEqual(teamStatusLine({ ...base, status: 'awaiting-review', waitingOn: 'Francisco : la revue', doing: 'PR' }), {
      glyph: 'eye',
      tone: 'awaiting',
      text: 'awaiting-review · attend : Francisco : la revue',
    });
  });

  it('une session saine qui travaille : le mot et ce qu elle fait', () => {
    const line = teamStatusLine({ ...base, status: 'working', doing: 'tokens DS' });
    assert.equal(line?.text, 'working · tokens DS');
    assert.equal(line?.text.includes('\n'), false);
    assert.equal(teamStatusLine({ ...base, status: 'working' })?.text, 'working');
  });

  it('chaque etat de la liste fermee a sa propre icone', () => {
    const icons = new Set<string>();
    for (const status of ['awaiting-you', 'awaiting-review', 'blocked', 'queued', 'waiting-event', 'working', 'done'] as const) {
      const line = teamStatusLine({ ...base, status });
      assert.ok(line, status);
      icons.add(line.glyph);
    }
    assert.equal(icons.size, 7);
    assert.equal(teamStatusLine({ ...base, status: 'blocked' })?.tone, 'error');
  });

  it('sans etat, ou un etat inconnu : null, la ligne reste celle d avant', () => {
    assert.equal(teamStatusLine(base), null);
    assert.equal(teamStatusLine({ ...base, status: 'sleeping' as never }), null);
  });
});

describe('passation', () => {
  function ask(partial: Partial<AskItem>): AskItem {
    return {
      id: 'q1',
      from: 'agent',
      message: 'Connecte-toi',
      buttons: ['Ouvrir', 'Fait'],
      input: false,
      askedAtMs: 1,
      snoozedUntilMs: 0,
      due: true,
      waiting: true,
      sessionId: null,
      cwd: null,
      kind: 'handoff',
      handoff: { step: 'Ouvrir', url: 'https://sso.example.com', run: null, command: null, label: null, error: null },
      ...partial,
    };
  }

  it('une URL : le pas Ouvrir, l URL verbatim, puis Fait', () => {
    assert.deepEqual(handoffView(ask({})), {
      step: 'Ouvrir',
      run: false,
      text: 'https://sso.example.com',
      label: null,
      error: null,
      done: 'Fait',
    });
  });

  it('une commande : le pas Lancer et la commande telle que Kova la rend', () => {
    const view = handoffView(
      ask({
        buttons: ['Lancer', 'Fait'],
        handoff: { step: 'Lancer', url: null, run: 'aws-login', command: 'aws sso login --profile dev', label: 'AWS', error: null },
      }),
    );
    assert.equal(view?.run, true);
    assert.equal(view?.step, 'Lancer');
    assert.equal(view?.text, 'aws sso login --profile dev');
  });

  it('pas de vue pour une autre question ou un pas hors des boutons', () => {
    assert.equal(handoffView(ask({ kind: 'decision' })), null);
    assert.equal(handoffView(ask({ handoff: null })), null);
    assert.equal(handoffView(ask({ buttons: ['Fait'] })), null);
  });
});
