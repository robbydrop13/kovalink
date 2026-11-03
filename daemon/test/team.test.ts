// Equipe d'agents : `team list --json` est la seule source, et l'argv de reouverture
// qu'il rend ne doit jamais fuiter ni etre devine. Ces tests fixent les trois
// proprietes : la projection des champs, le refus sans execution, et l'argv exact.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Exec, ExecResult } from '../src/routines.js';
import { TeamError, getRoster, reopenAgent } from '../src/team.js';

/** Reponses brutes de `team list --json` : noms et champs tels qu'il les ecrit. */
const RAW = {
  managers: [
    {
      name: 'claap-agent',
      role: 'chief-of-staff',
      tab: 'Claap',
      state: 'working',
      reopen: ['team', 'reopen', 'claap-agent'],
    },
    {
      name: 'perso-agent',
      role: 'chief-of-staff',
      tab: 'Perso',
      state: 'closed',
      reopen: ['team', 'reopen', 'perso-agent'],
    },
  ],
  dedicated: [
    {
      name: 'byok',
      role: 'product-manager',
      by: 'Robin',
      project: 'byok',
      created: '2026-10-01T09:00:00',
      state: 'closed',
      reopen: ['team', 'reopen', 'byok'],
    },
    {
      name: 'ds-tokens',
      role: 'claap-developer',
      by: 'Robin',
      state: 'open',
      reopen: ['team', 'reopen', 'ds-tokens'],
    },
  ],
  other_open: ['scratch'],
};

/** Faux `team` : enregistre les argv, rend `list` puis les reponses forcees. */
function fake(
  raw: unknown = RAW,
  forced: (argv: string[]) => ExecResult | undefined = () => undefined,
): { calls: string[][]; exec: Exec } {
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

describe('getRoster', () => {
  it('lit list --json et projette managers, sessions dediees et autres ouvertes', async () => {
    const h = fake();
    assert.deepEqual(await getRoster(h.exec), {
      managers: [
        { name: 'claap-agent', role: 'chief-of-staff', tab: 'Claap', state: 'working' },
        { name: 'perso-agent', role: 'chief-of-staff', tab: 'Perso', state: 'closed' },
      ],
      dedicated: [
        {
          name: 'byok',
          role: 'product-manager',
          by: 'Robin',
          project: 'byok',
          created: '2026-10-01T09:00:00',
          state: 'closed',
        },
        { name: 'ds-tokens', role: 'claap-developer', by: 'Robin', state: 'open' },
      ],
      otherOpen: ['scratch'],
    });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('ne laisse sortir ni l argv de reouverture, ni un chemin du Mac', async () => {
    const wire = JSON.stringify(await getRoster(fake().exec));
    for (const leaked of ['reopen', 'argv', 'team', '/Users/', 'AI directory']) {
      assert.equal(wire.includes(leaked), false, `« ${leaked} » est dans la reponse`);
    }
  });

  it('ignore une entree sans nom valide ou sans etat connu', async () => {
    const h = fake({
      managers: [
        { name: '../evil', role: 'x', state: 'open' },
        { name: 'ok', role: 'r', state: 'busy' },
      ],
      dedicated: [],
      other_open: [],
    });
    assert.deepEqual((await getRoster(h.exec)).managers, []);
  });

  it('un team list en echec leve team_failed', async () => {
    const h = fake(RAW, (argv) =>
      argv[0] === 'list' ? { code: 1, stdout: '', stderr: 'boom' } : undefined,
    );
    await assert.rejects(
      getRoster(h.exec),
      (e: unknown) => e instanceof TeamError && e.reason === 'team_failed',
    );
  });

  it('une sortie illisible ou sans tableaux leve team_failed', async () => {
    for (const stdout of ['not json', '{}', '[]']) {
      const h = fake(RAW, (argv) =>
        argv[0] === 'list' ? { code: 0, stdout, stderr: '' } : undefined,
      );
      await assert.rejects(
        getRoster(h.exec),
        (e: unknown) => e instanceof TeamError && e.reason === 'team_failed',
      );
    }
  });
});

describe('reopenAgent', () => {
  for (const name of ['', 'A', 'A1', 'a_b', 'a b', 'a/b', '../x', '-a']) {
    it(`refuse le nom ${JSON.stringify(name)} sans appeler team`, async () => {
      const h = fake();
      assert.deepEqual(await reopenAgent(h.exec, name), {
        applied: false,
        reason: 'unknown_agent',
      });
      assert.deepEqual(h.calls, []);
    });
  }

  it('refuse un nom absent du roster, sans geste', async () => {
    const h = fake();
    assert.deepEqual(await reopenAgent(h.exec, 'nope'), {
      applied: false,
      reason: 'unknown_agent',
    });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('ne rouvre jamais une session au travail', async () => {
    const h = fake();
    assert.deepEqual(await reopenAgent(h.exec, 'claap-agent'), {
      applied: false,
      reason: 'not_closed',
    });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('ne rouvre jamais une session ouverte', async () => {
    const h = fake();
    assert.deepEqual(await reopenAgent(h.exec, 'ds-tokens'), {
      applied: false,
      reason: 'not_closed',
    });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('rouvre une session fermee avec exactement l argv donne par le roster', async () => {
    const h = fake();
    assert.deepEqual(await reopenAgent(h.exec, 'byok'), { applied: true });
    assert.deepEqual(h.calls, [['list', '--json'], ['reopen', 'byok']]);
  });

  it('rouvre aussi un manager ferme, programme retire', async () => {
    const h = fake();
    assert.deepEqual(await reopenAgent(h.exec, 'perso-agent'), { applied: true });
    assert.deepEqual(h.calls, [['list', '--json'], ['reopen', 'perso-agent']]);
  });

  it('un roster sans argv pour cette session rend team_failed, sans commande devinee', async () => {
    const h = fake({
      managers: [],
      dedicated: [{ name: 'byok', role: 'product-manager', state: 'closed' }],
      other_open: [],
    });
    assert.deepEqual(await reopenAgent(h.exec, 'byok'), {
      applied: false,
      reason: 'team_failed',
    });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('un argv qui ne vise pas reopen <name> ne fait rien tourner', async () => {
    const h = fake({
      managers: [],
      dedicated: [
        { name: 'byok', role: 'r', state: 'closed', reopen: ['team', 'spawn', 'byok'] },
      ],
      other_open: [],
    });
    assert.deepEqual(await reopenAgent(h.exec, 'byok'), {
      applied: false,
      reason: 'team_failed',
    });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('un team list en echec rend team_failed, jamais un geste aveugle', async () => {
    const h = fake(RAW, (argv) =>
      argv[0] === 'list' ? { code: 1, stdout: '', stderr: 'boom' } : undefined,
    );
    assert.deepEqual(await reopenAgent(h.exec, 'byok'), {
      applied: false,
      reason: 'team_failed',
    });
    assert.deepEqual(h.calls, [['list', '--json']]);
  });

  it('un reopen qui sort en code non nul rend team_failed', async () => {
    const h = fake(RAW, (argv) =>
      argv[0] === 'reopen' ? { code: 2, stdout: '', stderr: 'refus' } : undefined,
    );
    assert.deepEqual(await reopenAgent(h.exec, 'byok'), {
      applied: false,
      reason: 'team_failed',
    });
  });

  it('malgre le code non nul, la reponse ne porte jamais la sortie de team', async () => {
    const h = fake(RAW, (argv) =>
      argv[0] === 'reopen'
        ? {
            code: 2,
            stdout: '',
            stderr: '/Users/robin/AI directory/claude-config/team/registry.json',
          }
        : undefined,
    );
    const res = JSON.stringify(await reopenAgent(h.exec, 'byok'));
    assert.equal(res.includes('/Users/robin'), false);
  });
});
