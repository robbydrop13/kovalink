// Feuille « Rename » : deux renommages clairement distingués. Le nom d'ONGLET (Kova,
// `set-tab-title`, visible dans la barre d'onglets du Mac) et le nom de SESSION au sens
// Claude (`/rename <name>`, tapé par le daemon via KeyGate), qui survit à la fermeture et à
// la reprise. Chaque champ est pré-rempli avec la valeur courante et a son propre bouton.
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n/en';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Banner } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { groupByTab } from '@/features/sessions/tabGroups';
import { postSessionName, postTitle } from '@/net/http';
import { usePanes } from '@/store/panes';
import { ImpactStyle, impact } from '@/utils/haptics';

export default function RenameScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ paneId: string }>();
  const paneId = Number(params.paneId);
  const panes = usePanes((s) => s.panes);
  const tabs = usePanes((s) => s.tabs);
  const pane = panes.find((p) => p.id === paneId);
  const group = useMemo(() => groupByTab(panes, tabs).find((g) => g.panes.some((p) => p.id === paneId)), [panes, tabs, paneId]);

  const [tabTitle, setTabTitle] = useState(group?.tabId !== null && group?.tabId !== undefined ? group.title : '');
  const [sessionName, setSessionName] = useState(pane?.agent_session_name ?? '');
  const [busy, setBusy] = useState<'tab' | 'session' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const renameTab = async () => {
    setBusy('tab');
    try {
      const res = await postTitle(paneId, tabTitle.trim().length === 0 ? null : tabTitle.trim());
      impact(ImpactStyle.Light);
      setNotice({ tone: 'info', text: t.renameTabDone(res.title) });
    } catch (e) {
      setNotice({ tone: 'error', text: t.renameFailed(e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(null);
    }
  };

  const renameSession = async () => {
    if (pane?.agent !== 'claude') {
      setNotice({ tone: 'error', text: t.renameSessionNeedsClaude });
      return;
    }
    setBusy('session');
    try {
      const res = await postSessionName(paneId, sessionName.trim());
      if (!res.applied) {
        setNotice({ tone: 'error', text: res.reason === 'became_awaiting' ? t.renameSessionRefused : t.renameFailed(res.reason ?? '') });
        return;
      }
      impact(ImpactStyle.Light);
      setNotice({ tone: 'info', text: t.renameSessionSent(res.name) });
    } catch (e) {
      setNotice({ tone: 'error', text: t.renameFailed(e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[3] }]}>
      <View style={styles.header}>
        <Txt variant="title2" color={colors.text.primary}>
          {t.renameTitle}
        </Txt>
        <View style={styles.grow} />
        <LinkAction icon="x" label={t.actionClose} onPress={() => router.back()} />
      </View>
      {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}>
        {pane ? (
          <Txt variant="footnote" color={colors.text.tertiary}>
            {pane.projectName} · {pane.cwd}
          </Txt>
        ) : null}

        <View style={styles.field}>
          <Txt variant="calloutStrong" color={colors.text.primary}>
            {t.renameTabLabel}
          </Txt>
          <TextInput
            style={styles.input}
            value={tabTitle}
            onChangeText={setTabTitle}
            autoFocus
            autoCorrect={false}
            clearButtonMode="while-editing"
            keyboardAppearance="dark"
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={() => void renameTab()}
            accessibilityLabel={t.renameTabLabel}
          />
          <Txt variant="caption" color={colors.text.tertiary}>
            {t.renameTabHint}
          </Txt>
          <Button icon="edit-2" kind="secondary" height={48} label={t.renameTabButton} disabled={busy !== null} onPress={() => void renameTab()} />
        </View>

        <View style={styles.field}>
          <Txt variant="calloutStrong" color={colors.text.primary}>
            {t.renameSessionLabel}
          </Txt>
          <TextInput
            style={styles.input}
            value={sessionName}
            onChangeText={setSessionName}
            autoCorrect={false}
            clearButtonMode="while-editing"
            keyboardAppearance="dark"
            maxLength={60}
            returnKeyType="done"
            editable={pane?.agent === 'claude'}
            onSubmitEditing={() => void renameSession()}
            accessibilityLabel={t.renameSessionLabel}
          />
          <Txt variant="caption" color={colors.text.tertiary}>
            {t.renameSessionHint}
          </Txt>
          <Button
            icon="edit-2"
            height={48}
            label={t.renameSessionButton}
            disabled={busy !== null || pane?.agent !== 'claude' || sessionName.trim().length === 0}
            onPress={() => void renameSession()}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  header: { height: layout.navBarHeight, flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPaddingH },
  grow: { flex: 1 },
  content: { paddingHorizontal: layout.screenPaddingH, gap: space[7], paddingTop: space[3] },
  field: { gap: space[3] },
  input: {
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    color: colors.text.primary,
    fontSize: 16,
  },
});
