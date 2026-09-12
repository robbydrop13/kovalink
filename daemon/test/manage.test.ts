// Fermer, renommer, favori : les memes gestes que sur le Mac, bornes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Pane, Tab } from '@kovalink/protocol';

process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-manage-'));
process.env['KOVALINK_QUIET'] = '1';

const {
  ManageError,
  TAB_TITLE_MAX,
  closeCommandFor,
  closePane,
  renameTab,
  sanitizeTabTitle,
  setBookmark,
  readBookmarks,
  bookmarkedIds,
  sanitizeSessionName,
  renameCommand,
  SESSION_NAME_MAX,
} = await import('../src/kova/manage.js');

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const NEL = String.fromCharCode(0x85);
const COMBINING_ACUTE = String.fromCharCode(0x301);

function pane(id: number, tab: number, extra: Partial<Pane> = {}): Pane {
  return {
    id,
    window: 0,
    tab,
    tabId: null,
    cwd: '/Users/robin/dev/link',
    title: 'claude',
    focused: false,
    pid: 1,
    child_processes: [],
    is_idle: false,
    working: false,
    awaiting: false,
    awaiting_since: null,
    awaiting_seen: false,
    minimized: false,
    agent: 'claude',
    agent_session_id: null,
    agent_session_name: null,
    claude_session_id: null,
    claude_session_name: null,
    projectName: 'link',
    hasTranscript: true,
    chatCapable: true,
    permissionMode: null,
    color: null,
    liveState: 'idle',
    ...extra,
  };
}
function tab(id: number, index: number, count: number): Tab {
  return {
    id,
    window: 0,
    tab_index: index,
    title: null,
    pane_count: count,
    focused_pane_id: 0,
    active: false,
    has_bell: false,
    has_completion: false,
    has_running: false,
    color: null,
  };
}

describe('sanitizeTabTitle', () => {
  it('NFC, sans controle, espaces reduits, 60 caracteres, null pour le titre automatique', () => {
    assert.equal(sanitizeTabTitle(`  Lin${ESC}k   Mobile${NEL} `), 'Link Mobile');
    assert.equal(sanitizeTabTitle(`Recre${COMBINING_ACUTE}e`), 'Recrée');
    assert.equal(sanitizeTabTitle('x'.repeat(100))?.length, TAB_TITLE_MAX);
    assert.equal(sanitizeTabTitle(''), null);
    assert.equal(sanitizeTabTitle('   '), null);
    assert.equal(sanitizeTabTitle(null), null);
    assert.throws(() => sanitizeTabTitle(42), ManageError);
  });
});

describe('closeCommandFor', () => {
  const panes = [pane(3, 1), pane(4, 1), pane(20, 2)];
  const tabs = [tab(11, 0, 1), tab(3, 1, 2), tab(18, 2, 1)];
  it('close-tab quand le pane est seul dans son onglet, close-pane sinon', () => {
    assert.deepEqual(closeCommandFor(pane(20, 2), panes, tabs), { cmd: 'close-tab', tab_id: 18 });
    assert.deepEqual(closeCommandFor(pane(3, 1), panes, tabs), { cmd: 'close-pane', pane_id: 3 });
    // Onglet inconnu de la liste : close-pane, jamais close-tab a l'aveugle.
    assert.deepEqual(closeCommandFor(pane(99, 7), panes, tabs), { cmd: 'close-pane', pane_id: 99 });
  });
});

describe('closePane et renameTab', () => {
  function deps(panes: Pane[], tabs: Tab[], ok = true) {
    const requests: Record<string, unknown>[] = [];
    return {
      requests,
      deps: {
        ipc: {
          request: async (p: Record<string, unknown>) => {
            requests.push(p);
            return ok ? { ok: true } : { ok: false, error: 'not found' };
          },
        },
        panes: { get: (id: number) => panes.find((p) => p.id === id), all: () => panes, allTabs: () => tabs },
      },
    };
  }
  it('refuse un pane inconnu sans rien envoyer', async () => {
    const h = deps([], []);
    assert.deepEqual(await closePane(h.deps, 66, 'dev'), { applied: false, reason: 'pane_gone' });
    await assert.rejects(() => renameTab(h.deps, 66, 'x', 'dev'), ManageError);
    assert.equal(h.requests.length, 0);
  });
  it('ferme par close-tab un pane seul, et remonte le refus de Kova', async () => {
    const h = deps([pane(20, 2)], [tab(18, 2, 1)]);
    assert.deepEqual(await closePane(h.deps, 20, 'dev'), { applied: true });
    assert.deepEqual(h.requests, [{ cmd: 'close-tab', tab_id: 18 }]);
    const ko = deps([pane(20, 2)], [tab(18, 2, 1)], false);
    await assert.rejects(() => closePane(ko.deps, 20, 'dev'), ManageError);
  });
  it('renomme par set-tab-title avec le titre assaini, null pour revenir a l automatique', async () => {
    const h = deps([pane(3, 1)], [tab(3, 1, 2)]);
    assert.deepEqual(await renameTab(h.deps, 3, `  Link${BEL} Mobile `, 'dev'), { title: 'Link Mobile' });
    assert.deepEqual(await renameTab(h.deps, 3, '', 'dev'), { title: null });
    assert.deepEqual(h.requests, [
      { cmd: 'set-tab-title', pane_id: 3, title: 'Link Mobile' },
      { cmd: 'set-tab-title', pane_id: 3, title: null },
    ]);
  });
});

describe('favoris (bookmarks.json de Kova)', () => {
  const ORIGINAL = {
    items: [
      {
        agent: 'claude',
        session_id: 'd0b868c3-126a-4117-9941-ecb8f8102ad4',
        cwd: '/Users/robin/Claap/Marketing',
        label: 'company-field-marketing',
      },
    ],
  };
  const SID = 'a444aea0-10c1-4c4e-9a1d-000000000002';
  function freshFile(): string {
    const file = join(mkdtempSync(join(tmpdir(), 'kovalink-bookmarks-')), 'bookmarks.json');
    writeFileSync(file, JSON.stringify(ORIGINAL, null, 2), { mode: 0o600 });
    return file;
  }

  it('ajoute une entree au format exact de Kova, atomiquement, en gardant le mode du fichier', () => {
    const file = freshFile();
    const res = setBookmark('add', { sessionId: SID, cwd: '/Users/robin/dev/link', label: 'Application iOS Kova' }, 'dev', file);
    assert.deepEqual(res, { bookmarked: true });
    const text = readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(text), {
      items: [...ORIGINAL.items, { agent: 'claude', session_id: SID, cwd: '/Users/robin/dev/link', label: 'Application iOS Kova' }],
    });
    assert.equal(text, JSON.stringify(JSON.parse(text), null, 2), 'indentation de deux espaces, comme Kova');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(bookmarkedIds(file).has(SID), true);
  });

  it('est idempotent a l ajout, retire proprement, et refuse un identifiant mal forme', () => {
    const file = freshFile();
    setBookmark('add', { sessionId: SID, cwd: '/x', label: null }, 'dev', file);
    setBookmark('add', { sessionId: SID, cwd: '/x', label: null }, 'dev', file);
    assert.equal(readBookmarks(file).items.length, 2);
    assert.equal(readBookmarks(file).items[1]?.label, 'x', 'sans libelle : le nom du dossier');
    assert.deepEqual(setBookmark('remove', { sessionId: SID, cwd: '/x', label: null }, 'dev', file), { bookmarked: false });
    assert.deepEqual(readBookmarks(file), ORIGINAL);
    assert.throws(() => setBookmark('add', { sessionId: 'nope', cwd: '/x', label: null }, 'dev', file), ManageError);
  });

  it('un fichier absent vaut une liste vide ; un fichier corrompu n est jamais ecrase', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'kovalink-bookmarks-')), 'bookmarks.json');
    assert.deepEqual(readBookmarks(missing), { items: [] });
    setBookmark('add', { sessionId: SID, cwd: '/x', label: 'l' }, 'dev', missing);
    assert.equal(readBookmarks(missing).items.length, 1);
    const broken = freshFile();
    writeFileSync(broken, '{ pas du json');
    assert.throws(() => setBookmark('add', { sessionId: SID, cwd: '/x', label: 'l' }, 'dev', broken));
    assert.equal(readFileSync(broken, 'utf8'), '{ pas du json');
  });
});

describe('sanitizeSessionName (/rename au sens Claude)', () => {
  it('une ligne, sans controle, sans / en tete, 60 caracteres, jamais vide', () => {
    assert.equal(sanitizeSessionName(`  Link${ESC} mobile\nv2 `), 'Link mobile v2');
    assert.equal(sanitizeSessionName('/rename /clear'), 'rename /clear', 'un / en tete ne fait pas une autre commande');
    assert.equal(sanitizeSessionName('x'.repeat(100)).length, SESSION_NAME_MAX);
    assert.throws(() => sanitizeSessionName(''), ManageError);
    assert.throws(() => sanitizeSessionName('///'), ManageError);
    assert.throws(() => sanitizeSessionName(12), ManageError);
    assert.equal(renameCommand('Link mobile'), '/rename Link mobile');
  });
});
