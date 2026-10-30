// Dictée : le direct d'abord (le PCM du micro part vers une WebSocket, les mots s'écrivent
// dans le champ pendant que Robin parle), Whisper en repli (enregistrer l'audio sur
// l'iPhone, l'envoyer au daemon). Dans les deux cas la clé reste sur le Mac : AssemblyAI ne
// reçoit qu'un jeton temporaire, et le fichier temporaire de l'iPhone est supprimé après envoi.
//
// `expo-audio` est chargé PARESSEUSEMENT : le build natif du 12 septembre ne le contient
// pas encore (module natif et permission micro dans Info.plist arrivent avec le prochain
// build). Sur ce build, l'import lève, et le bouton micro l'explique au lieu de planter.
import type { AudioStream, AudioStreamBuffer } from 'expo-audio';
import { File } from 'expo-file-system';
import {
  ROUTES,
  TRANSCRIBE_MAX_BYTES,
  VOICE_STREAM_SAMPLE_RATE,
  type ErrorPayload,
  type TranscribeResponse,
  type VoiceStreamTokenResponse,
} from '@/protocol';
import { HttpError, baseUrl } from '@/net/http';
import { loadCredentials, type Credentials } from '@/store/credentials';
import { t } from '@/i18n/en';
import { applyMessage, emptyLiveState, finalText, levelDb, render, type LiveRender, type LiveState } from './liveTranscript';

type AudioModuleShape = typeof import('expo-audio');

let audioModule: AudioModuleShape | null | undefined;

/** Le module natif, ou `null` s'il n'est pas dans ce build. Mémorisé. */
export async function loadAudio(): Promise<AudioModuleShape | null> {
  if (audioModule !== undefined) return audioModule;
  try {
    const mod = await import('expo-audio');
    // Un accès qui touche le module natif : lève quand il n'est pas lié dans le binaire.
    await mod.AudioModule.getRecordingPermissionsAsync();
    audioModule = mod;
  } catch {
    audioModule = null;
  }
  return audioModule;
}

/**
 * Durée maximale d'un enregistrement : au-delà, la barre l'arrête d'elle-même comme un
 * appui sur Stop. Le préréglage HIGH_QUALITY (128 kbit/s) tient 10 Mo en dix minutes
 * environ : cinq minutes laissent de la marge sous `TRANSCRIBE_MAX_BYTES`.
 */
export const MAX_RECORD_MS = 5 * 60_000;

/** Ce que la barre interroge à 10 Hz pendant une dictée, quel que soit le mode. */
export interface VoiceLevel {
  /** Niveau sonore, dB négatifs (0 = plein), `null` si inconnu. */
  level: () => number | null;
  durationMs: () => number;
}

export type RecorderHandle = VoiceLevel & {
  stop: () => Promise<{ uri: string | null }>;
};

export interface LiveDictationHandle extends VoiceLevel {
  /** Arrête le micro, demande la fin au service (3 s max) et rend le texte complet. */
  stop: () => Promise<string>;
  /** Coupe tout sans rien demander au service : les mots sont jetés. */
  cancel: () => void;
}

export class VoiceError extends Error {
  constructor(
    readonly code: 'unavailable' | 'permission' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}

/** Démarre un enregistrement m4a avec mesure de niveau. */
export async function startRecording(): Promise<RecorderHandle> {
  const audio = await loadAudio();
  if (!audio) throw new VoiceError('unavailable', t.voiceNeedsBuild);
  const perm = await audio.AudioModule.requestRecordingPermissionsAsync();
  if (!perm.granted) throw new VoiceError('permission', t.voicePermissionDenied);
  await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  const recorder = new audio.AudioModule.AudioRecorder({ ...audio.RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  await recorder.prepareToRecordAsync();
  recorder.record();
  return {
    level: () => {
      const m = recorder.getStatus().metering;
      return typeof m === 'number' ? m : null;
    },
    durationMs: () => recorder.getStatus().durationMillis,
    stop: async () => {
      await recorder.stop();
      await audio.setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      return { uri: recorder.uri };
    },
  };
}

/** Efface le fichier temporaire de l'iPhone, sans jamais lever. */
export function discardRecording(uri: string | null): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Un fichier temporaire qui reste n'est pas une panne.
  }
}

/**
 * Envoie l'audio au daemon (`POST /v1/transcribe`, corps brut `audio/mp4`, 10 Mo max) et
 * rend le texte. Le fichier local est supprimé quoi qu'il arrive.
 */
export async function transcribeRecording(uri: string): Promise<TranscribeResponse> {
  try {
    const file = new File(uri);
    const size = file.size ?? 0;
    if (size > TRANSCRIBE_MAX_BYTES) throw new VoiceError('failed', t.voiceTooLong);
    const bytes = await file.bytes();
    const creds = await loadCredentials();
    if (!creds) throw new HttpError(401, 'UNAUTHORIZED', t.httpNotPaired);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    try {
      const res = await fetch(`${baseUrl(creds)}${ROUTES.transcribe}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${creds.token}`, 'content-type': 'audio/mp4' },
        body: bytes,
      });
      const text = await res.text();
      let json: unknown = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new HttpError(res.status, 'INTERNAL', t.httpUnreadableBody(text.slice(0, 200)));
      }
      if (!res.ok) {
        const e = json as Partial<ErrorPayload>;
        throw new HttpError(res.status, e.code ?? 'INTERNAL', e.message ?? t.httpStatusOn(res.status, ROUTES.transcribe));
      }
      return json as TranscribeResponse;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    discardRecording(uri);
  }
}

// --- Dictée en direct ----------------------------------------------------------------

/**
 * Le direct n'est pas disponible : route absente du daemon (404), pas de clé AssemblyAI sur
 * le Mac (503), module natif sans `AudioStream`, ou socket qui ne s'ouvre pas. La barre
 * retombe alors sur Whisper, sans rien dire à Robin : c'est une absence, pas une panne.
 */
export class LiveUnavailableError extends Error {
  constructor() {
    super('live dictation unavailable');
    this.name = 'LiveUnavailableError';
  }
}

/** Jeton et handshake WebSocket : au delà, le service est injoignable. */
const CONNECT_TIMEOUT_MS = 8_000;
/** Arrêt : le service doit rendre `Termination` ou fermer le socket, puis on coupe. */
const TERMINATE_TIMEOUT_MS = 3_000;
/** Tampons gardés avant l'ouverture du socket (100 ms chacun) : 20 s, bien au delà du handshake. */
const MAX_QUEUED_BUFFERS = 200;

/**
 * `addListener` manque au typage installé : les `.d.ts` d'`expo-audio` résolvent
 * `expo-modules-core` depuis leur propre dossier, où il n'est pas installé, donc `SharedObject`
 * y vaut `any` et la classe perd les méthodes héritées. L'instance native, elle, est bien un
 * `SharedObject` : on décrit donc la seule méthode utilisée, et le tampon qu'elle porte.
 */
type AudioStreamListener = {
  addListener: (event: 'audioStreamBuffer', listener: (buffer: AudioStreamBuffer) => void) => { remove: () => void };
};

/** L'instance native avec son écouteur, tel qu'utilisé plus bas. */
type LiveAudioStream = AudioStream & AudioStreamListener;

/**
 * Jeton de dictée (`POST /v1/voice/stream-token`) : l'URL WebSocket est prête à ouvrir telle
 * quelle, jeton, modèle, langues, glossaire et format audio compris. Un corps sans `wsUrl`
 * exploitable vaut aussi une absence : sans direct, Whisper reste.
 */
async function streamToken(creds: Credentials): Promise<VoiceStreamTokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl(creds)}${ROUTES.voiceStreamToken}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${creds.token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status === 404 || res.status === 503) throw new LiveUnavailableError();
    if (!res.ok) throw new HttpError(res.status, 'INTERNAL', t.httpStatusOn(res.status, ROUTES.voiceStreamToken));
    let body: Partial<VoiceStreamTokenResponse> = {};
    try {
      body = (await res.json()) as Partial<VoiceStreamTokenResponse>;
    } catch {
      throw new LiveUnavailableError();
    }
    if (typeof body.wsUrl !== 'string' || body.wsUrl.length === 0) throw new LiveUnavailableError();
    return {
      wsUrl: body.wsUrl,
      sampleRate: body.sampleRate ?? VOICE_STREAM_SAMPLE_RATE,
      expiresAt: body.expiresAt ?? 0,
      keyterms: body.keyterms ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dictée en direct : le PCM du micro (16 kHz, mono, int16) part en trames binaires vers la
 * WebSocket du service, et chaque `Turn` met à jour l'affichage par `onUpdate`.
 *
 * Le micro démarre AVANT la demande de jeton : les premières syllabes attendent dans une
 * file pendant le handshake, puis partent d'un coup. L'ouverture du socket est attendue
 * avant de rendre la main ; un échec avant le premier mot retombe sur Whisper, et tout ce
 * qui arrive ensuite par `onError` est vraiment une panne en cours de dictée.
 */
export async function startLiveDictation(
  onUpdate: (text: LiveRender) => void,
  onError: (cause: string) => void,
): Promise<LiveDictationHandle> {
  const audio = await loadAudio();
  if (!audio) throw new LiveUnavailableError();
  const Stream = audio.AudioModule.AudioStream;
  if (typeof Stream !== 'function') throw new LiveUnavailableError();
  const perm = await audio.AudioModule.requestRecordingPermissionsAsync();
  if (!perm.granted) throw new VoiceError('permission', t.voicePermissionDenied);
  const creds = await loadCredentials();
  if (!creds) throw new HttpError(401, 'UNAUTHORIZED', t.httpNotPaired);

  const stream = new Stream({ sampleRate: VOICE_STREAM_SAMPLE_RATE, channels: 1, encoding: 'int16' }) as LiveAudioStream;
  const queue: ArrayBuffer[] = [];
  let startedAt = Date.now();
  /** Le micro ne livre pas 16 kHz (convertisseur natif indisponible) : rien ne part. */
  let badRate = false;
  let state: LiveState = emptyLiveState();
  let level: number | null = null;
  let socket: WebSocket | null = null;
  let socketOpen = false;
  let streaming = true;
  let ended = false;
  let failed = false;
  let terminated = false;
  let signalClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    signalClosed = resolve;
  });

  const subscription = stream.addListener('audioStreamBuffer', (buffer) => {
    // Selon la version du pont natif, le tampon arrive en `ArrayBuffer` ou en vue typée.
    const raw: unknown = buffer?.data;
    const data =
      raw instanceof ArrayBuffer
        ? raw
        : ArrayBuffer.isView(raw)
          ? (raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
          : null;
    if (ended || !data) return;
    // L'URL annonce 16 kHz : un autre débit donnerait un texte absurde dans le champ.
    if (typeof buffer.sampleRate === 'number' && buffer.sampleRate !== VOICE_STREAM_SAMPLE_RATE) {
      badRate = true;
      if (socketOpen) fail(t.voiceFailed(`microphone at ${buffer.sampleRate} Hz`));
      return;
    }
    level = levelDb(data);
    if (socketOpen && socket) {
      try {
        socket.send(data);
      } catch {
        // Le socket vient de tomber : `onerror` ou `onclose` fait le ménage.
      }
      return;
    }
    if (queue.length < MAX_QUEUED_BUFFERS) queue.push(data);
  });

  const releaseStream = (): void => {
    if (!streaming) return;
    streaming = false;
    subscription.remove();
    try {
      stream.stop();
    } catch {
      // Déjà arrêté : rien à faire.
    }
  };

  // Détaché AVANT de fermer : un `onclose` tardif ne doit pas passer pour une panne.
  const closeSocket = (): void => {
    const ws = socket;
    socket = null;
    socketOpen = false;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      // Déjà fermé.
    }
  };

  const fail = (cause: string): void => {
    if (ended || failed) return;
    failed = true;
    socketOpen = false;
    // La barre termine la dictée comme un appui sur Stop et garde ce qui est acquis.
    onError(cause);
  };

  const handleMessage = (data: unknown): void => {
    if (typeof data !== 'string') return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const fields = msg as { type?: unknown; error?: unknown };
    if (fields.type === 'Termination') {
      terminated = true;
      signalClosed();
      // Fin décidée par le service en pleine dictée (durée maximale) : comme une panne.
      if (!ended) fail(t.voiceStreamClosed);
      return;
    }
    if (typeof fields.error === 'string' && fields.error.length > 0) {
      fail(fields.error);
      return;
    }
    const next = applyMessage(state, msg);
    if (next === state) return;
    state = next;
    onUpdate(render(state));
  };

  try {
    await stream.start();
    startedAt = Date.now();
  } catch (e) {
    releaseStream();
    throw new VoiceError('failed', t.voiceFailed(e instanceof Error ? e.message : String(e)));
  }
  let token: VoiceStreamTokenResponse;
  try {
    token = await streamToken(creds);
  } catch (e) {
    releaseStream();
    // Seul un refus d'appairage se montre ; un daemon lent, un 5xx ou le réseau laissent
    // Whisper prendre le relais.
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw e;
    throw new LiveUnavailableError();
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(token.wsUrl);
      socket = ws;
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => reject(new Error(t.voiceStreamNoAnswer)), CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        if (badRate) {
          reject(new Error(t.voiceStreamNoAnswer));
          return;
        }
        socketOpen = true;
        for (const buffer of queue) {
          try {
            ws.send(buffer);
          } catch {
            // `onerror` suivra.
          }
        }
        queue.length = 0;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        if (socketOpen) fail(t.voiceStreamNoAnswer);
        else reject(new Error(t.voiceStreamNoAnswer));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        const wasOpen = socketOpen;
        socketOpen = false;
        signalClosed();
        if (!wasOpen) reject(new Error(t.voiceStreamClosed));
        else if (!terminated) fail(t.voiceStreamClosed);
      };
      ws.onmessage = (event: MessageEvent) => handleMessage(event.data);
    });
  } catch {
    // Rien n'a encore été dicté : le direct est simplement indisponible, Whisper prend le relais.
    releaseStream();
    closeSocket();
    throw new LiveUnavailableError();
  }

  const finishSession = async (): Promise<string> => {
    if (ended) return finalText(state);
    releaseStream();
    ended = true;
    if (!failed && socketOpen && socket) {
      try {
        socket.send(JSON.stringify({ type: 'Terminate' }));
      } catch {
        // Déjà fermé : le texte acquis reste.
      }
      await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, TERMINATE_TIMEOUT_MS))]);
    }
    closeSocket();
    return finalText(state);
  };
  let stopping: Promise<string> | null = null;

  return {
    level: () => level,
    durationMs: () => Date.now() - startedAt,
    stop: () => {
      stopping ??= finishSession();
      return stopping;
    },
    cancel: () => {
      ended = true;
      state = emptyLiveState();
      queue.length = 0;
      releaseStream();
      closeSocket();
    },
  };
}
