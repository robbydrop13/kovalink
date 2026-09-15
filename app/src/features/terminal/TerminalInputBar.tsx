// Barre de saisie de la vue Term : une rangée de touches (table fermée) et un champ dont le
// texte part suivi de l'Entrée. Sert le shell nu comme le pane Claude (écran de confiance :
// flèches puis Entrée). Hors ligne, tout est désactivé : l'écran affiché est un instantané.
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { KeyName } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { ImpactStyle, impact } from '@/utils/haptics';
import { t } from '@/i18n/en';
import { TERMINAL_KEYS, canSendLine } from './terminalKeys';

const KEY_HEIGHT = 34;
const SEND_SIZE = 36;

interface Props {
  enabled: boolean;
  /** Rend `true` si la ligne est partie : le champ se vide. Sinon il garde le texte. */
  onSendLine: (text: string) => Promise<boolean>;
  onKey: (key: KeyName) => void;
}

export function TerminalInputBar({ enabled, onSendLine, onKey }: Props) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const sendable = canSendLine(value, enabled, sending);

  const send = async (): Promise<void> => {
    if (!sendable) return;
    impact(ImpactStyle.Light);
    setSending(true);
    try {
      if (await onSendLine(value)) setValue('');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.keys}>
        {TERMINAL_KEYS.map((k) => (
          <Pressable
            key={k.key}
            accessibilityRole="button"
            accessibilityLabel={k.a11y}
            accessibilityState={{ disabled: !enabled }}
            disabled={!enabled}
            hitSlop={4}
            onPress={() => {
              impact(ImpactStyle.Light);
              onKey(k.key);
            }}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed, !enabled && styles.disabled]}
          >
            {k.icon ? (
              <Icon name={k.icon} size={16} color={colors.text.primary} />
            ) : (
              <Txt variant="caption" color={colors.text.primary}>
                {k.label}
              </Txt>
            )}
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <TextInput
          style={[styles.field, !enabled && styles.fieldDisabled]}
          value={value}
          onChangeText={setValue}
          editable={enabled}
          placeholder={enabled ? t.terminalInputPlaceholder : t.terminalInputOffline}
          placeholderTextColor={colors.text.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardAppearance="dark"
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={() => void send()}
          accessibilityLabel={t.terminalInputA11y}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.terminalSendA11y}
          accessibilityState={{ disabled: !sendable }}
          disabled={!sendable}
          hitSlop={6}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: sendable ? colors.accent.primary : colors.bg.pressed },
            pressed && styles.keyPressed,
          ]}
        >
          <Icon name="corner-down-left" size={16} color={sendable ? colors.text.onFill : colors.text.disabled} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bg.base,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: space[2],
    paddingBottom: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
    gap: space[2],
  },
  keys: { flexDirection: 'row', gap: space[2] },
  key: {
    flex: 1,
    height: KEY_HEIGHT,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  keyPressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  field: {
    flex: 1,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    color: colors.text.primary,
    fontFamily: 'Menlo',
    fontSize: 15,
    paddingHorizontal: space[3],
  },
  fieldDisabled: { color: colors.text.disabled },
  send: { width: SEND_SIZE, height: SEND_SIZE, borderRadius: SEND_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
});
