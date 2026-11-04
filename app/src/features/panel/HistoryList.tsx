// « Recently opened » : ce que le panneau de Kova a ouvert sur le Mac et ce que celui du
// telephone a ouvert, fusionnes par cible, le plus recent d'abord, 50 au plus. Un tap
// rouvre l'entree dans le panneau. Une fiche dont la question n'existe plus est grisee :
// il n'y a plus rien a y repondre.
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import type { PanelHistoryEntry } from '@/protocol';
import { t } from '@/i18n/en';
import { colors, layout, space } from '@/theme';
import { Icon, type IconName } from '@/ui/Icon';
import { Banner, EmptyState } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { fetchPanelHistory } from '@/net/http';
import { useAsks } from '@/store/asks';
import { usePanelHistory } from '@/store/panelHistory';
import { describe } from '@/store/transfers';
import { shortAgeMs } from '@/utils/time';
import { entryDetail, entryName, mergeHistory } from './history';
import { macHome } from './open';
import type { PanelTarget } from './target';

const ICONS: Record<PanelHistoryEntry['kind'], IconName> = {
  web: 'globe',
  markdown: 'file-text',
  html: 'code',
  sheet: 'check-square',
};

export function HistoryList({ onOpen }: { onOpen: (target: PanelTarget) => void }) {
  const phone = usePanelHistory((s) => s.entries);
  const asks = useAsks((s) => s.asks);
  const [mac, setMac] = useState<PanelHistoryEntry[]>([]);
  const [macError, setMacError] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    void usePanelHistory.getState().hydrate();
    fetchPanelHistory().then(
      (res) => {
        if (alive) setMac(res.entries);
      },
      (e: unknown) => {
        if (alive) setMacError(t.panelHistoryMacFailed(describe(e)));
      },
    );
    void macHome().then((h) => {
      if (alive) setHome(h);
    });
    return () => {
      alive = false;
    };
  }, []);

  const entries = mergeHistory(mac, phone);
  const waiting = new Set(asks.map((a) => a.id));

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.target}
      contentContainerStyle={styles.list}
      ListHeaderComponent={macError ? <Banner tone="warn" text={macError} /> : null}
      ListEmptyComponent={
        <EmptyState icon="clock" title={t.panelHistoryEmptyTitle} body={t.panelHistoryEmptyBody} />
      }
      renderItem={({ item }) => {
        const closed = item.kind === 'sheet' && !waiting.has(item.target);
        const name = entryName(item);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closed ? `${name}, ${t.panelClosed}` : name}
            accessibilityState={{ disabled: closed }}
            disabled={closed}
            onPress={() => onOpen({ kind: item.kind, target: item.target })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed, closed && styles.closed]}
          >
            <Icon name={ICONS[item.kind]} size={20} color={closed ? colors.text.disabled : colors.text.secondary} />
            <View style={styles.text}>
              <Txt variant="callout" color={closed ? colors.text.disabled : colors.text.primary} numberOfLines={1}>
                {name}
              </Txt>
              <Txt variant="footnote" color={colors.text.tertiary} numberOfLines={1}>
                {closed ? `${entryDetail(item, home)} · ${t.panelClosed}` : entryDetail(item, home)}
              </Txt>
            </View>
            {item.openedAtMs > 0 ? (
              <Txt variant="caption" color={colors.text.tertiary}>
                {shortAgeMs(Math.max(0, now - item.openedAtMs))}
              </Txt>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: space[8] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  closed: { opacity: 0.6 },
  text: { flex: 1, gap: 2 },
});
