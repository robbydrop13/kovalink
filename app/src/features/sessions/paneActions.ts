// Les trois gestes de balayage d'une ligne de session, les mêmes que sur le Mac : fermer,
// favori, renommer. Fermer est le seul geste destructeur de l'app : il est confirmé avec
// l'état RÉEL du pane, et un agent au travail exige un second tap. Tout texte visible est
// en anglais.
import { Alert } from 'react-native';
import type { Pane } from '@/protocol';
import { nonce } from '@/actions/nonce';
import { postBookmark, postClose, postTitle } from '@/net/http';
import { ImpactStyle, NotifyType, impact, notify } from '@/utils/haptics';
import { closeStateLabel } from './closeState';

export type Notice = (text: string) => void;

async function doClose(pane: Pane, onNotice: Notice): Promise<void> {
  impact(ImpactStyle.Heavy);
  try {
    const res = await postClose(pane.id, nonce());
    if (!res.applied) {
      onNotice(res.reason === 'pane_gone' ? 'This pane no longer exists on the Mac' : `Close refused (${res.reason ?? 'unknown'})`);
      return;
    }
    notify(NotifyType.Success);
    onNotice(`Closed ${pane.projectName}`);
  } catch (e) {
    notify(NotifyType.Error);
    onNotice(`Close failed. ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Feuille de confirmation : projet, libellé, état réel. Un agent au travail passe par une
 * seconde confirmation, en rouge, comme Kova le demande sur le Mac.
 */
export function confirmClose(pane: Pane, tabTitle: string | null, onNotice: Notice): void {
  const state = closeStateLabel(pane);
  const title = `Close ${pane.projectName}?`;
  const body = `${tabTitle ? `${tabTitle} · ` : ''}${pane.title ?? pane.agent ?? 'pane'}\n${state.label}`;
  if (!state.danger) {
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close', style: 'destructive', onPress: () => void doClose(pane, onNotice) },
    ]);
    return;
  }
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Close anyway',
      style: 'destructive',
      onPress: () =>
        Alert.alert('Interrupt the task?', 'The agent is in the middle of a task. This closes the pane and stops it.', [
          { text: 'Keep working', style: 'cancel' },
          { text: 'Close and interrupt', style: 'destructive', onPress: () => void doClose(pane, onNotice) },
        ]),
    },
  ]);
}

/** Favori : bascule ajout/retrait sur la session du pane. Sans session, rien à marquer. */
export async function toggleBookmark(pane: Pane, bookmarked: boolean, onNotice: Notice): Promise<boolean | null> {
  const sessionId = pane.agent_session_id ?? pane.claude_session_id;
  if (!sessionId) {
    onNotice('This pane has no agent session to bookmark');
    return null;
  }
  impact(ImpactStyle.Medium);
  try {
    const res = await postBookmark(bookmarked ? 'remove' : 'add', sessionId);
    onNotice(res.bookmarked ? 'Bookmarked' : 'Bookmark removed');
    return res.bookmarked;
  } catch (e) {
    onNotice(`Bookmark failed. ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Renommer l'onglet : champ pré-rempli avec le titre courant, vide pour le titre automatique. */
export function promptRename(pane: Pane, currentTitle: string | null, onNotice: Notice, onDone?: (title: string | null) => void): void {
  const submit = (value?: string): void => {
    const title = (value ?? '').trim();
    void postTitle(pane.id, title.length === 0 ? null : title).then(
      (res) => {
        impact(ImpactStyle.Light);
        onNotice(res.title === null ? 'Tab title reset' : `Tab renamed to ${res.title}`);
        onDone?.(res.title);
      },
      (e: unknown) => onNotice(`Rename failed. ${e instanceof Error ? e.message : String(e)}`),
    );
  };
  Alert.prompt(
    'Rename tab',
    'Leave empty to go back to the automatic title.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Rename', onPress: submit },
    ],
    'plain-text',
    currentTitle ?? '',
    'default',
  );
}
