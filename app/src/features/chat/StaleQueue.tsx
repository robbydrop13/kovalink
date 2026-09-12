// Textes en file depuis plus de 15 min (CA-122). Ils ne partent pas tout seuls et ne sont
// pas jetés en silence : chacun est montré avec son âge, et Robin choisit, `Envoyer` ou
// `Abandonner`. La confirmation se prend devant le transcript, ce qui est la seule façon de
// savoir si le message a encore un sens après une aussi longue coupure.
import { StyleSheet, View } from 'react-native';
import type { OutboxJob } from '@/db/outbox';
import { colors, space } from '@/theme';
import { LinkAction } from '@/ui/Button';
import { Txt } from '@/ui/Txt';
import { shortAgeMs } from '@/utils/time';

interface Props {
  jobs: OutboxJob[];
  now: number;
  onSend: (job: OutboxJob) => void;
  onDiscard: (job: OutboxJob) => void;
}

/**
 * Le texte entre guillemets, et le nombre de pièces jointes s'il y en a (docs/15) : un
 * message fait d'une photo seule n'affiche pas « » vide. Les pièces suivent la même règle
 * que le texte, `Envoyer` les téléverse puis envoie, `Abandonner` retire le tout.
 */
function labelOf(job: OutboxJob): string {
  const text = String(job.payload.text ?? '').trim();
  const pieces = Array.isArray(job.payload.attachments) ? job.payload.attachments.length : 0;
  const parts: string[] = [];
  if (text.length > 0) parts.push(`« ${text} »`);
  if (pieces > 0) parts.push(pieces === 1 ? '1 pièce jointe' : `${pieces} pièces jointes`);
  return parts.join(' · ');
}

export function StaleQueue({ jobs, now, onSend, onDiscard }: Props) {
  if (jobs.length === 0) return null;
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Txt variant="footnote" color={colors.text.secondary}>
        {jobs.length === 1
          ? 'Ce message attend depuis plus de 15 min. L’envoyer quand même ?'
          : `${jobs.length} messages attendent depuis plus de 15 min. Les envoyer quand même ?`}
      </Txt>
      {jobs.map((job) => (
        <View key={job.nonce} style={styles.row}>
          <Txt variant="footnote" color={colors.text.primary} numberOfLines={2} style={styles.text}>
            {`${labelOf(job)} · ${shortAgeMs(now - job.createdAt)}`}
          </Txt>
          <LinkAction label="Envoyer" onPress={() => onSend(job)} />
          <LinkAction label="Abandonner" color={colors.status.error} onPress={() => onDiscard(job)} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    backgroundColor: colors.bg.raised,
    borderLeftWidth: 3,
    borderLeftColor: colors.link.macUnreachable,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  text: { flex: 1 },
});
