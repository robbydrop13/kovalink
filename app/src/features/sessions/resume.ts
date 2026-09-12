// Reprise d'une session fermée depuis l'app (PRD 3.4, design 4.11). Une feuille de
// confirmation d'abord, parce que reprendre lance un processus sur le Mac ; « Lire »
// ouvre le transcript en lecture seule, sans rien lancer.
import { Alert } from 'react-native';
import { router } from 'expo-router';
import type { KovaSessionEntry } from '@/protocol';
import { postResume } from '@/net/http';
import { shortAge } from '@/utils/time';
import { ImpactStyle, impact } from '@/utils/haptics';

export function sessionAge(entry: KovaSessionEntry, now = Date.now()): string {
  return shortAge(new Date(entry.lastActiveMs).toISOString(), now);
}

/** Ouvre le transcript en lecture seule. */
export function readSession(entry: KovaSessionEntry): void {
  router.push({ pathname: '/history/[sessionId]', params: { sessionId: entry.sessionId, cwd: entry.cwd, title: entry.title } });
}

/**
 * Lance la reprise et ouvre le pane créé. `onNotice` reçoit la cause d'un échec.
 * Rend `true` si un écran a été ouvert.
 */
export async function resumeSession(entry: KovaSessionEntry, onNotice: (text: string) => void): Promise<boolean> {
  impact(ImpactStyle.Medium);
  try {
    const res = await postResume(entry.sessionId);
    if (res.alreadyOpen) onNotice('Cette session est déjà ouverte sur le Mac');
    router.replace(res.launched || res.alreadyOpen ? `/session/${res.paneId}` : `/session/${res.paneId}?view=term`);
    return true;
  } catch (e) {
    onNotice(`Reprise impossible. ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Feuille « Reprendre cette session ? » : projet, libellé et date, puis Lire ou Reprendre. */
export function askResume(entry: KovaSessionEntry, onNotice: (text: string) => void): void {
  Alert.alert(
    'Reprendre cette session ?',
    `${entry.projectName} · ${entry.title}\nDernière activité il y a ${sessionAge(entry)}.\n\nReprendre lance Claude sur le Mac dans un nouvel onglet, avec l’historique de cette session.`,
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Lire', onPress: () => readSession(entry) },
      { text: 'Reprendre', onPress: () => void resumeSession(entry, onNotice) },
    ],
    { userInterfaceStyle: 'dark' },
  );
}
