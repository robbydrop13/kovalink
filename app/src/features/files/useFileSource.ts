// Le contenu d'un fichier du Mac pour un apercu : son texte (`fsText`), ou son URL
// authentifiee (`fsRead`) pour une image, un PDF ou une page HTML rendue par une WebView.
// Partage par l'apercu des fichiers et par le panneau.
import { useEffect, useState } from 'react';
import { fileUrl, fetchText } from '@/net/files';
import { t } from '@/i18n/en';
import { describe } from '@/store/transfers';

export type FileSourceMode = 'text' | 'url' | 'none';

export interface RemoteFile {
  url: string;
  headers: Record<string, string>;
}

export interface FileSource {
  text: string | null;
  truncated: boolean;
  size: number | null;
  remote: RemoteFile | null;
  /** Message du daemon tel quel (liste noire, absent, droit macOS) : jamais reformule. */
  error: string | null;
  loading: boolean;
  retry: () => void;
}

export function useFileSource(path: string, mode: FileSourceMode): FileSource {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const [remote, setRemote] = useState<RemoteFile | null>(null);
  // Cle deja chargee. `loading` s'en DEDUIT au lieu d'etre pose dans le corps de
  // l'effet, ce qui provoquerait un rendu en cascade a chaque montage.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${attempt}:${mode}:${path}`;

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!path) {
        if (alive) setError({ key, message: t.previewNoPath });
        return;
      }
      try {
        if (mode === 'text') {
          const res = await fetchText(path);
          if (!alive) return;
          setText(res.text);
          setTruncated(res.truncated);
          setSize(res.size);
        } else if (mode === 'url') {
          const r = await fileUrl(path);
          if (!alive) return;
          setRemote(r);
        }
        if (alive) setLoaded(key);
      } catch (e) {
        if (alive) setError({ key, message: describe(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, mode, key]);

  const currentError = error?.key === key ? error.message : null;
  return {
    text,
    truncated,
    size,
    remote,
    error: currentError,
    loading: loaded !== key && currentError === null,
    retry: () => setAttempt((n) => n + 1),
  };
}
