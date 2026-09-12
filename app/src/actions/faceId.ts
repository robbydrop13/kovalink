// Face ID. Asymétrique, sur le sens du risque (A2, A10).
//
// Approuver engage le disque entier : authentification obligatoire.
// Refuser et Interrompre sont les gestes sûrs : aucune authentification. Exiger Face ID sur
// le geste défensif pousse à approuver par facilité, ce qui est l'incitation inverse de
// celle qu'on veut.
import * as LocalAuthentication from 'expo-local-authentication';
import type { OptionKind } from '@/protocol';
import { t } from '@/i18n/en';

/** Table unique pour toute l'application. Aucune autre règle Face ID n'existe. */
export function optionRequiresFaceId(kind: OptionKind): boolean {
  switch (kind) {
    case 'approve':
    case 'approve_always':
      return true;
    case 'reject':
      return false;
    case 'neutral':
      // Nature inconnue : dans le doute, on protège.
      return true;
    default:
      return true;
  }
}

/**
 * Rend `true` si l'utilisateur s'est authentifié. Un échec ou une annulation rend `false`
 * sans message d'erreur : l'utilisateur sait ce qu'il vient de faire.
 */
export async function confirmWithFaceId(promptMessage: string): Promise<boolean> {
  try {
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      // Aucun biométrique configuré : le code de l'appareil sert de repli.
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage,
        disableDeviceFallback: false,
      });
      return res.success;
    }
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: t.actionCancel,
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}
