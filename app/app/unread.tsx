// Palette « Unread », le Cmd+Shift+J de Kova (docs/16, option C) : les panes non lus dans
// l'ordre de l'anneau, avec le résumé du dernier message, et `Start review` qui ouvre le
// premier. La palette ne marque rien : lire un résumé n'est pas lire.
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n/en';
import { colors, layout, space } from '@/theme';
import { Button } from '@/ui/Button';
import { Palette, type PaletteRow } from '@/ui/Palette';
import { paneBadge, paneHref, paneLabel } from '@/features/sessions/SessionRow';
import { tabTint } from '@/features/sessions/TabGroupView';
import { groupByTab, paletteEntries } from '@/features/sessions/tabGroups';
import { unreadRing } from '@/features/sessions/unread';
import { usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';
import { useReads } from '@/store/reads';
import { matchesQuery } from '@/utils/search';
import { ImpactStyle, impact } from '@/utils/haptics';

export default function UnreadPaletteScreen() {
  const insets = useSafeAreaInsets();
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const prompts = usePrompts((s) => s.byPane);
  const marks = useReads((s) => s.byPane);
  const [query, setQuery] = useState('');

  const ring = useMemo(() => unreadRing(paletteEntries(groupByTab(panes, tabs), ''), prompts, marks, null), [panes, tabs, prompts, marks]);
  const shown = useMemo(
    () => ring.filter((e) => matchesQuery(`${e.group.title} ${paneLabel(e.pane)} ${e.pane.projectName} ${summaryOf(prompts[e.pane.id])}`, query)),
    [ring, prompts, query],
  );

  const rows = useMemo<PaletteRow[]>(
    () =>
      shown.map(({ pane, group }) => ({
        key: String(pane.id),
        tint: tabTint(group.color),
        prefix: group.title,
        title: paneLabel(pane),
        subtitle: summaryOf(prompts[pane.id]) || pane.projectName,
        badge: paneBadge(pane, prompts[pane.id]),
        badgeColor: pane.awaiting ? colors.status.awaiting : colors.accent.primary,
      })),
    [shown, prompts],
  );

  const open = (paneId: number) => {
    const entry = ring.find((e) => e.pane.id === paneId);
    if (!entry) return;
    impact(ImpactStyle.Light);
    router.replace(paneHref(entry.pane));
  };

  return (
    <View style={styles.screen}>
      <View style={styles.palette}>
        <Palette
          title={t.panesUnreadTitle}
          placeholder={t.panesUnreadPlaceholder}
          rows={rows}
          query={query}
          onQuery={setQuery}
          onPick={(row) => open(Number(row.key))}
          emptyTitle={t.panesUnreadEmpty}
          emptyBody={t.panesUnreadEmptyBody}
          accessibilityLabel={t.panesUnreadPlaceholder}
        />
      </View>
      {ring.length > 0 ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space[3] }]}>
          <Button icon="skip-forward" label={t.startReview} onPress={() => open(ring[0]?.pane.id ?? -1)} />
        </View>
      ) : null}
    </View>
  );
}

function summaryOf(prompt: ReturnType<typeof usePrompts.getState>['byPane'][number] | undefined): string {
  if (!prompt) return '';
  if (prompt.state === 'turn_end') return prompt.summary;
  if (prompt.state === 'parsed') return prompt.question;
  return '';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  palette: { flex: 1 },
  bottomBar: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[3],
    backgroundColor: colors.bg.base,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
});
