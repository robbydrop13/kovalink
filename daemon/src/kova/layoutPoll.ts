/**
 * Cadence de relecture de la mise en page de Kova (`list-tabs` + `list-panes`).
 *
 * Deux requetes sur une socket Unix locale, quelques centaines d'octets : le cout est
 * negligeable. 5 s suffit pour qu'un onglet renomme ou deplace sur le Mac apparaisse
 * sur l'iPhone sans que l'on ait a attendre un changement de focus.
 */
export const LAYOUT_POLL_MS = 5_000;

/**
 * Signature de la mise en page : ce qui, en changeant, justifie une DIFFUSION vers les
 * appareils. Kova n'emet aucun evenement quand un onglet est renomme, deplace ou cree
 * vide, ni quand le bit de non lu change : sans relecture, l'ordre et les noms des
 * onglets restaient figes dans l'app jusqu'au prochain redemarrage du daemon.
 *
 * `working`, `awaiting` et `resume_command` en font partie depuis le 26 septembre 2026.
 * Ils sont evenementiels, mais un front perdu (929 reconnexions IPC, 40 watchdogs et 733
 * reveils dans le journal) laissait le telephone sur un rond qui tourne sans fin : la
 * relecture les corrigeait dans le magasin sans jamais le dire a personne.
 */
export function layoutSignature(
  tabs: Record<string, unknown>[],
  rawPanes: Record<string, unknown>[],
): string {
  return JSON.stringify([
    tabs.map((t) => [t['id'], t['window'], t['tab_index'], t['title']]),
    // Processus enfants et session compris : sans eux, un `claude` quitte restait liste
    // pour toujours (mesure du 15 septembre 2026), l'app ne voyait jamais un shell nu et
    // n'offrait pas « Start Claude here ».
    rawPanes.map((p) => [
      p['id'],
      p['window'],
      p['tab'],
      p['title'],
      p['cwd'],
      p['agent'],
      p['agent_session_id'],
      // Le bit de non lu : Kova n'emet AUCUN evenement quand il change (une cloche, une
      // fin de tour trop courte pour notre detecteur, un Cmd+U sur le Mac). Sans lui dans
      // la signature, un pane qui devient non lu ne declenchait aucune diffusion et la
      // pastille du telephone attendait le prochain changement de mise en page.
      p['unread'],
      p['working'],
      p['awaiting'],
      p['resume_command'],
      Array.isArray(p['child_processes'])
        ? (p['child_processes'] as { name?: unknown }[]).map((c) => c.name).join(',')
        : '',
    ]),
  ]);
}

/**
 * Porte de DIFFUSION de la mise en page. Elle ne garde jamais la relecture du magasin,
 * seulement l'envoi aux appareils.
 *
 * `reset()` est indispensable quand Kova disparait et que la liste est videe : sans lui,
 * le rafraichissement suivant recalculait la MEME signature qu'avant la coupure (528
 * `list-panes` en echec dans le journal), repartait aussitot, et la liste des panes de
 * l'app restait vide indefiniment.
 */
export class LayoutGate {
  private signature = '';

  /** Vrai si la mise en page a change depuis le dernier appel. Retient la nouvelle. */
  changed(tabs: Record<string, unknown>[], rawPanes: Record<string, unknown>[]): boolean {
    const next = layoutSignature(tabs, rawPanes);
    if (next === this.signature) return false;
    this.signature = next;
    return true;
  }

  reset(): void {
    this.signature = '';
  }
}
