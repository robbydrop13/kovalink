// Composition du message avec pièces jointes (docs/15, points 3 et 4) : texte puis un
// chemin par ligne, dans l'ordre, et REFUS si une pièce n'est pas arrivée sur le Mac.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTACHMENTS_ROOT, attachmentsDir } from '@kovalink/protocol';
import {
  composeMessage,
  displayNameOf,
  isImageMime,
  mimeOfName,
  splitAttachmentLines,
  totalSize,
  type Attachment,
} from '@/features/chat/attachments';
import { withoutEchoed, type PendingMessage } from '@/store/session';
import type { Turn } from '@kovalink/protocol';

const DIR = attachmentsDir('2b1f5c3e-7a9d-4e6b-9c1a-0f8d7e6c5b4a');

function piece(partial: Partial<Attachment> & { id: string }): Attachment {
  return {
    uri: `file:///tmp/${partial.id}.jpg`,
    name: `${partial.id}.jpg`,
    size: 1000,
    mime: 'image/jpeg',
    path: `${DIR}/20260911-153012-${partial.id}.jpg`,
    ...partial,
  };
}

describe('composeMessage', () => {
  it("reproduit l'exemple de la spec : le texte, puis le chemin absolu sur sa ligne", () => {
    const out = composeMessage('voici la maquette, adapte la barre du haut', [
      piece({ id: 'IMG_4231', path: `${DIR}/20260911-153012-IMG_4231.jpg` }),
    ]);
    assert.equal(
      out,
      'voici la maquette, adapte la barre du haut\n' +
        `${ATTACHMENTS_ROOT}/2b1f5c3e/20260911-153012-IMG_4231.jpg`,
    );
  });

  it("garde l'ordre de la sélection, une ligne par pièce, sans préfixe ni libellé", () => {
    const out = composeMessage('regarde', [piece({ id: 'b' }), piece({ id: 'a' }), piece({ id: 'c' })]);
    assert.deepEqual(out.split('\n'), [
      'regarde',
      `${DIR}/20260911-153012-b.jpg`,
      `${DIR}/20260911-153012-a.jpg`,
      `${DIR}/20260911-153012-c.jpg`,
    ]);
  });

  it('sans texte, le message est la liste des chemins seule, sans ligne vide en tête', () => {
    assert.equal(composeMessage('   ', [piece({ id: 'a' })]), `${DIR}/20260911-153012-a.jpg`);
  });

  it('sans pièce, le message est le texte tel quel : rien ne change pour un envoi ordinaire', () => {
    assert.equal(composeMessage('  bonjour  ', []), 'bonjour');
  });

  it("REFUSE si une pièce n'a pas de chemin : rien ne part, la cause nomme la pièce", () => {
    assert.throws(
      () => composeMessage('texte', [piece({ id: 'a' }), piece({ id: 'b', path: null })]),
      (e: unknown) => e instanceof Error && e.message.includes('b.jpg') && e.message.includes('pas arrivée'),
    );
    assert.throws(
      () => composeMessage('texte', [piece({ id: 'a', path: null }), piece({ id: 'b', path: '' })]),
      (e: unknown) => e instanceof Error && e.message.includes('2 pièces'),
    );
  });
});

describe('splitAttachmentLines', () => {
  it('détache les chemins de fin de message et rend le texte seul', () => {
    const { text, paths } = splitAttachmentLines(
      `voici la maquette\n${DIR}/20260911-153012-a.jpg\n${DIR}/20260911-153012-b.pdf\n`,
    );
    assert.equal(text, 'voici la maquette');
    assert.deepEqual(paths, [`${DIR}/20260911-153012-a.jpg`, `${DIR}/20260911-153012-b.pdf`]);
  });

  it("ne touche pas un chemin cité AU MILIEU du texte, ni un chemin d'un autre dossier", () => {
    const msg = `lis ${DIR}/x.png puis dis moi\n/tmp/kova-paste-1.png`;
    const { text, paths } = splitAttachmentLines(msg);
    assert.equal(text, msg);
    assert.deepEqual(paths, []);
  });

  it("reconnaît la réécriture RÉELLE de Claude Code pour une image (mesurée sur un pane jetable)", () => {
    // Transcript JSONL du 11 septembre 2026, Claude Code v2.1.268 : le chemin collé devient
    // un bloc `image`, le texte reçoit `[Image #1]` en tête, et un bloc texte
    // `[Image: source: …]` suit. Le daemon joint les blocs texte par une ligne vide.
    const echo =
      '[Image #1]Regarde cette image et reponds en une ligne : quel est le mot de passe ?\n\n' +
      `[Image: source: ${DIR}/20260911-151312-IMG_4231.jpg]`;
    const { text, paths } = splitAttachmentLines(echo);
    assert.equal(text, 'Regarde cette image et reponds en une ligne : quel est le mot de passe ?');
    assert.deepEqual(paths, [`${DIR}/20260911-151312-IMG_4231.jpg`]);
  });

  it('deux images réécrites, dans l’ordre, et un texte vide reste vide', () => {
    const echo = `[Image #1][Image #2]\n\n[Image: source: ${DIR}/a.jpg]\n\n[Image: source: ${DIR}/b.jpg]`;
    assert.deepEqual(splitAttachmentLines(echo), { text: '', paths: [`${DIR}/a.jpg`, `${DIR}/b.jpg`] });
  });

  it('un message sans pièce revient inchangé', () => {
    assert.deepEqual(splitAttachmentLines('bonjour'), { text: 'bonjour', paths: [] });
  });

  it('est la réciproque de composeMessage', () => {
    const pieces = [piece({ id: 'a' }), piece({ id: 'b' })];
    const { text, paths } = splitAttachmentLines(composeMessage('ok', pieces));
    assert.equal(text, 'ok');
    assert.deepEqual(
      paths,
      pieces.map((p) => p.path),
    );
  });
});

describe('affichage', () => {
  it("retire le dossier et l'horodatage du nom affiché", () => {
    assert.equal(displayNameOf(`${DIR}/20260911-153012-IMG_4231.jpg`), 'IMG_4231.jpg');
    assert.equal(displayNameOf(`${DIR}/rapport.pdf`), 'rapport.pdf');
  });

  it('reconnaît une image par la table MIME partagée', () => {
    assert.equal(isImageMime(mimeOfName('photo.HEIC')), true);
    assert.equal(isImageMime(mimeOfName('rapport.pdf')), false);
    assert.equal(mimeOfName('sans-extension'), null);
  });

  it('somme les tailles pour le seuil cellulaire', () => {
    assert.equal(totalSize([piece({ id: 'a', size: 10 }), piece({ id: 'b', size: 32 })]), 42);
  });
});

describe("l'écho d'un message avec pièces", () => {
  function turn(text: string, seq: number): Turn {
    return {
      id: `t${seq}`,
      kind: 'user',
      ts: '2026-09-11T15:30:12.000Z',
      seq,
      uuids: [],
      blocks: [{ type: 'text', text }],
      isSidechain: false,
    };
  }
  const pendingWithPieces: PendingMessage = {
    nonce: 'n1',
    text: 'voici la maquette',
    state: 'sent',
    ts: '2026-09-11T15:30:12.000Z',
    afterSeq: 4,
    sessionId: 's1',
    attachments: [piece({ id: 'a' })],
  };

  it('fait disparaître la bulle locale quand le transcript rend le texte SUIVI des chemins', () => {
    const echo = turn(`voici la maquette\n${DIR}/20260911-153012-a.jpg`, 5);
    assert.deepEqual(withoutEchoed([pendingWithPieces], [echo], 's1'), []);
  });

  it('la fait disparaître aussi sous la forme réécrite par Claude Code pour une image', () => {
    const echo = turn(`[Image #1]voici la maquette\n\n[Image: source: ${DIR}/20260911-153012-a.jpg]`, 5);
    assert.deepEqual(withoutEchoed([pendingWithPieces], [echo], 's1'), []);
  });

  it("ne confond pas avec un tour au même texte sans pièce, ni avec d'autres chemins", () => {
    assert.equal(withoutEchoed([pendingWithPieces], [turn('voici la maquette', 5)], 's1').length, 1);
    assert.equal(
      withoutEchoed([pendingWithPieces], [turn(`voici la maquette\n${DIR}/autre.jpg`, 5)], 's1').length,
      1,
    );
  });
});
