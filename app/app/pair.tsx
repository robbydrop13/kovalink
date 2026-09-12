// Appairage. Objectif : appairé et opérationnel en moins de 60 secondes, sans saisir un seul
// caractère.
//
// Le QR porte UNE SEULE adresse, le nom MagicDNS (A11 supprime l'écouteur LAN), et AUCUNE
// empreinte de certificat : la chaîne de confiance système valide le certificat obtenu par
// `tailscale cert` (A12). L'étape s'appelle donc `Certificat valide`, pas
// `Certificat épinglé`, et il n'existe aucun bouton pour passer outre.
import { useCallback, useEffect, useState, useRef } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { NotifyType, notify } from '@/utils/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Txt } from '@/ui/Txt';
import { baseUrl, health, HttpError, pairClaim } from '@/net/http';
import {
  decodePairPayload,
  DEFAULT_PORT,
  PAIRING_PAYLOAD_VERSION,
  type PairPayload,
} from '@/protocol';
import { saveCredentials } from '@/store/credentials';
import { startConnection } from '@/net/connection';
import { setupNotifications } from '@/notifications/register';
import { shortAgeMs } from '@/utils/time';
import { PUSH_UNAVAILABLE_LABEL, bootLog, bootWarn, pushAvailable } from '@/env';
import { markPaired } from '@/boot';
import { t } from '@/i18n/en';

type Step = 'welcome' | 'scan' | 'manual' | 'verify' | 'done';
type CheckState = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';

interface Checks {
  reachable: CheckState;
  certificate: CheckState;
  token: CheckState;
  notifications: CheckState;
}

const EMPTY: Checks = {
  reachable: 'pending',
  certificate: 'pending',
  token: 'pending',
  notifications: 'pending',
};

/**
 * Le QR porte le format defini dans `@kovalink/protocol`. On ne le reinterprete pas ici :
 * cette divergence est precisement ce qui rendait l'appairage impossible.
 */
function parsePayload(raw: string): PairPayload | null {
  return decodePairPayload(raw);
}

/**
 * Nom de l'appareil tel qu'il s'affiche sur le Mac. `expo-constants` expose le nom que
 * l'utilisateur a donné à son iPhone ; à défaut (simulateur, valeur vide), un repli neutre.
 */
function deviceName(): string {
  const name = Constants.deviceName;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : t.pairDefaultDeviceName;
}

export default function PairScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>('welcome');
  const [checks, setChecks] = useState<Checks>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [macName, setMacName] = useState('');
  const [manualHost, setManualHost] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [relay, setRelay] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);

  useEffect(() => {
    if (expiresIn === null) return;
    const timer = setInterval(() => setExpiresIn((v) => (v === null ? null : v - 1000)), 1000);
    return () => clearInterval(timer);
  }, [expiresIn]);

  // Verrou d'unicite. `onBarcodeScanned` se declenche en continu tant que le QR est dans le
  // cadre : sans ce verrou, deux reclamations partaient a 21 ms d'intervalle, la seconde
  // echouait sur un code deja consomme, et c'est son erreur qui s'affichait alors que
  // l'appairage venait de reussir. Le code d'appairage est a usage unique par conception.
  const claiming = useRef(false);

  const run = useCallback(async (payload: PairPayload) => {
    if (claiming.current) return;
    claiming.current = true;
    setStep('verify');
    setError(null);
    setChecks({ ...EMPTY, reachable: 'running' });
    setMacName(payload.name ?? payload.tsDns);

    if (payload.exp) {
      const remaining = payload.exp - Date.now();
      setExpiresIn(remaining);
      if (Number.isFinite(remaining) && remaining <= 0) {
        setChecks({ ...EMPTY, reachable: 'failed' });
        setError(t.pairCodeExpired);
        claiming.current = false;
        return;
      }
    }

    const target = { tsDns: payload.tsDns, port: payload.port };

    // `Mac trouvé` et `Certificat valide` sont vérifiés par le même appel : si la chaîne
    // système refusait le certificat, `fetch` échouerait avant toute réponse.
    try {
      const ok = await health(target);
      if (!ok) throw new Error(t.pairHealthNotOk);
      setChecks((c) => ({ ...c, reachable: 'ok', certificate: 'ok', token: 'running' }));
    } catch (error) {
      setChecks((c) => ({ ...c, reachable: 'failed' }));
      // L'URL tentee ET la cause reelle. Un « Mac injoignable » nu a deja coute deux heures
      // alors que le Mac repondait parfaitement : le message doit permettre de trancher
      // entre un probleme de reseau, de nom, de port et de certificat.
      bootWarn('health unreachable', error);
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      setError(t.pairUnreachable(`${baseUrl(target)}/health`, detail));
      claiming.current = false;
      return;
    }

    try {
      const result = await pairClaim(target, payload.code, deviceName());
      await saveCredentials({
        deviceId: result.deviceId,
        token: result.token,
        nseToken: result.nseToken ?? null,
        tsDns: result.tsDns,
        port: result.port,
      });
      // L'appareil est appairé dès cet instant : l'état de démarrage doit suivre, sinon
      // l'écran Sessions renverrait vers l'appairage qu'on vient de terminer.
      markPaired();
      setChecks((c) => ({ ...c, token: 'ok', notifications: 'running' }));
    } catch (error) {
      setChecks((c) => ({ ...c, token: 'failed' }));
      // Le message exact, jamais un libelle generique : sans lui, le diagnostic est aveugle.
      bootWarn('pairing refused', error);
      const detail =
        error instanceof HttpError
          ? `${error.status} ${error.code} ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      setError(t.pairRefused(detail));
      claiming.current = false;
      return;
    }

    // Aucune de ces deux étapes ne peut faire échouer un appairage déjà accepté par le
    // daemon : le jeton est en trousseau, l'app est appairée. Elles sont donc protégées.
    try {
      await startConnection();
    } catch (error) {
      bootWarn('connection after pairing', error);
    }

    try {
      const notif = await setupNotifications();
      setChecks((c) => ({
        ...c,
        // `unavailable` n'est pas un échec : c'est Expo Go, où le push distant n'existe pas.
        notifications: notif === 'granted' ? 'ok' : notif === 'unavailable' ? 'skipped' : 'failed',
      }));
    } catch (error) {
      bootWarn('notifications after pairing', error);
      setChecks((c) => ({ ...c, notifications: 'failed' }));
    }
    bootLog('pairing done');
    setRelay(null);
    notify(NotifyType.Success);
    setStep('done');
  }, []);

  if (step === 'welcome') {
    return (
      <ScrollView contentContainerStyle={[styles.screen, { paddingTop: insets.top + space[9] }]}>
        <Txt variant="display" color={colors.text.primary}>
          {t.pairAppName}
        </Txt>
        <Txt variant="body" color={colors.text.secondary}>
          {t.pairTagline}
        </Txt>
        <View style={styles.steps}>
          <Txt variant="callout" color={colors.text.secondary}>
            {t.pairStep1}
          </Txt>
          <Txt variant="callout" color={colors.text.secondary}>
            {t.pairStep2}
          </Txt>
          <Txt variant="callout" color={colors.text.secondary}>
            {t.pairStep3}
          </Txt>
        </View>
        <Button
          label={t.pairScanButton}
          onPress={() => {
            void (async () => {
              if (!permission?.granted) await requestPermission();
              setStep('scan');
            })();
          }}
        />
        <LinkAction label={t.pairManualLink} onPress={() => setStep('manual')} />
      </ScrollView>
    );
  }

  if (step === 'scan') {
    if (!permission?.granted) {
      return (
        <View style={[styles.screen, { paddingTop: insets.top + space[9] }]}>
          <Txt variant="title2" color={colors.text.primary}>
            {t.pairCameraDeniedTitle}
          </Txt>
          <Txt variant="callout" color={colors.text.secondary}>
            {t.pairCameraDeniedBody}
          </Txt>
          <Button label={t.pairManualLink} onPress={() => setStep('manual')} />
        </View>
      );
    }
    return (
      <View style={styles.cameraScreen}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            const payload = parsePayload(data);
            if (!payload) return;
            notify(NotifyType.Success);
            void run(payload);
          }}
        />
        <View style={[styles.cameraOverlay, { paddingTop: insets.top }]}>
          <LinkAction label={t.pairCancel} color={colors.text.onFill} onPress={() => setStep('welcome')} />
          <View style={styles.viewfinder} />
          <Txt variant="callout" color={colors.text.onFill} align="center">
            {t.pairScanHint}
          </Txt>
          <LinkAction
            label={t.pairManualLink}
            color={colors.text.onFill}
            onPress={() => setStep('manual')}
          />
        </View>
      </View>
    );
  }

  if (step === 'manual') {
    return (
      <ScrollView contentContainerStyle={[styles.screen, { paddingTop: insets.top + space[9] }]}>
        <Txt variant="title1" color={colors.text.primary}>
          {t.pairManualTitle}
        </Txt>
        <TextInput
          style={styles.input}
          value={manualHost}
          onChangeText={setManualHost}
          placeholder={t.pairManualHostPlaceholder}
          placeholderTextColor={colors.text.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="ascii-capable"
          keyboardAppearance="dark"
        />
        <TextInput
          style={styles.input}
          value={manualCode}
          onChangeText={setManualCode}
          placeholder={t.pairManualCodePlaceholder}
          placeholderTextColor={colors.text.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="ascii-capable"
          keyboardAppearance="dark"
        />
        <Button
          label={t.pairButton}
          disabled={manualHost.trim().length === 0 || manualCode.trim().length === 0}
          onPress={() =>
            void run({
              v: PAIRING_PAYLOAD_VERSION,
              code: manualCode.replace(/\s+/g, ''),
              tsDns: manualHost.trim(),
              port: DEFAULT_PORT,
              name: manualHost.trim(),
            })
          }
        />
        <LinkAction label={t.pairBackToScan} onPress={() => setStep('scan')} />
      </ScrollView>
    );
  }

  if (step === 'verify') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + space[9] }]}>
        <Txt variant="title1" color={colors.text.primary}>
          {t.pairVerifyTitle}
        </Txt>
        {expiresIn !== null && expiresIn > 0 ? (
          <Txt variant="footnote" color={colors.text.tertiary}>
            {t.pairCodeExpiresIn(shortAgeMs(expiresIn))}
          </Txt>
        ) : null}
        <View style={styles.checklist}>
          <CheckRow label={t.pairCheckReachable} state={checks.reachable} />
          <CheckRow label={t.pairCheckCertificate} state={checks.certificate} />
          <CheckRow label={t.pairCheckToken} state={checks.token} />
          <CheckRow
            label={pushAvailable ? t.pairCheckNotifications : t.pairCheckNotificationsUnavailable}
            state={checks.notifications}
          />
        </View>
        {error ? (
          <View style={styles.errorBox}>
            <Txt variant="callout" color={colors.status.error}>
              {error}
            </Txt>
            <Button label={t.pairRescan} kind="secondary" onPress={() => setStep('scan')} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[9] }]}>
      <Txt variant="display" color={colors.status.success}>
        {t.pairDoneTitle}
      </Txt>
      <Txt variant="body" color={colors.text.primary}>
        {macName}
      </Txt>
      <Txt variant="callout" color={colors.text.secondary}>
        {relay ? t.pairDoneRelayed : t.pairDoneDirect}
      </Txt>
      {checks.notifications === 'skipped' || !pushAvailable ? (
        <Txt variant="footnote" color={colors.text.secondary}>
          {PUSH_UNAVAILABLE_LABEL} {t.pairDoneEverythingElseWorks}
        </Txt>
      ) : checks.notifications !== 'ok' ? (
        <Txt variant="footnote" color={colors.status.awaiting}>
          {t.pairDoneNotificationsDenied}
        </Txt>
      ) : null}
      <Button label={t.pairStart} onPress={() => router.replace('/')} />
    </View>
  );
}

function CheckRow({ label, state }: { label: string; state: CheckState }) {
  const mark =
    state === 'ok'
      ? 'v'
      : state === 'failed'
        ? '!'
        : state === 'running'
          ? '.'
          : state === 'skipped'
            ? '-'
            : ' ';
  const tint =
    state === 'ok'
      ? colors.status.success
      : state === 'failed'
        ? colors.status.error
        : colors.text.tertiary;
  return (
    <View style={styles.checkRow}>
      <Txt variant="calloutStrong" color={tint}>
        [{mark}]
      </Txt>
      <Txt variant="callout" color={state === 'pending' ? colors.text.tertiary : colors.text.primary}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    gap: space[5],
    paddingHorizontal: layout.screenPaddingH,
    backgroundColor: colors.bg.base,
  },
  steps: { gap: space[3], marginVertical: space[5] },
  cameraScreen: { flex: 1, backgroundColor: '#000000' },
  cameraOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: space[9],
  },
  viewfinder: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: colors.accent.primary,
    borderRadius: radius.lg,
  },
  input: {
    minHeight: 48,
    color: colors.text.primary,
    fontSize: 17,
    paddingHorizontal: space[5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.bg.inset,
  },
  checklist: { gap: space[4], marginVertical: space[6] },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space[4], minHeight: 32 },
  errorBox: { gap: space[4] },
});
