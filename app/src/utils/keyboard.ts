// Le clavier iOS, lu dans les notifications système (`keyboardWillShow` et
// `keyboardWillHide`), et le padding bas qu'un écran doit prendre pour que son composer
// reste posé dessus.
//
// Pourquoi pas `KeyboardAvoidingView` : son padding n'est pas la hauteur du clavier mais
// `frame.y + frame.height - screenY`, c'est à dire l'ordonnée du bord bas de sa propre
// vue (mesurée par `onLayout`) moins l'ordonnée du haut du clavier (donnée par iOS).
// Deux mesures faites à des instants différents, dans deux repères différents. Capture du
// 14 septembre : après l'envoi d'un message de six lignes, le composer se retrouvait
// 110 pt au dessus du clavier (cinq lignes de 22 pt), une bande noire entre les deux.
// Ici on ne garde qu'UNE donnée, la hauteur du clavier telle qu'iOS l'annonce, et on la
// retranche de ce que le contenu réserve déjà pour l'indicateur d'accueil : le composer
// ne compte plus l'inset deux fois quand le clavier est ouvert.

/**
 * Le padding bas de l'écran quand le clavier mesure `keyboardHeight` et que le contenu
 * réserve déjà `insetBottom` (l'indicateur d'accueil) sous le composer. Le clavier
 * recouvre cet inset : on ne le compte qu'une fois. Jamais négatif.
 */
export function keyboardPadding(keyboardHeight: number, insetBottom: number): number {
  return Math.max(0, Math.round(keyboardHeight - insetBottom));
}
