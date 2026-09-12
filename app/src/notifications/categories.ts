// Catégories de notification.
//
// EXIGENCE NON NÉGOCIABLE (C25) : elles sont pré-enregistrées STATIQUEMENT au lancement de
// l'app, une fois pour toutes, et la Notification Service Extension ne les réécrit JAMAIS.
// Ré-enregistrer une catégorie depuis une extension n'est pas une capacité documentée par
// Apple : si l'hypothèse est fausse, la bannière apparaît sans aucun bouton, en silence, sur
// le seul écran qui justifie le produit. La NSE réécrit uniquement le CORPS.
//
// Conséquence assumée : les boutons portent des chiffres, pas `Oui` et `Non`. C'est le corps
// réécrit par la NSE qui dit ce que fait chaque chiffre, et c'est ce que Robin lit avant de
// taper (P3).
//
// La TABLE ENTIÈRE vient du protocole partagé (`NOTIFICATION_CATEGORY_ACTIONS`), elle n'est
// pas redéclarée ici (R1). Elle existait en deux exemplaires, un par moitié du produit : une
// catégorie ajoutée côté daemon (l'agrégat du plafond horaire, CA-32) manquait ici.
import * as Notifications from 'expo-notifications';
import { NOTIFICATION_CATEGORY_ACTIONS, type QuickAction } from '@/protocol';
import { bootLog, bootWarn, pushAvailable } from '@/env';

/**
 * Traduction d'une action du protocole vers `expo-notifications`.
 *
 * Une action numérotée est TOUJOURS déclarée avec `isAuthenticationRequired: true` : la
 * catégorie étant statique, on ne sait pas au moment de l'enregistrement si l'option 2 est
 * un refus ou un « ne plus redemander ». Traiter tous les chiffres comme engageants est la
 * seule règle qui reste juste sans connaître le prompt. Le geste sûr sans authentification
 * reste disponible, il s'appelle `Interrompre`. Ces deux règles sont écrites dans la table
 * du protocole (`authenticationRequired`), ici on ne fait que les transporter.
 */
function toAction(a: QuickAction): Notifications.NotificationAction {
  return {
    identifier: a.identifier,
    buttonTitle: a.buttonTitle,
    options: {
      opensAppToForeground: a.opensAppToForeground,
      isAuthenticationRequired: a.authenticationRequired,
    },
  };
}

/**
 * Budget iOS : 4 actions rendues au maximum. `Interrompre` n'est jamais retiré, l'option de
 * refus non plus. À partir de 4 options le prompt retombe donc sur `KL_AWAITING_BLIND`, sans
 * aucune action d'option : une catégorie statique ne sait pas quel index porte le refus, donc
 * elle risquerait de retirer précisément le geste sûr. Ce découpage est celui du protocole.
 */
const CATALOG: { id: string; actions: Notifications.NotificationAction[] }[] = Object.entries(
  NOTIFICATION_CATEGORY_ACTIONS,
).map(([id, actions]) => ({ id, actions: actions.map(toAction) }));

let registered = false;

/**
 * Appelé une seule fois au lancement, jamais depuis la NSE, jamais à la volée.
 *
 * Sans effet quand le push n'est pas disponible (Expo Go) : enregistrer des catégories pour
 * des bannières qui n'arriveront jamais n'a aucun sens, et l'appel échouerait de toute façon.
 * Chaque catégorie est posée séparément : si l'une échoue, les autres restent enregistrées.
 */
export async function registerNotificationCategories(): Promise<void> {
  if (registered || !pushAvailable) return;
  registered = true;
  let posed = 0;
  for (const entry of CATALOG) {
    try {
      await Notifications.setNotificationCategoryAsync(entry.id, entry.actions);
      posed += 1;
    } catch (error) {
      bootWarn(`catégorie ${entry.id}`, error);
    }
  }
  bootLog(`catégories enregistrées : ${posed} sur ${CATALOG.length}`);
}

// Aucune catégorie ne porte d'action de saisie de texte libre, sur aucune surface (C26).
// `UNTextInputNotificationAction` n'apparaît nulle part dans ce projet : taper `1` puis
// Envoyer depuis un iPhone verrouillé approuverait l'option 1 sans Face ID, sans promptHash
// et sans relecture du pane, ce qui contournerait les trois garde-fous d'un coup.
