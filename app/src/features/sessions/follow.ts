// « Suivre sur le Mac » : ouvrir une session depuis l'iPhone bascule l'onglet sur le Mac,
// comme Cmd+P le fait sur ordinateur (affiche le pane ET bascule l'onglet). Décision pure,
// testée sous Node : le réglage et l'émetteur sont injectés.
import { t } from '@/i18n/en';

export type FollowResult = 'sent' | 'off' | 'unreachable';

/**
 * Émet exactement un `focus-pane` sur `paneId` si le réglage est actif, aucun sinon.
 * `send` rend `false` quand la liaison est coupée : l'écran s'ouvre quand même, et le
 * dit. Jamais d'échec muet.
 */
export function followPane(paneId: number, enabled: boolean, send: (paneId: number) => boolean): FollowResult {
  if (!enabled) return 'off';
  return send(paneId) ? 'sent' : 'unreachable';
}

/** Libellé du toast, `null` quand il n'y a rien à dire. */
export function followNotice(result: FollowResult): string | null {
  return result === 'unreachable' ? t.followUnreachable : null;
}
