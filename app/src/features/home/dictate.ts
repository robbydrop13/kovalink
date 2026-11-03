// Bouton dictee de la barre d'onglets : le message part dans la session claap-agent, celle
// que Kova nomme ainsi, quel que soit l'onglet ou elle vit.
import type { Pane } from '@/protocol';
import { findAgentPane } from '@/features/agents/agents';

export const DICTATE_SESSION = 'claap-agent';

/** Le pane de claap-agent, ou `null` s'il n'est pas ouvert ou n'a pas d'agent. */
export function dictateTarget(panes: readonly Pane[]): Pane | null {
  const pane = findAgentPane(panes, DICTATE_SESSION);
  return pane && pane.agent ? pane : null;
}
