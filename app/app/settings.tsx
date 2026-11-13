// Réglages : QUATRE entrées interactives, plus un bloc `Activité` de cinq lignes en lecture
// seule et un pied de version. Chaque réglage exposé est une décision que le concepteur n'a
// pas su prendre : tout le reste est en dur.
//
// `Muter` n'existe pas (C31). `Extraits dans les notifications` n'existe pas (C28) : la NSE
// récupère toujours la question sur le canal chiffré direct, donc la charge utile n'a jamais
// besoin de contenu sensible.
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Txt } from '@/ui/Txt';
import { LINK_LABEL, useConnection } from '@/store/connection';
import { usePrefs } from '@/store/prefs';
import { usePanes } from '@/store/panes';
import { activeHostId, clearCredentials } from '@/store/credentials';
import { kvClear } from '@/db';
import { republishPrefs, stopConnection } from '@/net/connection';
import { removeHostFlow } from '@/net/hostSwitch';
import { HostList } from '@/features/hosts/HostList';
import { changeAutoSwitch } from '@/features/hosts/failoverWatch';
import { useFailover } from '@/store/failover';
import { markUnpaired } from '@/boot';
import { clockTime } from '@/utils/time';
import { PUSH_UNAVAILABLE_LABEL, pushAvailable } from '@/env';
import { Banner } from '@/ui/States';
import { t } from '@/i18n/en';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs((s) => s.prefs);
  const counters = usePrefs((s) => s.counters);
  const setPref = usePrefs((s) => s.setPref);
  const link = useConnection((s) => s.link);
  const latency = useConnection((s) => s.latencyMs);
  const daemonVersion = useConnection((s) => s.daemonVersion);
  const hostCount = useConnection((s) => s.hostCount);
  const autoSwitch = useFailover((s) => s.autoSwitch);
  const [revoking, setRevoking] = useState(false);

  const revoke = () => {
    Alert.alert(
      t.settingsRevokeConfirmTitle,
      t.settingsRevokeConfirmBody,
      [
        { text: t.settingsRevokeConfirmCancel, style: 'cancel' },
        {
          text: t.settingsRevokeConfirmAction,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setRevoking(true);
              // Révoquer, c'est retirer le Mac actif : avec un seul Mac, retour à
              // l'appairage comme avant ; avec plusieurs, l'app repart sur le suivant.
              let outcome: 'unpaired' | 'reloading' | 'removed' = 'unpaired';
              try {
                const id = await activeHostId();
                if (id) outcome = await removeHostFlow(id);
              } catch (error) {
                // Trousseau en échec : on le dit, on n'efface pas les autres Macs à l'aveugle.
                setRevoking(false);
                Alert.alert(t.settingsRevokeFailed(error instanceof Error ? error.message : String(error)));
                return;
              }
              if (outcome === 'unpaired') {
                stopConnection();
                await clearCredentials();
                await kvClear();
                usePanes.getState().reset();
                markUnpaired();
              }
              setRevoking(false);
              if (outcome === 'unpaired') router.replace('/pair');
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <LinkAction icon="chevron-left" label={t.settingsBack} onPress={() => router.back()} />
        <View style={styles.grow} />
        <Txt variant="title2" color={colors.text.primary}>
          {t.settingsTitle}
        </Txt>
        <View style={styles.grow} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}>
        <Section title={t.settingsSectionNotifications} />
        {/* Les deux réglages ci dessous restent modifiables : ils sont transmis au daemon et
            reprendront effet dès qu'un build remplacera Expo Go. */}
        {!pushAvailable ? <Banner text={PUSH_UNAVAILABLE_LABEL} /> : null}
        <Row
          title={t.settingsOnlyValidations}
          subtitle={t.settingsOnlyValidationsHint}
          value={prefs.onlyValidations}
          onChange={(v) => {
            setPref('onlyValidations', v);
            republishPrefs();
          }}
        />
        <Row
          title={t.settingsQuietHours}
          subtitle={t.settingsQuietHoursHint}
          value={prefs.quietHours}
          onChange={(v) => {
            setPref('quietHours', v);
            republishPrefs();
          }}
        />

        <Section title={t.settingsSectionMac} />
        <HostList />
        {hostCount > 1 ? (
          <Row
            title={t.settingsAutoFailover}
            subtitle={t.settingsAutoFailoverHint}
            value={autoSwitch}
            // Réglage de l'iPhone, global à tous les Macs : il survit au rechargement d'une bascule.
            onChange={(v) => void changeAutoSwitch(v)}
          />
        ) : null}
        <Row
          title={t.settingsKeepMacAwake}
          subtitle={t.settingsKeepMacAwakeHint}
          value={prefs.keepMacAwake}
          onChange={(v) => {
            // Transmis au daemon comme les deux autres : c'est lui qui tient l'assertion
            // anti-veille, un réglage qui reste sur l'iPhone n'agit sur rien (CA-126).
            setPref('keepMacAwake', v);
            republishPrefs();
          }}
        />
        <Row
          title={t.settingsFollowOnMac}
          subtitle={t.settingsFollowOnMacHint}
          value={prefs.followOnMac}
          // Réglage local à l'iPhone : l'app décide d'émettre ou non `focus-pane`.
          onChange={(v) => setPref('followOnMac', v)}
        />

        <Section title={t.settingsSectionSecurity} />
        <View style={styles.card}>
          <Button
            label={revoking ? t.settingsRevoking : t.settingsRevoke}
            kind="destructive"
            height={48}
            disabled={revoking}
            onPress={revoke}
          />
        </View>

        <Section title={t.settingsSectionActivity} />
        <View style={styles.card}>
          <ReadRow
            label={t.settingsLink}
            value={
              (link === 'direct' || link === 'relayed') && latency !== null
                ? t.settingsLinkLatency(LINK_LABEL[link], latency)
                : LINK_LABEL[link]
            }
          />
          <ReadRow
            label={t.settingsLastNotification}
            value={clockTime(counters.lastNotificationAt)}
          />
          <ReadRow label={t.settingsNotificationsToday} value={String(counters.notificationsToday)} />
          <ReadRow label={t.settingsParseFailed} value={String(counters.parseFailed)} />
          <ReadRow label={t.settingsNseFailed} value={String(counters.nseFailed)} />
        </View>

        {/* Les cinq lignes ci dessus sont locales à l'iPhone. Le journal complet, lui, vit
            sur le Mac : une ligne par lecture et par écriture, 30 jours (PRD C7). */}
        <View style={styles.card}>
          <Button
            label={t.settingsFileAccessLog}
            kind="secondary"
            height={48}
            onPress={() => router.push('/activity')}
          />
        </View>

        <Txt variant="footnote" color={colors.text.tertiary} style={styles.version}>
          {/* La version de Kova n'est PAS affichée : Kova n'expose aucune commande de
              version (V3), donc le protocole ne la transporte pas. Une ligne qui affiche
              « inconnu » pour toujours se lit comme une panne, alors que rien n'est cassé. */}
          {t.settingsVersion(Constants.expoConfig?.version ?? '1.0.0', daemonVersion ?? t.settingsVersionUnknown)}
        </Txt>
      </ScrollView>
    </View>
  );
}

function Section({ title }: { title: string }) {
  return (
    <Txt variant="caption" color={colors.text.tertiary} style={styles.section}>
      {title}
    </Txt>
  );
}

function Row({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.rowHead}>
        <Txt variant="body" color={colors.text.primary} style={styles.grow}>
          {title}
        </Txt>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ true: colors.accent.primary, false: colors.bg.pressed }}
          accessibilityLabel={title}
        />
      </View>
      <Txt variant="footnote" color={colors.text.secondary}>
        {subtitle}
      </Txt>
    </View>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readRow}>
      <Txt variant="callout" color={colors.text.secondary}>
        {label}
      </Txt>
      <View style={styles.grow} />
      <Txt variant="callout" color={colors.text.primary}>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  nav: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingH,
  },
  content: { paddingHorizontal: layout.screenPaddingH },
  section: { marginTop: space[6], marginBottom: space[3], letterSpacing: 0.6 },
  card: {
    gap: space[3],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: colors.bg.raised,
    marginBottom: space[3],
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  readRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  version: { marginTop: space[5] },
  grow: { flex: 1 },
});
