// Routines locales : le daemon ne fait que passer un argv a `routinectl`. Ce qui compte
// ici : la liste ne fuit aucun chemin, les gestes envoient exactement la bonne commande,
// et un nom douteux ne part jamais vers le processus.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RoutineError,
  listRoutines,
  pauseRoutine,
  resumeRoutine,
  routineLog,
  runRoutine,
  type Exec,
  type ExecResult,
} from '../src/routines.js';

/** Reponses brutes de `routinectl list --json` : noms et champs tels qu'il les ecrit. */
const RAW = [
  {
    name: 'tri-inbox',
    schedule: 'daily 08:07',
    schedule_words: 'daily at 08:07',
    enabled: true,
    done: false,
    active: true,
    manual: false,
    loaded: true,
    running: false,
    next_run: '2026-11-04T08:07:00',
    last: { start: '2026-11-03T08:07:00', end: '2026-11-03T08:09:12', code: 0 },
    cwd: '/Users/robin/AI directory/Perso',
    prompt: '/Users/robin/.claude/routines/prompts/tri-inbox.md',
    log: '/Users/robin/.claude/routines/logs/tri-inbox.log',
    description: 'Trie mes mails',
  },
  {
    name: 'weekday-brief',
    schedule: 'daily 07:30',
    schedule_words: 'weekdays at 07:30',
    enabled: false,
    done: false,
    active: false,
    manual: false,
    loaded: false,
    running: true,
    next_run: null,
    last: null,
    cwd: '/Users/robin/AI directory/Claap',
    prompt: '/Users/robin/.claude/routines/prompts/weekday-brief.md',
    log: '/Users/robin/.claude/routines/logs/weekday-brief.log',
    description: 'Brief du matin',
  },
  {
    name: 'once-popup',
    schedule: 'once 2026-10-01 09:00',
    schedule_words: 'once on 2026-10-01 at 09:00',
    enabled: true,
    done: true,
    active: false,
    manual: false,
    loaded: false,
    running: false,
    next_run: null,
    last: { start: '2026-10-01T09:00:00', end: '2026-10-01T09:01:00', code: 0 },
    cwd: '/Users/robin/AI directory/Claap',
    prompt: '/Users/robin/.claude/routines/prompts/once-popup.md',
    log: '/Users/robin/.claude/routines/logs/once-popup.log',
    description: 'Une seule fois',
  },
];

/** Faux `routinectl` : enregistre les argv, rend `list` puis les reponses forcees. */
function fake(raw: unknown[] = RAW, forced: (argv: string[]) => ExecResult | undefined = () => undefined) {
  const calls: string[][] = [];
  const exec: Exec = async (argv) => {
    calls.push(argv);
    const answer = forced(argv);
    if (answer) return answer;
    if (argv[0] === 'list') return { code: 0, stdout: JSON.stringify(raw), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, exec };
}

describe('listRoutines', () => {
  it('lit list --json, passe les champs en camelCase et filtre les routines done', async () => {
    const h = fake();
    const body = await listRoutines(h.exec);
    assert.deepEqual(h.calls, [['list', '--json']]);
    assert.deepEqual(body, {
      routines: [
        {
          name: 'tri-inbox',
          schedule: 'daily 08:07',
          scheduleWords: 'daily at 08:07',
          enabled: true,
          done: false,
          active: true,
          manual: false,
          loaded: true,
          running: false,
          nextRun: '2026-11-04T08:07:00',
          last: { start: '2026-11-03T08:07:00', end: '2026-11-03T08:09:12', code: 0 },
          description: 'Trie mes mails',
        },
        {
          name: 'weekday-brief',
          schedule: 'daily 07:30',
          scheduleWords: 'weekdays at 07:30',
          enabled: false,
          done: false,
          active: false,
          manual: false,
          loaded: false,
          running: true,
          nextRun: null,
          last: null,
          description: 'Brief du matin',
        },
      ],
    });
  });

  it('ne laisse sortir aucun chemin du Mac', async () => {
    const body = await listRoutines(fake().exec);
    const wire = JSON.stringify(body);
    for (const leaked of ['/Users/', 'routines/prompts', 'routines/logs', '.md', '.log']) {
      assert.equal(wire.includes(leaked), false, `« ${leaked} » est dans la reponse`);
    }
  });

  it('un last incomplet vaut null plutot qu un passage a moitie lu', async () => {
    const h = fake([{ name: 'tri-inbox', last: { start: '2026-11-03T08:07:00' } }]);
    assert.deepEqual((await listRoutines(h.exec)).routines[0]?.last, null);
  });

  it('une entree sans nom valide est ignoree', async () => {
    const h = fake([{ name: '../evil', schedule: 'daily 08:07' }, { name: 'tri-inbox' }]);
    assert.deepEqual(
      (await listRoutines(h.exec)).routines.map((r) => r.name),
      ['tri-inbox'],
    );
  });

  it('un routinectl en echec leve routinectl_failed', async () => {
    const h = fake(RAW, (argv) => (argv[0] === 'list' ? { code: 1, stdout: '', stderr: 'boom' } : undefined));
    await assert.rejects(
      listRoutines(h.exec),
      (e: unknown) => e instanceof RoutineError && e.reason === 'routinectl_failed',
    );
  });

  it('une sortie illisible leve routinectl_failed plutot que de rendre une liste vide', async () => {
    const h = fake(RAW, (argv) => (argv[0] === 'list' ? { code: 0, stdout: 'not json', stderr: '' } : undefined));
    await assert.rejects(
      listRoutines(h.exec),
      (e: unknown) => e instanceof RoutineError && e.reason === 'routinectl_failed',
    );
  });
});

describe('les trois gestes', () => {
  it('run envoie exactement [run, nom], apres avoir relu la liste', async () => {
    const h = fake();
    assert.deepEqual(await runRoutine(h.exec, 'tri-inbox'), { applied: true });
    assert.deepEqual(h.calls, [['list', '--json'], ['run', 'tri-inbox']]);
  });

  it('pause envoie disable, resume envoie enable', async () => {
    const pause = fake();
    assert.deepEqual(await pauseRoutine(pause.exec, 'tri-inbox'), { applied: true });
    assert.deepEqual(pause.calls, [['list', '--json'], ['disable', 'tri-inbox']]);
    const resume = fake();
    assert.deepEqual(await resumeRoutine(resume.exec, 'tri-inbox'), { applied: true });
    assert.deepEqual(resume.calls, [['list', '--json'], ['enable', 'tri-inbox']]);
  });

  for (const name of ['', 'A', 'Tri-Inbox', '../x', 'a/b', 'a_b', '-x', 'a b']) {
    it(`refuse le nom ${JSON.stringify(name)} sans appeler routinectl`, async () => {
      const h = fake();
      for (const call of [runRoutine, pauseRoutine, resumeRoutine]) {
        assert.deepEqual(await call(h.exec, name), { applied: false, reason: 'unknown_routine' });
      }
      assert.deepEqual(h.calls, []);
    });
  }

  it('refuse un nom absent de la liste, sans geste', async () => {
    const h = fake();
    assert.deepEqual(await runRoutine(h.exec, 'nope'), { applied: false, reason: 'unknown_routine' });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('un echec de list rend routinectl_failed, jamais un geste aveugle', async () => {
    const h = fake(RAW, (argv) => (argv[0] === 'list' ? { code: 1, stdout: '', stderr: 'boom' } : undefined));
    assert.deepEqual(await runRoutine(h.exec, 'tri-inbox'), { applied: false, reason: 'routinectl_failed' });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('un geste qui sort en code non nul rend routinectl_failed', async () => {
    const h = fake(RAW, (argv) => (argv[0] === 'run' ? { code: 2, stdout: '', stderr: 'launchctl refuse' } : undefined));
    assert.deepEqual(await runRoutine(h.exec, 'tri-inbox'), { applied: false, reason: 'routinectl_failed' });
  });

  it('malgre le code non nul, la reponse ne porte jamais la sortie de routinectl', async () => {
    const h = fake(RAW, (argv) =>
      argv[0] === 'run' ? { code: 2, stdout: '', stderr: '/Users/robin/.claude/routines/prompts/x.md' } : undefined,
    );
    const res = JSON.stringify(await runRoutine(h.exec, 'tri-inbox'));
    assert.equal(res.includes('/Users/robin'), false);
  });
});

describe('routineLog', () => {
  const LINES = Array.from({ length: 250 }, (_, i) => `ligne ${i + 1}`).join('\n');

  it('rend au plus 200 lignes, les dernieres, sans ligne vide de fin', async () => {
    const h = fake(RAW, (argv) => (argv[0] === 'logs' ? { code: 0, stdout: `${LINES}\n`, stderr: '' } : undefined));
    const body = await routineLog(h.exec, 'tri-inbox');
    assert.equal(body.lines.length, 200);
    assert.equal(body.lines[0], 'ligne 51');
    assert.equal(body.lines[199], 'ligne 250');
    assert.deepEqual(h.calls, [['list', '--json'], ['logs', 'tri-inbox', '-n', '200']]);
  });

  it('un journal deja plus court est rendu tel quel', async () => {
    const h = fake(RAW, (argv) => (argv[0] === 'logs' ? { code: 0, stdout: 'a\nb\nc\n', stderr: '' } : undefined));
    assert.deepEqual(await routineLog(h.exec, 'tri-inbox'), { lines: ['a', 'b', 'c'] });
  });

  it('un nom inconnu leve unknown_routine sans lire le journal', async () => {
    const h = fake();
    await assert.rejects(
      routineLog(h.exec, 'nope'),
      (e: unknown) => e instanceof RoutineError && e.reason === 'unknown_routine',
    );
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('un routinectl logs en echec leve routinectl_failed', async () => {
    const h = fake(RAW, (argv) => (argv[0] === 'logs' ? { code: 1, stdout: '', stderr: 'boom' } : undefined));
    await assert.rejects(
      routineLog(h.exec, 'tri-inbox'),
      (e: unknown) => e instanceof RoutineError && e.reason === 'routinectl_failed',
    );
  });
});
