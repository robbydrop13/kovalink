// Transferts en cours, affichés là où ils ont été lancés.
//
// Une coupure réseau donne `en pause, reprise automatique`, JAMAIS `échec` : c'est la
// différence entre un utilisateur qui attend et un utilisateur qui recommence tout
// (design 4.7). L'échec définitif n'apparaît qu'après 3 tentatives, ou tout de suite
// quand le refus est définitif, et il porte alors la phrase exacte du daemon.
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { Txt } from '@/ui/Txt';
import { progressOf, useTransfers, type Transfer } from '@/store/transfers';
import { humanSize, truncateMiddle } from './format';

export function TransferList({ destDir }: { destDir?: string }) {
  const items = useTransfers((s) => s.items);
  const visible = items.filter(
    (t) => (destDir === undefined || t.destDir === destDir) && t.state !== 'canceled',
  );
  if (visible.length === 0) return null;
  return (
    <View style={styles.stack}>
      {visible.map((t) => (
        <TransferRow key={t.id} transfer={t} />
      ))}
    </View>
  );
}

function TransferRow({ transfer }: { transfer: Transfer }) {
  const cancel = useTransfers((s) => s.cancel);
  const remove = useTransfers((s) => s.remove);
  const resolveChoice = useTransfers((s) => s.resolveChoice);
  const ratio = progressOf(transfer);

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1}>
          {truncateMiddle(transfer.finalName ?? transfer.filename, 26)}
        </Txt>
        <View style={styles.grow} />
        <Txt variant="caption" color={colors.text.tertiary}>
          {humanSize(transfer.size)}
        </Txt>
      </View>

      <Txt variant="caption" color={colors.text.tertiary} numberOfLines={1}>
        vers {transfer.destLabel}
      </Txt>

      {transfer.state === 'awaiting-choice' ? (
        <View style={styles.choice}>
          {/* A4 : au delà de 100 Mo en cellulaire, le transfert ne part JAMAIS tout seul. */}
          <Txt variant="footnote" color={colors.text.secondary}>
            Fichier de {humanSize(transfer.size)} en données cellulaires.
          </Txt>
          <Button
            label="Envoyer maintenant"
            onPress={() => resolveChoice(transfer.id, 'now')}
          />
          <Button
            label="Attendre le Wi-Fi"
            kind="secondary"
            onPress={() => resolveChoice(transfer.id, 'wifi')}
          />
          <LinkAction label="Annuler" onPress={() => cancel(transfer.id)} />
        </View>
      ) : (
        <>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(ratio * 100)}%` },
                transfer.state === 'failed' && styles.fillError,
                transfer.state === 'done' && styles.fillDone,
              ]}
            />
          </View>
          <View style={styles.head}>
            <Txt variant="caption" color={statusColor(transfer.state)}>
              {statusLabel(transfer)}
            </Txt>
            <View style={styles.grow} />
            {transfer.state === 'done' || transfer.state === 'failed' ? (
              <LinkAction label="Masquer" onPress={() => remove(transfer.id)} />
            ) : (
              <LinkAction
                label="Annuler"
                color={colors.action.interrupt.text}
                onPress={() => cancel(transfer.id)}
              />
            )}
          </View>
        </>
      )}

      {/* Le message du daemon, mot pour mot. Il dit le chemin et le motif. */}
      {transfer.error && transfer.state === 'failed' ? (
        <Txt variant="footnote" color={colors.status.error}>
          {transfer.error}
        </Txt>
      ) : null}

      {transfer.renamed && transfer.finalName ? (
        <Txt variant="caption" color={colors.status.awaiting}>
          renommé en {transfer.finalName}, l’original n’a pas été touché
        </Txt>
      ) : null}
    </View>
  );
}

function statusLabel(t: Transfer): string {
  switch (t.state) {
    case 'queued':
      return 'en file';
    case 'waiting-wifi':
      return 'en attente du Wi-Fi';
    case 'running':
      if (t.phase === 'hashing') return 'Empreinte SHA-256…';
      return `${Math.round(progressOf(t) * 100)} % · ${humanSize(t.sentBytes)}`;
    case 'paused':
      // Jamais « échec » : la reprise est automatique, et le dire évite un geste inutile.
      return `en pause, reprise automatique (tentative ${t.attempts + 1})`;
    case 'done':
      return 'envoyé sur le Mac';
    case 'failed':
      return 'échec';
    default:
      return '';
  }
}

function statusColor(state: Transfer['state']): string {
  if (state === 'failed') return colors.status.error;
  if (state === 'done') return colors.status.success;
  if (state === 'paused' || state === 'waiting-wifi') return colors.status.awaiting;
  return colors.text.secondary;
}

const styles = StyleSheet.create({
  stack: { gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  row: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.bg.raised,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  choice: { gap: space[3], marginTop: space[2] },
  track: {
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.bg.inset,
    overflow: 'hidden',
    marginTop: space[2],
  },
  fill: { height: 3, backgroundColor: colors.accent.primary },
  fillError: { backgroundColor: colors.status.error },
  fillDone: { backgroundColor: colors.status.success },
});
