// Mode vocal : enregistrer sur l'iPhone (m4a), envoyer l'audio au daemon, recevoir le
// texte dans le composer. Le daemon parle à Gladia avec la clé du Mac : rien ne part
// ailleurs, et le fichier temporaire de l'iPhone est supprimé après envoi.
//
// `expo-audio` est chargé PARESSEUSEMENT : le build natif du 12 septembre ne le contient
// pas encore (module natif et permission micro dans Info.plist arrivent avec le prochain
// build). Sur ce build, l'import lève, et le bouton micro l'explique au lieu de planter.
import { File } from 'expo-file-system';
import { ROUTES, TRANSCRIBE_MAX_BYTES, type ErrorPayload, type TranscribeResponse } from '@/protocol';
import { HttpError, baseUrl } from '@/net/http';
import { loadCredentials } from '@/store/credentials';
import { t } from '@/i18n/en';

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

export type RecorderHandle = {
  /** Niveau sonore, dB négatifs (0 = plein), `null` si inconnu. */
  level: () => number | null;
  durationMs: () => number;
  stop: () => Promise<{ uri: string | null }>;
};

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
