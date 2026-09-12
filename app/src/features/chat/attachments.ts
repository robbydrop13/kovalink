// Pièces jointes du chat (docs/15) : la partie PURE, testée sous Node.
//
// Le mécanisme est celui du collage d'image de Kova : le fichier arrive sur le Mac, et le
// message porte son chemin absolu sur une ligne à part. Rien n'est inventé, ni préfixe ni
// libellé : Claude Code reconnaît le chemin. Ce module compose ce message, le relit pour
// l'affichage, et ne touche ni au réseau ni à l'écran.
import { isAttachmentPath, mimeForName } from '@/protocol';

export interface Attachment {
  /** Identifiant local, réutilisé comme identifiant de transfert. */
  id: string;
  /** Fichier sur l'iPhone, tel que le sélecteur l'a rendu. */
  uri: string;
  /** Nom d'origine, pour la vignette. Le nom sur le Mac est horodaté au départ. */
  name: string;
  size: number;
  mime: string | null;
  /** Chemin absolu sur le Mac, connu une fois le transfert terminé et vérifié. */
  path: string | null;
}

export function isImageMime(mime: string | null): boolean {
  return mime !== null && mime.startsWith('image/');
}

/** Type MIME d'un nom de fichier local, par la table partagée du protocole. */
export function mimeOfName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return mimeForName(name, ext);
}

/**
 * Le message envoyé : le texte de Robin, puis UNE ligne par pièce, dans l'ordre de la
 * sélection, chaque ligne étant le chemin absolu sur le Mac.
 *
 * Refuse de composer si une pièce n'a pas encore de chemin : le texte ne part QUE si
 * toutes les pièces sont arrivées (docs/15, point 4). Un message avec un chemin manquant
 * ferait chercher à Claude un fichier qui n'existe pas, en silence.
 */
export function composeMessage(text: string, attachments: readonly Attachment[]): string {
  const missing = attachments.filter((a) => !a.path);
  if (missing.length > 0) {
    throw new Error(
      `${missing.length === 1 ? 'une pièce n’est pas arrivée' : `${missing.length} pièces ne sont pas arrivées`} sur le Mac : ${missing.map((a) => a.name).join(', ')}`,
    );
  }
  const lines = [text.trim(), ...attachments.map((a) => a.path as string)].filter((l) => l.length > 0);
  return lines.join('\n');
}

/**
 * Ligne `[Image: source: /chemin]` : c'est ainsi que Claude Code réécrit dans son
 * transcript un chemin d'image collé (mesuré le 11 septembre 2026, Claude Code v2.1.268,
 * sur un pane jetable). Le texte reçoit en plus un marqueur `[Image #1]` en tête, et le
 * bloc `image` lui même, en base64, n'est jamais relayé par le daemon.
 */
const IMAGE_SOURCE_LINE = /^\[Image: source: (.+)\]$/;
const IMAGE_MARKER = /\[Image #\d+\]\s*/g;

/**
 * Relecture d'un message pour l'affichage : les lignes de pièce en FIN de message sont
 * détachées, le reste est le texte. Le chemin est masqué dans la bulle, la pièce
 * s'affiche en vignette (docs/15, point 5).
 *
 * Deux formes sont reconnues, parce que les deux existent dans un transcript réel :
 * le chemin nu tel que l'app l'a envoyé (fichier non image, ou message encore local), et
 * la réécriture de Claude Code pour une image, `[Image #1]` dans le texte et
 * `[Image: source: /chemin]` en fin de message.
 */
export function splitAttachmentLines(message: string): { text: string; paths: string[] } {
  const lines = message.split('\n');
  const paths: string[] = [];
  while (lines.length > 0) {
    const last = (lines[lines.length - 1] ?? '').trim();
    if (last.length === 0) {
      lines.pop();
      continue;
    }
    const rewritten = IMAGE_SOURCE_LINE.exec(last);
    if (rewritten) {
      paths.unshift((rewritten[1] ?? '').trim());
      lines.pop();
      continue;
    }
    if (!isAttachmentPath(last)) break;
    paths.unshift(last);
    lines.pop();
  }
  const text = lines.join('\n').replace(IMAGE_MARKER, '').trim();
  return { text, paths };
}

/** Nom affiché d'une pièce déjà sur le Mac : sans le dossier, sans l'horodatage. */
export function displayNameOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/^\d{8}-\d{6}-/, '');
}

/** Somme des tailles : c'est ce que le seuil cellulaire (A4) compare. */
export function totalSize(attachments: readonly Attachment[]): number {
  return attachments.reduce((n, a) => n + a.size, 0);
}
