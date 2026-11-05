import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// AVANT tout import du daemon : sans ce dossier, le journal du test s'ecrit dans le
// vrai `~/.kovalink/logs/kovalinkd.log` de la machine.
process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-asks-'));
process.env['KOVALINK_QUIET'] = '1';

const { AskBoard, AskError, asksSignature, mapAsk, newlyDue } = await import('../src/kova/asks.js');
const { IpcError } = await import('../src/kova/ipc.js');
type AskItem = import('@kovalink/protocol').AskItem;

/** Une question telle que Kova la rend sur `list-asks`. */
const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '6f1c0000-0000-4000-8000-000000000001',
  from: 'release-client',
  message: 'Send the reply?',
  buttons: ['OK', 'KO'],
  input: true,
  asked_at: 1_792_000_000,
  snoozed_until: 0,
  due: true,
  waiting: true,
  session_id: 'abc-123',
  cwd: '/Users/robin/projet',
  ...over,
});

const item = (over: Partial<AskItem> = {}): AskItem => ({
  id: 'a',
  from: 'agent',
  message: 'm',
  buttons: ['OK'],
  input: true,
  askedAtMs: 0,
  snoozedUntilMs: 0,
  due: true,
  waiting: true,
  sessionId: null,
  cwd: null,
  ...over,
});

/** Un Kova de papier : une file de reponses, et les requetes recues. */
function fakeIpc(replies: { ok: boolean; data?: unknown; error?: string }[]) {
  const seen: Record<string, unknown>[] = [];
  return {
    seen,
    ipc: {
      request: async (payload: Record<string, unknown>) => {
        seen.push(payload);
        const next = replies.shift();
        if (!next) throw new IpcError('IPC_TIMEOUT', 'no reply left');
        return next;
      },
    } as never,
  };
}

describe('questions des agents : traduction', () => {
  it('traduit les champs de Kova, secondes comprises', () => {
    const ask = mapAsk(raw());
    assert.ok(ask);
    assert.equal(ask.askedAtMs, 1_792_000_000_000);
    assert.equal(ask.from, 'release-client');
    assert.deepEqual(ask.buttons, ['OK', 'KO']);
    assert.equal(ask.snoozedUntilMs, 0);
    assert.equal(ask.due, true);
    assert.equal(ask.sessionId, 'abc-123');
  });

  it('une question remise a plus tard porte son heure de retour et n est pas due', () => {
    const ask = mapAsk(raw({ snoozed_until: 1_792_001_800, due: false }));
    assert.equal(ask?.snoozedUntilMs, 1_792_001_800_000);
    assert.equal(ask?.due, false);
  });

  it('rejette une ligne qui n a pas la forme attendue plutot que d en lire la moitie', () => {
    assert.equal(mapAsk(null), null);
    assert.equal(mapAsk('ask'), null);
    assert.equal(mapAsk(raw({ id: 42 })), null);
    assert.equal(mapAsk(raw({ message: null })), null);
    // Sans bouton, il n'y a rien a repondre : la carte en met toujours au moins un.
    assert.equal(mapAsk(raw({ buttons: [] })), null);
  });

  it('un champ absent vaut son defaut, jamais undefined', () => {
    const ask = mapAsk({ id: 'x', message: '', buttons: ['Reply'] });
    assert.equal(ask?.from, 'agent');
    assert.equal(ask?.input, true);
    assert.equal(ask?.askedAtMs, 0);
    assert.equal(ask?.waiting, false);
    assert.equal(ask?.sessionId, null);
  });
});

describe('questions des agents : passation', () => {
  it('garde le pas, l URL et la commande telles que Kova les rend', () => {
    const ask = mapAsk(
      raw({
        kind: 'handoff',
        buttons: ['Lancer', 'Fait'],
        handoff: { step: 'Lancer', url: null, run: 'aws-login', command: 'aws sso login --profile dev', label: 'AWS login', error: null },
      }),
    );
    assert.deepEqual(ask?.handoff, {
      step: 'Lancer',
      url: null,
      run: 'aws-login',
      command: 'aws sso login --profile dev',
      label: 'AWS login',
      error: null,
    });
  });

  it('un pas hors des boutons, une URL non http(s) ou un bloc absent ne passent pas', () => {
    const bad = mapAsk(raw({ buttons: ['Ouvrir', 'Fait'], handoff: { step: 'Lancer', url: 'https://x.y' } }));
    assert.equal(bad?.handoff, null);
    const js = mapAsk(raw({ buttons: ['Ouvrir', 'Fait'], handoff: { step: 'Ouvrir', url: 'javascript:alert(1)' } }));
    assert.equal(js?.handoff?.url, null);
    assert.equal(mapAsk(raw())?.handoff, null);
  });
});

describe('questions des agents : porte de diffusion', () => {
  it('la signature ignore le texte et retient l etat visible', () => {
    const a = item({ id: '1' });
    assert.equal(
      asksSignature([a], true),
      asksSignature([{ ...a, message: 'autre chose', from: 'quelqu un' }], true),
    );
    assert.notEqual(asksSignature([a], true), asksSignature([{ ...a, due: false }], true));
    assert.notEqual(asksSignature([a], true), asksSignature([a], false));
    assert.notEqual(asksSignature([a], true), asksSignature([], true));
  });

  it('a notifier : ce qui est visible maintenant et ne l etait pas', () => {
    const one = item({ id: '1' });
    const two = item({ id: '2' });
    assert.deepEqual(newlyDue([], [one]).map((a) => a.id), ['1']);
    assert.deepEqual(newlyDue([one], [one, two]).map((a) => a.id), ['2']);
    // Deja affichee : on ne renotifie pas a chaque sondage.
    assert.deepEqual(newlyDue([one], [one]), []);
    // De retour d'un report : c'est exactement ce que « notifie moi plus tard » veut dire.
    const later = item({ id: '1', due: false, snoozedUntilMs: 1 });
    assert.deepEqual(newlyDue([later], [one]).map((a) => a.id), ['1']);
    // Remise a plus tard : rien a notifier.
    assert.deepEqual(newlyDue([one], [later]), []);
  });
});

describe('questions des agents : le tableau', () => {
  it('un Kova anterieur a list-asks vaut supported:false, une seule fois', async () => {
    const { ipc } = fakeIpc([]);
    const board = new AskBoard({
      request: async () => {
        throw new IpcError('IPC_UNSUPPORTED', 'unknown command: list-asks');
      },
    } as never);
    void ipc;
    const first = await board.refresh();
    assert.equal(first.changed, true);
    assert.equal(board.snapshot().supported, false);
    // Le sondage suivant ne rediffuse pas la meme mauvaise nouvelle.
    assert.equal((await board.refresh()).changed, false);
  });

  it('un unknown command RESOLU (et non rejete) vaut aussi supported:false', async () => {
    // `KovaIpc.request` resout une reponse `ok:false` au lieu de la rejeter : c'est par
    // la que passe un vrai Kova trop ancien, et le traiter comme une panne laissait
    // `supported` a vrai pour toujours.
    const board = new AskBoard({
      request: async () => ({ ok: false, error: 'unknown command: list-asks' }),
    } as never);
    assert.equal((await board.refresh()).changed, true);
    assert.equal(board.snapshot().supported, false);
  });

  it('une coupure de Kova ne change rien : la liste tient jusqu au retour', async () => {
    const board = new AskBoard({
      request: async () => {
        throw new IpcError('IPC_TIMEOUT', 'kova down');
      },
    } as never);
    assert.deepEqual(await board.refresh(), { changed: false, appeared: [] });
    assert.equal(board.snapshot().supported, true);
  });

  it('lit la liste, les delais, et ne rediffuse pas une liste inchangee', async () => {
    const data = { asks: [raw()], snooze_choices: [{ label: '5 min', seconds: 300 }] };
    const board = new AskBoard({ request: async () => ({ ok: true, data }) } as never);
    const first = await board.refresh();
    assert.equal(first.changed, true);
    assert.equal(first.appeared.length, 1);
    assert.deepEqual(board.snapshot().snoozeChoices, [{ label: '5 min', seconds: 300 }]);
    const second = await board.refresh();
    assert.equal(second.changed, false);
    assert.equal(second.appeared.length, 0);
  });

  it('repondre exige un bouton de CETTE question, au caractere pres', async () => {
    const { ipc, seen } = fakeIpc([
      { ok: true, data: { asks: [raw()] } },
      { ok: true },
      { ok: true, data: { asks: [] } },
    ]);
    const board = new AskBoard(ipc);
    await board.refresh();
    const id = raw()['id'] as string;
    await assert.rejects(() => board.answer(id, 'ok', ''), AskError);
    await assert.rejects(() => board.answer(id, 'OK; rm -rf /', ''), AskError);
    await assert.rejects(() => board.answer(id, undefined, ''), AskError);
    await assert.rejects(() => board.answer(id, 'OK', 'x'.repeat(8 * 1024 + 1)), AskError);
    await assert.rejects(() => board.answer('6f1c0000-0000-4000-8000-00000000ffff', 'OK', ''), AskError);
    // `Other` n'est une reponse que s'il porte une consigne (le Brief).
    await assert.rejects(() => board.answer(id, 'Other', ''), AskError);
    await assert.rejects(() => board.answer(id, 'Other', '   '), AskError);
    // Aucun refus n'a atteint Kova : seule la lecture initiale est passee.
    assert.deepEqual(seen.map((r) => r['cmd']), ['list-asks']);
    await board.answer(id, 'OK', 'coupe le dernier paragraphe');
    assert.deepEqual(seen[1], {
      cmd: 'answer-ask',
      id,
      action: 'OK',
      text: 'coupe le dernier paragraphe',
    });
    // La carte est relue tout de suite : la question doit disparaitre des autres ecrans.
    assert.equal(seen[2]?.['cmd'], 'list-asks');
    assert.equal(board.snapshot().asks.length, 0);
  });

  it('remettre a plus tard : un delai positif, et l heure de retour de Kova', async () => {
    const { ipc, seen } = fakeIpc([
      { ok: true, data: { asks: [raw()] } },
      { ok: true, data: { snoozed_until: 1_792_001_800 } },
      { ok: true, data: { asks: [raw({ due: false, snoozed_until: 1_792_001_800 })] } },
    ]);
    const board = new AskBoard(ipc);
    await board.refresh();
    const id = raw()['id'] as string;
    await assert.rejects(() => board.snooze(id, 0), AskError);
    await assert.rejects(() => board.snooze(id, -5), AskError);
    await assert.rejects(() => board.snooze(id, '30m' as never), AskError);
    const until = await board.snooze(id, 1800);
    assert.equal(until, 1_792_001_800_000);
    assert.deepEqual(seen[1], { cmd: 'snooze-ask', id, seconds: 1800 });
    assert.equal(board.snapshot().asks[0]?.due, false);
  });

  it('un Kova trop ancien refuse les deux gestes avec sa propre cause', async () => {
    const board = new AskBoard({
      request: async () => {
        throw new IpcError('IPC_UNSUPPORTED', 'unknown command: list-asks');
      },
    } as never);
    await board.refresh();
    await assert.rejects(() => board.answer('x', 'OK', ''), (e: Error) => {
      assert.ok(e instanceof AskError);
      assert.equal((e as InstanceType<typeof AskError>).code, 'KOVA_TOO_OLD');
      return true;
    });
  });

  it('Kova disparu : la liste est videe et la signature remise a zero', async () => {
    const data = { asks: [raw()] };
    const board = new AskBoard({ request: async () => ({ ok: true, data }) } as never);
    await board.refresh();
    assert.equal(board.snapshot().asks.length, 1);
    board.reset();
    assert.equal(board.snapshot().asks.length, 0);
    // Sans la remise a zero de la signature, cette relecture ne rediffuserait rien.
    assert.equal((await board.refresh()).changed, true);
  });
});
