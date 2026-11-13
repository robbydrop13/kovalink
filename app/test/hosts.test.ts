// Registre des Macs (étape 3 du plan M1) : migration de l'installation à un Mac, nom de la
// base locale par Mac, ajout, retrait et libellé de la pastille. Le trousseau lui même n'est
// pas testé ici : `credentials.ts` ne fait qu'écrire ce que ces fonctions décident.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LEGACY_DB,
  dbNameFor,
  defaultHostName,
  hostKeys,
  linkLabelWithHost,
  migrateRegistry,
  newDbName,
  parseHosts,
  removeEntry,
  upsertHost,
  withHostInfo,
  type HostEntry,
} from '@/store/hosts';

const MBP = 'robins-mbp.tail1234.ts.net';
const M1 = 'robins-m1.tail1234.ts.net';

const primary: HostEntry = { id: MBP, name: 'MacBook', port: 7443, role: 'primary', db: LEGACY_DB };

describe('migrateRegistry', () => {
  it('le Mac déjà appairé devient le premier hôte, principal, sur la base historique', () => {
    assert.deepEqual(migrateRegistry(null, { tsDns: MBP, port: 7443 }), [
      { id: MBP, name: 'robins-mbp', port: 7443, role: 'primary', db: 'kovalink.db' },
    ]);
  });

  it('ne fait rien quand le registre existe déjà', () => {
    assert.equal(migrateRegistry([primary], { tsDns: MBP, port: 7443 }), null);
    assert.equal(migrateRegistry([], { tsDns: MBP, port: 7443 }), null);
  });

  it('ne fait rien sur un appareil jamais appairé', () => {
    assert.equal(migrateRegistry(null, null), null);
  });
});

describe('nom de la base par Mac', () => {
  it('le premier Mac garde kovalink.db : aucune migration de données', () => {
    assert.equal(newDbName(MBP, []), 'kovalink.db');
  });

  it('un Mac ajouté a sa propre base, stable et distincte', () => {
    const name = newDbName(M1, [primary]);
    assert.match(name, /^kovalink-[0-9a-f]{12}\.db$/);
    assert.equal(newDbName(M1, [primary]), name);
    assert.notEqual(newDbName('other.tail1234.ts.net', [primary]), name);
  });

  it('la base ouverte suit le Mac actif, la base historique sans registre', () => {
    const hosts = upsertHost([primary], { id: M1, name: 'M1', port: 7443 });
    assert.equal(dbNameFor(MBP, hosts), 'kovalink.db');
    assert.equal(dbNameFor(M1, hosts), hosts[1]?.db);
    assert.equal(dbNameFor(MBP, null), 'kovalink.db');
    assert.equal(dbNameFor(null, hosts), 'kovalink.db');
    assert.equal(dbNameFor('inconnu.ts.net', hosts), 'kovalink.db');
  });
});

describe('upsertHost', () => {
  it('le premier Mac est principal, les suivants secours, dans l’ordre d’ajout', () => {
    const one = upsertHost([], { id: MBP, name: 'MacBook', port: 7443 });
    const two = upsertHost(one, { id: M1, name: 'M1', port: 7443 });
    assert.deepEqual(
      two.map((h) => [h.id, h.role]),
      [
        [MBP, 'primary'],
        [M1, 'secondary'],
      ],
    );
  });

  it('un réappairage garde la place et la base du Mac', () => {
    const two = upsertHost([primary], { id: M1, name: 'M1', port: 7443 });
    const again = upsertHost(two, { id: MBP, name: 'MacBook Pro', port: 8443 });
    assert.equal(again.length, 2);
    assert.deepEqual(again[0], { ...primary, name: 'MacBook Pro', port: 8443 });
    assert.equal(again[1]?.db, two[1]?.db);
  });
});

describe('removeEntry', () => {
  const two = upsertHost([primary], { id: M1, name: 'M1', port: 7443 });

  it('retirer le Mac actif active le premier qui reste', () => {
    const r = removeEntry(two, MBP, MBP);
    assert.deepEqual(
      r.hosts.map((h) => h.id),
      [M1],
    );
    assert.equal(r.removed?.id, MBP);
    assert.equal(r.nextActive, M1);
  });

  it('retirer un autre Mac laisse l’actif en place', () => {
    assert.equal(removeEntry(two, M1, MBP).nextActive, MBP);
  });

  it('retirer le dernier Mac ne laisse aucun actif', () => {
    const r = removeEntry([primary], MBP, MBP);
    assert.deepEqual(r.hosts, []);
    assert.equal(r.nextActive, null);
  });
});

describe('parseHosts', () => {
  it('relit ce que le registre écrit', () => {
    const two = upsertHost([primary], { id: M1, name: 'M1', port: 7443 });
    assert.deepEqual(parseHosts(JSON.stringify(two)), two);
  });

  it('absent ou illisible : pas de registre', () => {
    assert.equal(parseHosts(null), null);
    assert.equal(parseHosts('{'), null);
    assert.equal(parseHosts('{"id":1}'), null);
  });

  it('ignore une entrée sans id ou sans base, et les doublons', () => {
    const raw = JSON.stringify([{ id: MBP, db: 'kovalink.db' }, { id: M1 }, { db: 'x.db' }, { id: MBP, db: 'y.db' }]);
    assert.deepEqual(parseHosts(raw), [
      { id: MBP, name: 'robins-mbp', port: 0, role: 'primary', db: 'kovalink.db' },
    ]);
  });
});

describe('withHostInfo', () => {
  it('prend le nom et le rôle annoncés par hello.ok', () => {
    assert.deepEqual(withHostInfo([primary], MBP, { name: 'Robin MBP', role: 'primary' }), [
      { ...primary, name: 'Robin MBP' },
    ]);
  });

  it('n’écrit rien quand rien ne change, ou pour un nom vide', () => {
    assert.equal(withHostInfo([primary], MBP, { name: 'MacBook', role: 'primary' }), null);
    assert.equal(withHostInfo([primary], MBP, { name: '  ', role: 'secondary' }), null);
    assert.equal(withHostInfo([primary], M1, { name: 'M1', role: 'secondary' }), null);
  });
});

describe('hostKeys et nom par défaut', () => {
  it('clés de trousseau par Mac, caractères admis par SecureStore', () => {
    assert.deepEqual(hostKeys(M1), {
      deviceId: `kl.h.${M1}.deviceId`,
      token: `kl.h.${M1}.token`,
      nseToken: `kl.h.${M1}.nseToken`,
    });
    assert.equal(hostKeys('a b/c').token, 'kl.h.a_b_c.token');
  });

  it('nom par défaut : le premier label MagicDNS', () => {
    assert.equal(defaultHostName(MBP), 'robins-mbp');
    assert.equal(defaultHostName('solo'), 'solo');
  });
});

describe('linkLabelWithHost', () => {
  it('un seul Mac : la pastille ne change pas', () => {
    assert.equal(linkLabelWithHost('Direct', 'MacBook', 1), 'Direct');
  });

  it('plusieurs Macs : le nom du Mac devant l’état, en texte', () => {
    assert.equal(linkLabelWithHost('Relayed 40 ms', 'M1', 2), 'M1 · Relayed 40 ms');
  });

  it('nom inconnu : l’état seul', () => {
    assert.equal(linkLabelWithHost('Direct', null, 2), 'Direct');
  });
});
