// La fixture de Kova est la declaration partagee de l'ordre de `needItems` et du
// compte de `waitsOnYou`. Elle est copiee VERBATIM : un cas ajoute cote Rust doit
// arriver ici sans retouche, sinon les deux implementations divergent.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { needItems, waitsOnYou, type NeedInput } from '@kovalink/protocol';

interface WaitsOnYouCase {
  name: string;
  input: NeedInput;
  expect: { waits_on_you: number; order: string[] };
}

/** La copie locale, lue par le test. */
const FIXTURE = fileURLToPath(new URL('../test/fixtures/waits_on_you.json', import.meta.url));
/**
 * L'original dans le depot de Kova. Absent sur une machine qui n'a que KovaLink. C'est le
 * worktree de Kova qui porte les cas `attention` tant qu'ils ne sont pas sur sa `main`.
 */
const KOVA_FIXTURE = '/Users/robinbonduelle/AI directory/Claap/Product/personal-tools/kova/tests/fixtures/waits_on_you.json';

const bytes = readFileSync(FIXTURE);
const cases = JSON.parse(bytes.toString('utf8')) as WaitsOnYouCase[];

describe('needs : la fixture partagee avec Kova', () => {
  it('refuse de passer avec moins de cas que Kova n en a', () => {
    // Un fichier tronque passerait a vide : le plancher est explicite.
    assert.ok(cases.length >= 8, `fixture trop courte : ${cases.length} cas`);
  });

  it('est la copie exacte de celle de Kova quand le depot est la', { skip: !existsSync(KOVA_FIXTURE) }, () => {
    assert.ok(bytes.equals(readFileSync(KOVA_FIXTURE)), 'la copie a diverge de Kova');
  });

  for (const c of cases) {
    it(c.name, () => {
      const items = needItems(c.input);
      assert.deepEqual(
        items.map((item) => item.key),
        c.expect.order,
        `${c.name} : ordre`,
      );
      assert.equal(items.length, c.expect.order.length, `${c.name} : aucun element en trop`);
      assert.equal(waitsOnYou(c.input), c.expect.waits_on_you, `${c.name} : waitsOnYou`);
    });
  }
});
