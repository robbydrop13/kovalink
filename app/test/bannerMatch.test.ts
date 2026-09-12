import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bannerBelongsTo } from '@/notifications/bannerMatch';

const pane = { id: 7, projectName: 'link', tab: 'cc' };

describe('bannerBelongsTo (CA-14)', () => {
  it('le paneId écrit par la NSE tranche, même si le reste diverge', () => {
    assert.equal(bannerBelongsTo({ paneId: 7, project: 'autre', tab: 'x', promptRef: 'r' }, pane, []), true);
    assert.equal(bannerBelongsTo({ paneId: 8, project: 'link', tab: 'cc' }, pane, []), false);
  });
  it('sinon le promptRef du prompt courant du pane', () => {
    assert.equal(bannerBelongsTo({ promptRef: 'abc' }, pane, ['abc']), true);
  });
  it('à défaut, le couple projet et onglet, ce que la bannière affiche', () => {
    assert.equal(bannerBelongsTo({ promptRef: 'zzz', project: 'link', tab: 'cc' }, pane, ['abc']), true);
    assert.equal(bannerBelongsTo({ promptRef: 'zzz', project: 'link', tab: 'autre' }, pane, ['abc']), false);
  });
  it('charge utile absente ou illisible : jamais un retrait', () => {
    assert.equal(bannerBelongsTo(null, pane, []), false);
    assert.equal(bannerBelongsTo({}, pane, []), false);
  });
});
