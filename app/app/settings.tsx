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
import { clearCredentials } from '@/store/credentials';
import { kvClear } from '@/db';
import { revokeDevice } from '@/net/http';
import { currentDeviceId, republishPrefs, stopConnection } from '@/net/connection';
import { markUnpaired } from '@/boot';
import { clockTime } from '@/utils/time';
import { PUSH_UNAVAILABLE_LABEL, pushAvailable } from '@/env';
import { Banner } from '@/ui/States';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs((s) => s.prefs);
  const counters = usePrefs((s) => s.counters);
  const setPref = usePrefs((s) => s.setPref);
  const link = useConnection((s) => s.link);
  const latency = useConnection((s) => s.latencyMs);
  const daemonVersion = useConnection((s) => s.daemonVersion);
  const [revoking, setRevoking] = useState(false);

  const revoke = () => {
    Alert.alert(
      'Révoquer l’appairage',
      'Le jeton est effacé de l’iPhone et invalidé sur le Mac, immédiatement. Le cache et la file d’attente sont effacés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Révoquer',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setRevoking(true);
              const deviceId = currentDeviceId();
              if (deviceId) {
                try {
                  await revokeDevice(deviceId);
                } catch {
                  // Le jeton local part quand même : l'iPhone est peut-être perdu.
                }
              }
              stopConnection();
              await clearCredentials();
              await kvClear();
              usePanes.getState().reset();
              markUnpaired();
              setRevoking(false);
              router.replace('/pair');
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <LinkAction label="< Sessions" onPress={() => router.back()} />
        <View style={styles.grow} />
        <Txt variant="title2" color={colors.text.primary}>
          Réglages
        </Txt>
        <View style={styles.grow} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}>
        <Section title="NOTIFICATIONS" />
        {/* Les deux réglages ci dessous restent modifiables : ils sont transmis au daemon et
            reprendront effet dès qu'un build remplacera Expo Go. */}
        {!pushAvailable ? <Banner text={PUSH_UNAVAILABLE_LABEL} /> : null}
        <Row
          title="Validations seulement"
          subtitle="Seules les demandes de validation sonnent. Les fins de tâche restent silencieuses. Désactivé par défaut."
          value={prefs.onlyValidations}
          onChange={(v) => {
            setPref('onlyValidations', v);
            republishPrefs();
          }}
        />
        <Row
          title="Heures calmes"
          subtitle="23h00 à 07h00. Dans la plage, seules les validations sonnent."
          value={prefs.quietHours}
          onChange={(v) => {
            setPref('quietHours', v);
            republishPrefs();
          }}
        />

        <Section title="MAC" />
        <Row
          title="Garder le Mac éveillé"
          subtitle="Tant qu’un agent travaille, 4 h max. Capot fermé sur batterie, la session est suspendue."
          value={prefs.keepMacAwake}
          onChange={(v) => {
            // Transmis au daemon comme les deux autres : c'est lui qui tient l'assertion
            // anti-veille, un réglage qui reste sur l'iPhone n'agit sur rien (CA-126).
            setPref('keepMacAwake', v);
            republishPrefs();
          }}
        />

        <Section title="SÉCURITÉ" />
        <View style={styles.card}>
          <Button
            label={revoking ? 'Révocation…' : 'Révoquer l’appairage'}
            kind="destructive"
            height={48}
            disabled={revoking}
            onPress={revoke}
          />
        </View>

        <Section title="ACTIVITÉ" />
        <View style={styles.card}>
          <ReadRow
            label="Liaison"
            value={
              (link === 'direct' || link === 'relayed') && latency !== null
                ? `${LINK_LABEL[link]} · ${latency} ms`
                : LINK_LABEL[link]
            }
          />
          <ReadRow
            label="Dernière notification livrée"
            value={clockTime(counters.lastNotificationAt)}
          />
          <ReadRow label="Notifications aujourd’hui" value={String(counters.notificationsToday)} />
          <ReadRow label="Questions illisibles (7 j)" value={String(counters.parseFailed)} />
          <ReadRow label="Bannières non récupérées (7 j)" value={String(counters.nseFailed)} />
        </View>

        {/* Les cinq lignes ci dessus sont locales à l'iPhone. Le journal complet, lui, vit
            sur le Mac : une ligne par lecture et par écriture, 30 jours (PRD C7). */}
        <View style={styles.card}>
          <Button
            label="Journal des accès fichiers"
            kind="secondary"
            height={48}
            onPress={() => router.push('/activity')}
          />
        </View>

        <Txt variant="footnote" color={colors.text.tertiary} style={styles.version}>
          {/* La version de Kova n'est PAS affichée : Kova n'expose aucune commande de
              version (V3), donc le protocole ne la transporte pas. Une ligne qui affiche
              « inconnu » pour toujours se lit comme une panne, alors que rien n'est cassé. */}
          App {Constants.expoConfig?.version ?? '1.0.0'} · daemon {daemonVersion ?? 'inconnu'}
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
