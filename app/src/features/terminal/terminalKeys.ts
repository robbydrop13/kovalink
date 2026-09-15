// Rangée de touches du terminal. Uniquement des noms de la table fermée du protocole : aucune
// séquence brute ne part de l'app, le daemon traduit le nom en octets.
import type { KeyName } from '@/protocol';
import type { IconName } from '@/ui/Icon';
import { t } from '@/i18n/en';

export interface TerminalKey {
  key: KeyName;
  /** Libellé texte (Esc, Tab, Ctrl-C) ou icône (flèches, Entrée), jamais les deux. */
  label?: string;
  icon?: IconName;
  a11y: string;
}

export const TERMINAL_KEYS: readonly TerminalKey[] = [
  { key: 'esc', label: t.terminalKeyEsc, a11y: t.terminalKeyEscA11y },
  { key: 'tab', label: t.terminalKeyTab, a11y: t.terminalKeyTabA11y },
  { key: 'ctrl_c', label: t.terminalKeyCtrlC, a11y: t.terminalKeyCtrlCA11y },
  { key: 'up', icon: 'arrow-up', a11y: t.terminalKeyUpA11y },
  { key: 'down', icon: 'arrow-down', a11y: t.terminalKeyDownA11y },
  { key: 'enter', icon: 'corner-down-left', a11y: t.terminalKeyEnterA11y },
];

/** Une ligne à envoyer : jamais vide ni faite que d'espaces (l'Entrée seule a sa touche). */
export function canSendLine(text: string, enabled: boolean, sending: boolean): boolean {
  return enabled && !sending && text.trim().length > 0;
}
