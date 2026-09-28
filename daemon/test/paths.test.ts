import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const PROJECTS = mkdtempSync(join(tmpdir(), 'kovalink-projects-'));
process.env['KOVALINK_HOME'] = mkdtempSync(join(tmpdir(), 'kovalink-paths-'));
process.env['KOVALINK_CLAUDE_PROJECTS'] = PROJECTS;
process.env['KOVALINK_QUIET'] = '1';

const { projectSlug, transcriptPath } = await import('../src/paths.js');

/** Ecrit un transcript dans le dossier de projet de `cwd` et rend son chemin. */
function plant(cwd: string, sessionId: string): string {
  const dir = join(PROJECTS, projectSlug(cwd));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, '{}\n');
  return path;
}

const HERE = '/Users/robin/AI directory/Claap/Product/personal-tools/kova';
const BEFORE_THE_MOVE = '/Users/robin/AI directory/Claap/Product/kova';

describe('transcriptPath', () => {
  it('prend le dossier slugifie du cwd quand le transcript y est', () => {
    const expected = plant(HERE, 'aaaaaaaa-0000-0000-0000-000000000001');
    assert.equal(transcriptPath(HERE, 'aaaaaaaa-0000-0000-0000-000000000001'), expected);
  });

  it('retrouve le transcript reste dans le dossier du chemin precedent', () => {
    // Le repo a demenage en cours de session : Claude Code ecrit toujours dans le
    // dossier ouvert au demarrage, le cwd du pane slugifie desormais ailleurs.
    const expected = plant(BEFORE_THE_MOVE, 'aaaaaaaa-0000-0000-0000-000000000002');
    assert.equal(transcriptPath(HERE, 'aaaaaaaa-0000-0000-0000-000000000002'), expected);
  });

  it("rend le chemin slugifie d'une session dont le transcript n'est pas encore ne", () => {
    // Le tailer sonde ce chemin jusqu'a la naissance du fichier : ne pas le devier.
    assert.equal(
      transcriptPath(HERE, 'aaaaaaaa-0000-0000-0000-000000000003'),
      join(PROJECTS, projectSlug(HERE), 'aaaaaaaa-0000-0000-0000-000000000003.jsonl'),
    );
  });
});
