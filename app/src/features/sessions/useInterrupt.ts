// Geste `Interrompre`, partagé par la liste, la session et la barre de validation.
// Le libellé devient `Interrompu` en vert pendant 1200 ms, puis revient. Aucune
// confirmation, aucune authentification, sur aucune des surfaces.
import { useCallback, useEffect, useRef, useState } from 'react';
import { interruptPane } from '@/actions/interrupt';
import { HttpError } from '@/net/http';
import { bootWarn } from '@/env';
import { t } from '@/i18n/en';

export function useInterrupt() {
  const [done, setDone] = useState<Record<number, boolean>>({});
  /** Cause du dernier échec, par pane. Un geste raté qui ne dit rien est un geste perdu. */
  const [failure, setFailure] = useState<Record<number, string | null>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  const run = useCallback(async (paneId: number) => {
    try {
      await interruptPane(paneId);
      setFailure((s) => ({ ...s, [paneId]: null }));
      setDone((s) => ({ ...s, [paneId]: true }));
      timers.current[paneId] = setTimeout(() => {
        setDone((s) => ({ ...s, [paneId]: false }));
      }, 1200);
    } catch (e) {
      // La cause est retenue ET journalisée. Auparavant le bouton se contentait de ne
      // rien faire : Robin ne pouvait pas distinguer un refus d'un Mac éteint.
      const cause =
        e instanceof HttpError ? `${e.code} : ${e.message}` : e instanceof Error ? e.message : String(e);
      bootWarn(`pane ${paneId} interrupt`, cause);
      setFailure((s) => ({ ...s, [paneId]: cause }));
      timers.current[paneId] = setTimeout(() => {
        setFailure((s) => ({ ...s, [paneId]: null }));
      }, 4000);
    }
  }, []);

  const labelFor = useCallback(
    (paneId: number, degraded: boolean): string =>
      failure[paneId] ? t.interruptFailed : done[paneId] ? t.interruptDone : degraded ? t.interruptUnavailable : t.interruptLabel,
    [done, failure],
  );

  return { run, labelFor, done, failure };
}
