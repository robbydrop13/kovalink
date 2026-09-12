// File de transferts iPhone vers Mac.
//
// Un seul transfert actif à la fois (PRD 5.2), les autres en file. Reprise au dernier
// morceau confirmé, 3 tentatives avec temporisation 2 s, 8 s, 30 s, puis abandon et
// suppression du partiel (PRD 5.3).
//
// Aucun plafond de taille (A4) : la seule limite est le disque du Mac, et c'est le daemon
// qui la connaît. Au delà de 100 Mo en données cellulaires, le transfert attend un choix
// explicite de Robin, il ne part jamais de lui même.
import { create } from 'zustand';
import * as Network from 'expo-network';
import {
  CELLULAR_WARN_BYTES,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_RETRY_BACKOFF_MS,
} from '@/protocol';
import {
  openLocalFile,
  readSlice,
  sha256OfLocalFile,
  uploadAbort,
  uploadChunk,
  uploadComplete,
  uploadInit,
} from '@/net/files';
import { HttpError } from '@/net/http';
import { t } from '@/i18n/en';
import { ImpactStyle, NotifyType, impact, notify } from '@/utils/haptics';

export type TransferState =
  | 'queued'
  /** Au delà de 100 Mo en cellulaire : attend `Send now` ou `Wait for Wi-Fi`. */
  | 'awaiting-choice'
  /** Choix « Wait for Wi-Fi » : repart tout seul au prochain passage en Wi-Fi. */
  | 'waiting-wifi'
  | 'running'
  /** Coupure réseau. Ce n'est PAS un échec : la reprise est automatique. */
  | 'paused'
  | 'done'
  | 'failed'
  | 'canceled';

export interface Transfer {
  id: string;
  uri: string;
  filename: string;
  size: number;
  destDir: string;
  destLabel: string;
  state: TransferState;
  /** `hashing` : l'empreinte se calcule, rien n'est encore parti. */
  phase: 'hashing' | 'sending' | null;
  /** SHA-256 hexadécimal du fichier local, calculé une fois, envoyé à l'`init` (CA-101). */
  sha256: string | null;
  sentBytes: number;
  /** Nom réellement écrit sur le Mac. Différent de `filename` en cas de collision. */
  finalName: string | null;
  /** Chemin absolu réel sur le Mac, rendu par le `complete`. Les pièces jointes du chat le lisent. */
  finalPath: string | null;
  renamed: boolean;
  /** Cause réelle de l'échec, telle que le daemon l'a formulée. Jamais un libellé maison. */
  error: string | null;
  /** Code de l'échec (`PATH_DENIED`, `CHECKSUM_MISMATCH`...). `null` pour une panne réseau. */
  errorCode: string | null;
  attempts: number;
  uploadId: string | null;
  startedAt: number;
}

interface TransfersState {
  items: Transfer[];
  enqueue: (
    t: Omit<
      Transfer,
      | 'state'
      | 'phase'
      | 'sha256'
      | 'sentBytes'
      | 'finalName'
      | 'finalPath'
      | 'renamed'
      | 'error'
      | 'errorCode'
      | 'attempts'
      | 'uploadId'
      | 'startedAt'
    >,
  ) => void;
  patch: (id: string, patch: Partial<Transfer>) => void;
  remove: (id: string) => void;
  /** Réponse à la feuille cellulaire : maintenant, ou au prochain Wi-Fi. */
  resolveChoice: (id: string, choice: 'now' | 'wifi') => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

export const useTransfers = create<TransfersState>((set, get) => ({
  items: [],
  enqueue: (t) =>
    set((s) => ({
      items: [
        ...s.items,
        {
          ...t,
          state: 'queued',
          phase: null,
          sha256: null,
          sentBytes: 0,
          finalName: null,
          finalPath: null,
          renamed: false,
          error: null,
          errorCode: null,
          attempts: 0,
          uploadId: null,
          startedAt: Date.now(),
        },
      ],
    })),
  patch: (id, patch) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  resolveChoice: (id, choice) => {
    get().patch(id, { state: choice === 'now' ? 'queued' : 'waiting-wifi' });
    void pump();
  },
  cancel: (id) => {
    const item = get().items.find((i) => i.id === id);
    canceled.add(id);
    get().patch(id, { state: 'canceled' });
    // Le `.part` disparaît côté Mac : aucun fichier partiel ne subsiste dans la
    // destination (CA-108). L'échec de cet appel n'est pas grave, le daemon purge à 24 h.
    if (item?.uploadId) void uploadAbort(item.uploadId).catch(() => undefined);
    void pump();
  },
  clearFinished: () =>
    set((s) => ({
      items: s.items.filter((i) => i.state !== 'done' && i.state !== 'canceled'),
    })),
}));

const canceled = new Set<string>();
let running = false;

/** Vrai en données cellulaires. Une erreur de détection ne bloque jamais un envoi. */
async function onCellular(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.CELLULAR;
  } catch {
    return false;
  }
}

/**
 * Décide si le transfert doit demander un choix à Robin AVANT de démarrer.
 *
 * En Wi-Fi, aucun avertissement, quelle que soit la taille (design 4.7). En cellulaire,
 * le seuil est celui du protocole, partagé avec le daemon : 100 Mo. Exporté : le chat pose
 * la question une fois pour toutes les pièces d'un message, avant de les mettre en file.
 */
export async function needsCellularChoice(size: number): Promise<boolean> {
  if (size <= CELLULAR_WARN_BYTES) return false;
  return onCellular();
}

/**
 * Met en file un fichier et démarre la boucle. Le choix cellulaire est posé ici, sauf
 * quand l'appelant l'a déjà posé lui même sur l'ensemble d'un envoi (`cellularApproved`,
 * pièces jointes du chat : une seule question pour trois photos, pas trois).
 */
export async function queueUpload(
  t: {
    id: string;
    uri: string;
    filename: string;
    size: number;
    destDir: string;
    destLabel: string;
  },
  o: { cellularApproved?: boolean } = {},
): Promise<void> {
  useTransfers.getState().enqueue(t);
  if (!o.cellularApproved && (await needsCellularChoice(t.size))) {
    useTransfers.getState().patch(t.id, { state: 'awaiting-choice' });
    return;
  }
  void pump();
}

/**
 * Boucle d'envoi. Un transfert à la fois, dans l'ordre de la file.
 *
 * Elle est réentrante par construction : `running` garantit qu'une seule instance tourne,
 * et chaque appel supplémentaire est un signal « regarde s'il y a du travail ».
 */
export async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = useTransfers.getState().items.find((i) => i.state === 'queued' || i.state === 'paused');
      if (!next) break;
      await runOne(next.id);
    }
  } finally {
    running = false;
  }
}

/** Le retour du Wi-Fi relance ce qui attendait. Branché au démarrage de l'app. */
export function watchWifi(): { remove: () => void } {
  try {
    return Network.addNetworkStateListener((event) => {
      if (event.type !== Network.NetworkStateType.WIFI) return;
      const store = useTransfers.getState();
      for (const item of store.items) {
        if (item.state === 'waiting-wifi') store.patch(item.id, { state: 'queued' });
      }
      void pump();
    });
  } catch {
    // `expo-network` indisponible : les transferts différés repartiront au prochain
    // `Send now`. On ne fait pas tomber l'app pour un écouteur de confort.
    return { remove: () => undefined };
  }
}

async function runOne(id: string): Promise<void> {
  const store = useTransfers.getState();
  const item = store.items.find((i) => i.id === id);
  if (!item || canceled.has(id)) return;

  store.patch(id, { state: 'running', error: null });

  let handle: ReturnType<typeof openLocalFile> | null = null;
  try {
    handle = openLocalFile(item.uri);

    // Empreinte SHA-256 calculée AVANT l'`init`, par tranches, sans jamais charger le
    // fichier (CA-101). Le daemon la vérifie au `complete` et refuse de publier un fichier
    // qui ne lui correspond pas ; sans empreinte fournie, il ne vérifiait rien du tout.
    // Une seule fois par transfert : une reprise après coupure réutilise la valeur.
    let sha256 = item.sha256;
    if (!sha256) {
      store.patch(id, { phase: 'hashing' });
      sha256 = await sha256OfLocalFile(handle.handle, item.size, () => canceled.has(id));
      if (canceled.has(id)) return;
      store.patch(id, { sha256 });
    }
    store.patch(id, { phase: 'sending' });

    // `init` refuse AVANT tout octet : liste noire d'écriture, place disque, nom invalide.
    // Il retrouve aussi un transfert coupé et rend les octets déjà reçus.
    const init = await uploadInit({
      destDir: item.destDir,
      filename: item.filename,
      size: item.size,
      sha256,
    });
    store.patch(id, { uploadId: init.uploadId, sentBytes: init.receivedBytes });

    let offset = init.receivedBytes;
    const chunkBytes = init.chunkBytes || UPLOAD_CHUNK_BYTES;

    while (offset < item.size) {
      if (canceled.has(id)) return;
      const length = Math.min(chunkBytes, item.size - offset);
      const slice = readSlice(handle.handle, offset, length);
      try {
        const res = await uploadChunk(init.uploadId, offset, slice);
        offset = res.receivedBytes;
      } catch (e) {
        // Un offset qui ne correspond pas n'est pas une panne : le Mac dit où reprendre.
        // Sans ce recalage, chaque coupure ferait repartir le fichier de zéro.
        const received = (e as HttpError & { receivedBytes?: number }).receivedBytes;
        if (e instanceof HttpError && e.code === 'OFFSET_MISMATCH' && typeof received === 'number') {
          offset = received;
          store.patch(id, { sentBytes: offset });
          continue;
        }
        throw e;
      }
      store.patch(id, { sentBytes: offset });
    }

    if (canceled.has(id)) return;
    const done = await uploadComplete(init.uploadId);
    // Le Mac rend l'empreinte de ce qu'il a écrit. Les deux côtés doivent dire la même
    // chose : le daemon l'a déjà vérifié, on le vérifie aussi, et on ne dit « envoyé »
    // qu'une fois les deux d'accord.
    if (done.sha256 && done.sha256.toLowerCase() !== sha256) {
      throw new HttpError(
        422,
        'CHECKSUM_MISMATCH',
        t.transferChecksumMismatch(done.sha256, sha256),
      );
    }
    store.patch(id, {
      state: 'done',
      phase: null,
      sentBytes: done.size,
      finalName: done.name,
      finalPath: done.path,
      renamed: done.renamed,
    });
    notify(NotifyType.Success);
  } catch (e) {
    if (canceled.has(id)) return;
    const message = describe(e);
    const attempts = (useTransfers.getState().items.find((i) => i.id === id)?.attempts ?? 0) + 1;

    // Un refus définitif ne se retente pas : réessayer 3 fois d'écrire dans `~/.ssh`
    // donnerait trois fois le même refus et ferait croire à une panne réseau.
    const errorCode = e instanceof HttpError ? e.code : null;
    if (isFinal(e) || attempts > UPLOAD_RETRY_BACKOFF_MS.length) {
      store.patch(id, { state: 'failed', error: message, errorCode, attempts });
      impact(ImpactStyle.Heavy);
      return;
    }

    store.patch(id, { state: 'paused', error: message, errorCode, attempts });
    const wait = UPLOAD_RETRY_BACKOFF_MS[attempts - 1] ?? 30_000;
    await new Promise((r) => setTimeout(r, wait));
  } finally {
    try {
      handle?.handle.close();
    } catch {
      // Poignée déjà fermée : rien à signaler.
    }
  }
}

/**
 * Refus définitif : rien ne changera en réessayant.
 *
 * Liste noire d'écriture, chemin absent, nom invalide, disque plein, empreinte divergente.
 * Tout le reste (coupure réseau, Mac endormi, 5xx) mérite une reprise.
 */
const FINAL_CODES = [
  'PATH_DENIED',
  'PATH_NOT_FOUND',
  'NOT_A_DIRECTORY',
  'BAD_REQUEST',
  'NO_SPACE',
  'CHECKSUM_MISMATCH',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
];

function isFinal(e: unknown): boolean {
  if (!(e instanceof HttpError)) return false;
  return FINAL_CODES.includes(e.code);
}

/** Le message du daemon, tel quel. Il porte la cause, il est écrit pour être affiché. */
export function describe(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function progressOf(t: Transfer): number {
  return t.size === 0 ? 1 : Math.min(t.sentBytes / t.size, 1);
}

/** Refus définitif du Mac, ou panne réseau : les deux appellent un geste différent. */
export function isFinalCode(code: string | null): boolean {
  return code !== null && FINAL_CODES.includes(code);
}

/**
 * Attend la fin d'UN transfert de la file : rendu quand il est `done`, rejeté sinon.
 *
 * C'est le seul point d'attente du chat sur la file de transferts : les pièces jointes
 * passent par la même file, le même hachage, la même reprise et le même choix cellulaire
 * que l'écran Fichiers. Le rejet porte le message du daemon tel quel et son code, pour
 * que l'appelant sache si un nouvel essai a un sens.
 */
export function waitForTransfer(id: string): Promise<Transfer> {
  return new Promise((resolvePromise, reject) => {
    const settle = (tr: Transfer): boolean => {
      if (tr.state === 'done') {
        resolvePromise(tr);
        return true;
      }
      if (tr.state === 'failed' || tr.state === 'canceled') {
        const err = new Error(tr.error ?? (tr.state === 'canceled' ? t.transferCanceled : t.transferFailed));
        (err as Error & { code?: string | null }).code = tr.state === 'canceled' ? 'ABORTED' : tr.errorCode;
        reject(err);
        return true;
      }
      return false;
    };
    const current = useTransfers.getState().items.find((i) => i.id === id);
    if (!current) {
      reject(new Error(t.transferMissing(id)));
      return;
    }
    if (settle(current)) return;
    const unsubscribe = useTransfers.subscribe((s) => {
      const item = s.items.find((i) => i.id === id);
      if (!item) {
        unsubscribe();
        reject(new Error(t.transferRemoved(id)));
        return;
      }
      if (settle(item)) unsubscribe();
    });
  });
}
