// Liste des Macs appairés, en tête de la section MAC des Réglages. Pour chacun : son nom,
// s'il est utilisé, s'il répond (`/health`, sans jeton), et deux gestes, `Use` et `Remove`.
// Tout l'état est dit en texte : la couleur seule ne distingue rien pour Robin.
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { colors, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Txt } from '@/ui/Txt';
import { activeHostId, listHosts, type HostEntry } from '@/store/credentials';
import { useConnection } from '@/store/connection';
import { health } from '@/net/http';
import { DEFAULT_PORT } from '@/protocol';
import { removeHostFlow, switchHost } from '@/net/hostSwitch';
import { bootWarn } from '@/env';
import { t } from '@/i18n/en';

/** Absent du dictionnaire : la sonde `/health` n'a pas encore répondu. */
type Reach = 'up' | 'down';

export function HostList() {
  const [hosts, setHosts] = useState<HostEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [reach, setReach] = useState<Record<string, Reach>>({});
  const [busy, setBusy] = useState(false);

  // Relue au focus (retour de « Add a Mac ») et après un retrait. `alive` écarte une
  // réponse arrivée après que l'écran a perdu le focus.
  const refresh = useCallback(async (alive: () => boolean) => {
    try {
      const [list, current] = await Promise.all([listHosts(), activeHostId()]);
      if (!alive()) return;
      setHosts(list);
      setActive(current);
      const me = list.find((h) => h.id === current);
      useConnection.getState().setHost(me?.name ?? null, list.length, me?.role ?? null);
      setReach({});
      for (const h of list) {
        void health({ tsDns: h.id, port: h.port || DEFAULT_PORT })
          .catch(() => false)
          .then((ok) => {
            if (alive()) setReach((r) => ({ ...r, [h.id]: ok ? 'up' : 'down' }));
          });
      }
    } catch (error) {
      bootWarn('hosts list', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void refresh(() => alive);
      return () => {
        alive = false;
      };
    }, [refresh]),
  );

  const use = (h: HostEntry) => {
    Alert.alert(t.settingsHostSwitchTitle(h.name), t.settingsHostSwitchBody, [
      { text: t.settingsRevokeConfirmCancel, style: 'cancel' },
      {
        text: t.settingsHostSwitchAction,
        onPress: () => {
          setBusy(true);
          switchHost(h.id).catch((error: unknown) => {
            setBusy(false);
            Alert.alert(t.settingsHostSwitchFailed(error instanceof Error ? error.message : String(error)));
          });
        },
      },
    ]);
  };

  const remove = (h: HostEntry) => {
    Alert.alert(t.settingsHostRemoveTitle(h.name), t.settingsHostRemoveBody, [
      { text: t.settingsRevokeConfirmCancel, style: 'cancel' },
      {
        text: t.settingsHostRemoveAction,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              const outcome = await removeHostFlow(h.id);
              if (outcome === 'unpaired') router.replace('/pair');
              else if (outcome === 'removed') await refresh(() => true);
            } catch (error) {
              bootWarn('remove Mac', error);
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <View style={styles.card}>
      {hosts.map((h) => {
        const isActive = h.id === active;
        const state = ([
          isActive ? t.settingsHostActive : null,
          h.role === 'secondary' ? t.settingsHostRoleSecondary : null,
          reach[h.id] === 'up'
            ? t.settingsHostReachable
            : reach[h.id] === 'down'
              ? t.settingsHostUnreachable
              : t.settingsHostChecking,
        ] as (string | null)[])
          .filter((s): s is string => s !== null)
          .join(' · ');
        return (
          <View
            key={h.id}
            style={styles.row}
            accessible
            accessibilityLabel={t.settingsHostAccessibility(h.name, state)}
          >
            <View style={styles.grow}>
              <Txt variant="body" color={colors.text.primary} numberOfLines={1}>
                {h.name}
              </Txt>
              <Txt variant="footnote" color={colors.text.secondary} numberOfLines={1}>
                {state}
              </Txt>
            </View>
            {isActive ? null : (
              <Button
                label={t.settingsHostUse}
                kind="secondary"
                height={36}
                disabled={busy}
                onPress={() => use(h)}
              />
            )}
            <LinkAction
              label={t.settingsHostRemove}
              color={colors.status.error}
              disabled={busy}
              onPress={() => remove(h)}
            />
          </View>
        );
      })}
      <LinkAction icon="plus" label={t.settingsHostAdd} disabled={busy} onPress={() => router.push('/pair?add=1')} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: colors.bg.raised,
    marginBottom: space[3],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4], minHeight: 44 },
  grow: { flex: 1 },
});
