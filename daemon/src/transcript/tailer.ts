import { EventEmitter } from 'node:events';
import { closeSync, openSync, readSync, statSync, type Stats } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { logger } from '../logger.js';
import { safeParseLine, type RawLine } from './jsonl.js';

/** Une ligne reelle monte jusqu'a 132 746 octets (V5) : la fenetre initiale est plafonnee. */
const MAX_INITIAL_BYTES = 2 * 1024 * 1024;
const HEAD_BYTES = 64;
const FIRST_CHUNK = 64 * 1024;

export interface TailState {
  path: string;
  offset: number;
  inode: number;
  /** 64 premiers octets : empreinte anti-reecriture en place. */
  head: Buffer;
  decoder: StringDecoder;
  /** Ligne partielle, conservee jusqu'a l'arrivee de son saut de ligne. */
  carry: string;
  /** Compteur d'octets lus depuis l'ouverture. Sert au test anti relecture complete. */
  bytesRead: number;
}

function readRange(path: string, start: number, end: number): Buffer {
  const length = Math.max(0, end - start);
  const buf = Buffer.allocUnsafe(length);
  if (length === 0) return buf;
  const fd = openSync(path, 'r');
  try {
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buf, got, length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    return got === length ? buf : buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

function readHead(path: string, bytes = HEAD_BYTES): Buffer {
  try {
    return readRange(path, 0, bytes);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Compare l'empreinte de tete. Un fichier plus court que `HEAD_BYTES` a l'ouverture
 * donne une empreinte courte : on compare alors le meme nombre d'octets, sinon la
 * simple croissance du fichier declencherait une fausse reouverture a chaque ligne.
 * L'empreinte est allongee des que le fichier le permet.
 */
function headMatches(state: TailState): boolean {
  if (state.head.length === 0) return true;
  const current = readHead(state.path, state.head.length);
  if (!current.equals(state.head)) return false;
  if (state.head.length < HEAD_BYTES) state.head = readHead(state.path);
  return true;
}

/**
 * Ouverture : fenetre glissante depuis la FIN, doublee jusqu'a `wantLines` lignes de
 * conversation ou `MAX_INITIAL_BYTES`. Le plafond est indispensable : avec des lignes
 * de 132 Ko, une session a tours longs finirait par relire le fichier entier, ce que
 * la specification interdit.
 */
export function openTail(path: string, wantLines = 200): { state: TailState; lines: RawLine[] } {
  const st = statSync(path);
  const state: TailState = {
    path,
    offset: st.size,
    inode: st.ino,
    head: readHead(path),
    decoder: new StringDecoder('utf8'),
    carry: '',
    bytesRead: 0,
  };

  let chunk = FIRST_CHUNK;
  let lines: RawLine[] = [];
  while (true) {
    const start = Math.max(0, st.size - chunk);
    const buf = readRange(path, start, st.size);
    state.bytesRead = buf.length;
    let text = buf.toString('utf8');
    // Fenetre partielle : la premiere ligne est probablement coupee, on la jette.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    lines = text
      .split('\n')
      .map(safeParseLine)
      .filter((l): l is RawLine => l !== null);
    const conv = lines.filter((l) => l.type === 'user' || l.type === 'assistant').length;
    if (start === 0 || conv >= wantLines || chunk >= MAX_INITIAL_BYTES) break;
    chunk = Math.min(chunk * 2, MAX_INITIAL_BYTES);
  }
  return { state, lines };
}

export interface ReadResult {
  lines: RawLine[];
  /** Vrai quand le fichier a ete reouvert : le client doit remplacer, pas fusionner. */
  reopened: boolean;
}

/**
 * Lecture incrementale. JAMAIS de relecture complete.
 *
 * TROIS signaux de reouverture, pas deux. Une reecriture en place (meme inode) qui
 * regrossit au dela de l'ancien offset passe les deux tests classiques : `/clear` et
 * une reprise de session produisent exactement ce motif, d'ou l'empreinte de tete.
 */
export function readMore(state: TailState): ReadResult {
  let st: Stats;
  try {
    st = statSync(state.path);
  } catch {
    return { lines: [], reopened: false };
  }

  if (st.ino !== state.inode || st.size < state.offset || !headMatches(state)) {
    const fresh = openTail(state.path);
    state.offset = fresh.state.offset;
    state.inode = fresh.state.inode;
    state.head = fresh.state.head;
    state.decoder = fresh.state.decoder;
    state.carry = '';
    state.bytesRead += fresh.state.bytesRead;
    return { lines: fresh.lines, reopened: true };
  }

  if (st.size === state.offset) return { lines: [], reopened: false };

  const buf = readRange(state.path, state.offset, st.size);
  state.offset += buf.length;
  state.bytesRead += buf.length;
  // Le decodeur est PERSISTANT : sans lui, un caractere UTF-8 coupe en deux lectures
  // deviendrait un U+FFFD definitif.
  const parts = (state.carry + state.decoder.write(buf)).split('\n');
  state.carry = parts.pop() ?? '';
  const lines = parts.map(safeParseLine).filter((l): l is RawLine => l !== null);
  return { lines, reopened: false };
}

export interface TailHandle {
  sessionId: string;
  state: TailState;
  close(): void;
}

/**
 * Surveillance d'un JSONL. `chokidar` (FSEvents) coalesce a 80 ms : cette latence est
 * sans consequence sur une conversation.
 */
export class TranscriptTailer extends EventEmitter {
  private readonly handles = new Map<string, TailHandle>();

  /**
   * Abonne la session et rend l'ETAT COURANT, a chaque appel.
   *
   * L'idempotence porte sur l'abonnement (un seul watcher par session), jamais sur les
   * donnees : un second client, ou le meme qui se reconnecte, recoit les memes lignes
   * que le premier. Avant, un handle deja present rendait `[]`, et l'ecran de session
   * affichait « Rien a afficher » sur une conversation pleine (H2).
   */
  async attach(sessionId: string, path: string, wantLines = 200): Promise<RawLine[]> {
    const existing = this.handles.get(sessionId);
    if (existing) return openTail(existing.state.path, wantLines).lines;

    const { state, lines } = openTail(path, wantLines);
    const { watch } = await import('chokidar');
    const watcher = watch(path, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    const onChange = (): void => {
      try {
        const res = readMore(state);
        if (res.lines.length > 0 || res.reopened) {
          this.emit('lines', sessionId, res.lines, res.reopened);
        }
      } catch (e) {
        logger.warn('tail jsonl en erreur', { sessionId, err: (e as Error).message });
      }
    };
    watcher.on('change', onChange);
    watcher.on('add', onChange);
    watcher.on('unlink', () => this.emit('closed', sessionId));

    this.handles.set(sessionId, {
      sessionId,
      state,
      close: () => void watcher.close(),
    });
    return lines;
  }

  /** Lecture ponctuelle des nouvelles lignes, sans attendre l'evenement du systeme. */
  poll(sessionId: string): RawLine[] {
    const h = this.handles.get(sessionId);
    if (!h) return [];
    return readMore(h.state).lines;
  }

  detach(sessionId: string): void {
    this.handles.get(sessionId)?.close();
    this.handles.delete(sessionId);
  }

  detachAll(): void {
    for (const id of [...this.handles.keys()]) this.detach(id);
  }

  isAttached(sessionId: string): boolean {
    return this.handles.has(sessionId);
  }
}
