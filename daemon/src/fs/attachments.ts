import { lstatSync, mkdirSync } from 'node:fs';
import { ATTACHMENTS_ROOT, attachmentsSessionOf } from '@kovalink/protocol';
import { FsError, normalizeRequestPath } from './resolve.js';

/**
 * Dossier des pieces jointes d'une session de chat (docs/15).
 *
 * C'est la SEULE creation de dossier du daemon, et elle ne porte que sur
 * `<ATTACHMENTS_ROOT>/<session>` : la racine seule, un niveau de plus, une traversee ou
 * tout autre chemin rendent `null` et passent par `resolveForWrite` comme n'importe
 * quelle destination, qui refuse un dossier absent. Ce n'est pas une route `mkdir`
 * (PRD section 6) : l'app ne choisit pas le chemin, le protocole le fixe.
 *
 * Droits 0700 sur la racine et sur le dossier de session : une piece envoyee depuis
 * l'iPhone n'est lisible que par Robin, comme le `.part` qui l'a precedee. `/tmp` est
 * commun a tous les comptes du Mac, d'ou la verification que chaque niveau est bien un
 * dossier reel a nous, et pas un lien pose par un autre compte avant nous.
 */
export function ensureAttachmentsDir(rawDir: unknown): string | null {
  const dir = normalizeRequestPath(rawDir);
  const session = attachmentsSessionOf(dir);
  if (!session) return null;

  for (const level of [ATTACHMENTS_ROOT, dir]) {
    try {
      mkdirSync(level, { recursive: true, mode: 0o700 });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      throw new FsError(
        'IO_ERROR',
        500,
        `creation de ${level} impossible : ${err.code ?? 'erreur'}${err.message ? ` (${err.message})` : ''}`,
        level,
      );
    }
    const st = lstatSync(level);
    if (!st.isDirectory()) {
      throw new FsError(
        'PATH_DENIED',
        403,
        `${level} existe mais n est pas un dossier reel : le daemon n ecrit pas au travers.`,
        level,
      );
    }
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) {
      throw new FsError(
        'PATH_DENIED',
        403,
        `${level} appartient a un autre compte (uid ${st.uid}) : le daemon ne s y installe pas.`,
        level,
      );
    }
  }
  return dir;
}
