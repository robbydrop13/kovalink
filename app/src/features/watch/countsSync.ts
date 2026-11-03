// Branchement des nombres du cadran sur l'etat de l'app.
//
// Le natif (`modules/watch-relay`) ne lit rien : il pousse ce que le JS lui donne. Ici on
// suit les deux seules sources qui font bouger le cadran (le compte `waitsOnYou` et les
// panes en erreur) et on les envoie au plus une fois toutes les deux secondes.
import { setCounts } from '../../../modules/watch-relay';
import { useAsks } from '@/store/asks';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';
import { countsOf, createCountsThrottle } from './counts';

let stop: (() => void) | null = null;

/**
 * Suit `waitsOnYou` et les erreurs des panes, et pousse les nombres a la montre.
 * Idempotent : `startConnection` peut l'appeler a chaque appairage.
 */
export function startWatchCountsSync(): () => void {
  if (stop) return stop;

  const throttle = createCountsThrottle((counts) => {
    try {
      setCounts(counts);
    } catch {
      // Build sans le module ou sans montre : le cadran reste muet, l'app continue.
    }
  });

  const update = (): void => {
    const asks = useAsks.getState();
    // `null` tant que le daemon n'a pas donne son compte : pousser zero au lancement
    // effacerait le chiffre que la montre porte deja.
    if (asks.waitsOnYou === null) return;
    const panes = usePanes.getState();
    throttle.push(
      countsOf({
        panes: panes.panes,
        prompts: usePrompts.getState().byPane,
        asks: asks.asks,
        errorSince: panes.errorSince,
        waitsOnYou: asks.waitsOnYou,
        nowMs: Date.now(),
      }),
    );
  };

  const offs = [useAsks.subscribe(update), usePanes.subscribe(update), usePrompts.subscribe(update)];
  update();

  const off = (): void => {
    for (const unsubscribe of offs) unsubscribe();
    throttle.stop();
    stop = null;
  };
  stop = off;
  return off;
}

/** Appele a la deconnexion ou au desappairage : plus rien a pousser. */
export function stopWatchCountsSync(): void {
  stop?.();
}
