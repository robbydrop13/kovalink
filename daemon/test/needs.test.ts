// Le daemon traduit ce qu'il sait deja (panes, prompts de permission, questions) vers
// `NeedInput`, et la pastille comme le message `asks` lisent le meme compte. Ces tests
// couvrent le passage de `Pane.error`, la resolution d'une question vers son pane, le
// report, et le fait qu'une erreur ne compte jamais comme une reponse attendue.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env['KOVALINK_KOVA_CONFIG'] = mkdtempSync(join(tmpdir(), 'kovalink-kova-needs-'));
process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-needs-'));
process.env['KOVALINK_QUIET'] = '1';

// AVANT tout import du daemon : sans ce dossier, le journal du test s'ecrit dans le
// vrai `~/.kovalink/logs/kovalinkd.log` de la machine.

const { PaneStore, toPane } = await import('../src/kova/panes.js');
const { needInputOf, waitsOnYouOf } = await import('../src/needs.js');
type AskItem = import('@kovalink/protocol').AskItem;

/** Horloge fixe : 5 000 000 ms, soit 5 000 s epoch. */
const NOW = 5_000_000;
/** Le prompt de permission du pane 5, pose a 4 000 s. */
const PERMISSION = new Date(4_000_000).toISOString();

const RAW: Record<string, unknown> = {
  id: 5,
  window: 0,
  tab: 0,
  cwd: '/tmp/web',
  title: 'web',
  pid: 10,
  agent: 'claude',
  agent_session_id: 'sess-web',
  awaiting: false,
  child_processes: [],
};

/** Deux panes : web avec une permission, api avec une erreur sans horodatage. */
function store(): InstanceType<typeof PaneStore> {
  const panes = new PaneStore(() => NOW);
  panes.upsertRaw({ ...RAW });
  panes.upsertRaw({
    id: 9,
    window: 0,
    tab: 0,
    cwd: '/tmp/api',
    // Sans titre : `display_title("Shell")` de Kova retombe sur le dossier.
    title: null,
    pid: 11,
    agent: 'claude',
    agent_session_id: 'sess-api',
    error: { kind: 'Limit reached', text: 'resets 5:20pm' },
    child_processes: [],
  });
  panes.setAwaiting(5, true, PERMISSION, 'daemon');
  return panes;
}

const ask = (over: Partial<AskItem> = {}): AskItem => ({
  id: 'a1',
  from: 'agent',
  message: 'Ship the draft?\nSecond line',
  buttons: ['OK'],
  input: false,
  askedAtMs: 3_000_000,
  snoozedUntilMs: 0,
  due: true,
  waiting: true,
  sessionId: 'sess-web',
  cwd: '/tmp/web',
  ...over,
});

describe('Pane.error : recopie de Kova', () => {
  it('garde l erreur telle quelle, `null` reste `null`', () => {
    const error = { kind: 'API error', text: 'connection reset' };
    assert.deepEqual(toPane({ ...RAW, error }).error, error);
    const none = toPane({ ...RAW, error: null });
    assert.equal(none.error, null);
    assert.equal('error' in none, true, 'null dit « Kova affirme aucune erreur »');
  });

  it('laisse le champ ABSENT chez un Kova qui ne l expose pas', () => {
    assert.equal('error' in toPane(RAW), false);
  });

  it('ignore une forme inattendue plutot que d inventer une erreur', () => {
    assert.equal('error' in toPane({ ...RAW, error: 'boom' }), false);
    assert.equal('error' in toPane({ ...RAW, error: { kind: 'API error' } }), false);
  });
});

describe('needInputOf : l etat du daemon vers le modele de Kova', () => {
  it('porte la permission, l erreur et la question du meme pane, dedoublonnee', () => {
    const panes = store();
    const input = needInputOf(panes.all(), [ask()], NOW);

    assert.equal(input.now, 5_000);
    assert.deepEqual(input.routines, []);
    assert.deepEqual(
      input.panes?.find((pane) => pane.id === 9),
      {
        id: 9,
        error_since: 5_000,
        permission_since: null,
        title: 'api',
        detail: 'resets 5:20pm',
      },
    );
    assert.deepEqual(
      input.panes?.find((pane) => pane.id === 5),
      { id: 5, error_since: null, permission_since: 4_000, title: 'web', detail: null },
    );
    const question = input.asks?.[0];
    assert.equal(question?.pane_id, 5, 'la session de la question nomme son pane');
    assert.equal(question?.created_at, 3_000);
    assert.equal(question?.answered, false);
    assert.equal(question?.snoozed_until, null);
    assert.equal(question?.title, 'Ship the draft?');
    assert.equal(question?.detail, 'Second line');
    // Question posee a 3 000 s, permission a 4 000 s : une seule chose a repondre.
    assert.equal(waitsOnYouOf(panes.all(), [ask()], NOW), 1);
  });

  it('une erreur ne compte jamais dans la pastille', () => {
    const panes = store();
    panes.setAwaiting(5, false, null, 'daemon');
    assert.equal(waitsOnYouOf(panes.all(), [], NOW), 0);
  });

  it('une question reportee au dela de now ne compte pas, revenue elle compte', () => {
    const panes = store();
    panes.setAwaiting(5, false, null, 'daemon');
    assert.equal(waitsOnYouOf(panes.all(), [ask({ snoozedUntilMs: 6_000_000 })], NOW), 0);
    assert.equal(waitsOnYouOf(panes.all(), [ask({ snoozedUntilMs: 5_000_000 })], NOW), 1);
  });
});
