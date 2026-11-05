// La ligne d'etat d'une session de l'equipe (`attn status`, lu par `team list`) : une
// icone Feather courte (jamais un glyphe textuel, `check-icons.sh`), le mot de la liste
// fermee, puis ce qu'elle attend. Pur : le rendu vit dans
// `AgentsView.tsx`. Un etat absent ou inconnu rend `null`, et la ligne reste celle d'avant.
import type { RosterEntry, TeamStatus } from '@/protocol';
import { t } from '@/i18n/en';
import type { IconName } from '@/ui/Icon';

/** Le ton de l'icone, traduit en couleur par la vue. */
export type StatusTone = 'awaiting' | 'error' | 'working' | 'success' | 'muted';

const GLYPH: Record<TeamStatus, { glyph: IconName; tone: StatusTone }> = {
  'awaiting-you': { glyph: 'bell', tone: 'awaiting' },
  'awaiting-review': { glyph: 'eye', tone: 'awaiting' },
  blocked: { glyph: 'slash', tone: 'error' },
  queued: { glyph: 'list', tone: 'muted' },
  'waiting-event': { glyph: 'clock', tone: 'muted' },
  working: { glyph: 'play', tone: 'working' },
  done: { glyph: 'check', tone: 'success' },
};

export interface StatusLine {
  glyph: IconName;
  tone: StatusTone;
  /** Le mot de l'etat, puis `attend : X` (ou ce qu'elle fait), sur une seule ligne. */
  text: string;
}

export function teamStatusLine(entry: RosterEntry): StatusLine | null {
  const status = entry.status;
  if (status === undefined || !(status in GLYPH)) return null;
  const { glyph, tone } = GLYPH[status];
  const parts = [t.teamStatusWord(status)];
  if (entry.waitingOn) parts.push(t.teamWaitingOn(entry.waitingOn));
  else if (entry.doing) parts.push(entry.doing);
  return { glyph, tone, text: parts.join(' · ') };
}
