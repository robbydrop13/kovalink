// Choix d'un fichier sur l'iPhone, et enregistrement d'un fichier du Mac sur l'iPhone.
//
// Ce module ne connaît ni le réseau ni le protocole : il rend des candidats
// `{uri, name, size}` que la file de transfert consomme, et il ouvre la feuille de
// partage iOS dans l'autre sens.
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { TRANSFER_SELECTION_MAX } from '@/protocol';
import { t } from '@/i18n/en';
import { downloadToDevice, type DownloadPhase } from '@/net/files';

export interface Candidate {
  uri: string;
  name: string;
  size: number;
}

/** Nom de repli quand l'OS n'en donne aucun. Horodaté pour rester unique. */
function fallbackName(uri: string, ext: string): string {
  const fromUri = decodeURIComponent(uri.split('/').pop() ?? '').split('?')[0];
  if (fromUri && fromUri.includes('.')) return fromUri;
  return `kovalink-${new Date().toISOString().replace(/[:.]/g, '-')}${ext}`;
}

/** Sélecteur de documents iOS. Jusqu'à 20 fichiers (PRD C3). */
export async function pickFromFiles(): Promise<Candidate[]> {
  const res = await File.pickFileAsync({ multipleFiles: true });
  if (res.canceled || !res.result) return [];
  return res.result.slice(0, TRANSFER_SELECTION_MAX).map((f) => ({
    uri: f.uri,
    name: f.name,
    size: f.size,
  }));
}

/**
 * Photothèque iOS.
 *
 * La permission est demandée ici et son refus est RENDU, pas avalé : un sélecteur qui
 * ne s'ouvre pas sans explication est le pire des deux mondes.
 */
export async function pickFromPhotos(): Promise<Candidate[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error(t.filesPhotosDenied);
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: TRANSFER_SELECTION_MAX,
    // Aucune compression, aucun redimensionnement : Robin envoie SON fichier, pas une
    // version dégradée. Il n'y a pas de plafond de taille à contourner (A4).
    quality: 1,
    exif: false,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({
    uri: a.uri,
    name: a.fileName ?? fallbackName(a.uri, a.type === 'video' ? '.mov' : '.jpg'),
    size: a.fileSize ?? new File(a.uri).size,
  }));
}

/**
 * Appareil photo, pour une pièce jointe prise sur le moment (docs/15). Même règle que la
 * photothèque : refus de permission rendu tel quel, photo en taille originale.
 */
export async function pickFromCamera(): Promise<Candidate[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error(t.filesCameraDenied);
  }
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({
    uri: a.uri,
    name: a.fileName ?? fallbackName(a.uri, '.jpg'),
    size: a.fileSize ?? new File(a.uri).size,
  }));
}

/** Dossier de travail des téléchargements, hors du cache système que iOS purge. */
function downloadsDir(): Directory {
  const dir = new Directory(Paths.document, 'kovalink-downloads');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Mac vers iPhone : téléchargement EN FLUX, vérification d'empreinte, puis feuille de
 * partage iOS.
 *
 * Aucun octet ne transite par la mémoire de l'app : `downloadToDevice` écrit directement
 * sur le disque. La feuille ne s'ouvre qu'une fois le fichier complet ET vérifié, sans
 * quoi iOS partagerait un fichier tronqué ou corrompu sans le dire (CA-101).
 */
export async function saveToDevice(
  remotePath: string,
  name: string,
  o: {
    onProgress?: (received: number, total: number) => void;
    onPhase?: (phase: DownloadPhase) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ file: File; verified: boolean }> {
  const target = new File(downloadsDir(), name);
  if (target.exists) target.delete();
  return downloadToDevice(remotePath, target, o);
}

export async function shareFile(file: File, mime: string | null): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(t.filesShareUnavailable);
  }
  await Sharing.shareAsync(file.uri, {
    ...(mime ? { mimeType: mime } : {}),
    dialogTitle: file.name,
  });
}
