import { DECIDING_KEYS, KEY_TABLE, type ActionResponse, type KeyName } from '@kovalink/protocol';
import { audit } from '../audit.js';
import type { PromptState } from '../prompt/state.js';
import type { KovaIpc } from './ipc.js';
import type { PaneStore } from './panes.js';
// SEUL import autorise de ce module dans tout le projet (regle no-restricted-imports).
import { sendKeys } from './sendKeys.js';

export const MAX_TEXT = 8192;

export class ForbiddenError extends Error {
  constructor(
    readonly code: 'FORBIDDEN_ACTION' | 'FORBIDDEN_KEY' | 'TEXT_TOO_LONG',
    message: string,
  ) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Assainissement de tout texte utilisateur avant emission.
 *
 * 1. Normalisation NFC et fins de ligne uniformisees.
 * 2. Suppression des C0 sauf tabulation et saut de ligne, ESC compris : aucune
 *    sequence ESC, CSI, OSC (dont OSC 52), DCS ou APC ne peut survivre.
 * 3. Suppression des C1, les memes controles en 8 bits.
 * 4. Emballage en bracketed paste : le TUI recoit un collage, pas une suite de
 *    commandes.
 */
export function sanitizeFreeText(raw: string): string {
  const s = raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // C0 sauf \t et \n. La plage \u000E-\u001F contient ESC (\u001B) : AUCUNE
    // sequence ESC, CSI, OSC (dont OSC 52), DCS ou APC ne survit a cette ligne.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // C1, les memes controles en 8 bits.
    .replace(/[\u0080-\u009F]/g, '');
  if (s.length > MAX_TEXT) {
    throw new ForbiddenError('TEXT_TOO_LONG', `texte au dela de ${MAX_TEXT} caracteres`);
  }
  // Bracketed paste : le TUI recoit un collage, pas une suite de commandes.
  return `\u001b[200~${s}\u001b[201~`;
}

/** Ce que rendent les routes d'ecriture : la forme est celle du protocole, pas une copie. */
export type EmitResult = ActionResponse;

/**
 * KeyGate : POINT D'ENTREE UNIQUE de toute ecriture vers un pane.
 *
 * Aucun autre module, aucune route, aucun gestionnaire de message n'appelle
 * `sendKeys`. La regle est verifiee deux fois :
 * - `no-restricted-imports` sur `./sendKeys.js` hors de ce fichier (eslint.config.js) ;
 * - `test/keygate.test.ts`, qui compte les appelants dans tout `src/`.
 *
 * LA REGLE QUI COMPTE (C23) : aucun retour chariot ne part sans verification d'etat.
 *
 * Quatre operations, et quatre seulement : `emitAnswer`, `emitInterrupt`, `emitText`,
 * `emitKeys`. Le test `keygate.test.ts` verifie cette liste et le nombre d'appelants.
 */
export class KeyGate {
  constructor(
    private readonly ipc: KovaIpc,
    private readonly panes: PaneStore,
    private readonly prompts: PromptState,
  ) {}

  /**
   * Garde d'etat commune. Vraie seulement quand une decision protegee est en cours :
   * le pane attend ET le prompt a ete parse, donc l'app a des boutons a proposer.
   * Si le prompt est `unparsable`, la garde est FAUSSE et tout passe : c'est le repli
   * impose par A6 regle 2. Le lui interdire laisserait Robin sans aucun moyen de
   * debloquer sa session.
   */
  private async hasParsedPromptPending(paneId: number): Promise<boolean> {
    const pane = this.panes.get(paneId);
    if (!pane?.awaiting) return false;
    const prompt = await this.prompts.current(paneId, pane.awaiting_since);
    return prompt.state === 'parsed';
  }

  /**
   * Operation 0, repondre a un prompt parse (C1).
   *
   * SEUL `answerPrompt()` (`prompt/answer.ts`) l'appelle, apres ses gardes : relecture
   * fraiche du pane, `promptHash` recompare a temps constant, `awaitingSince` identique,
   * `optionIndex` present dans les options relues. Ici on n'ajoute AUCUNE garde d'etat
   * supplementaire et AUCUN delai : un seul `send-keys` atomique, le chiffre ET le
   * retour chariot ensemble. Un delai entre les deux ouvrirait la fenetre ou Claude
   * enchaine sur une autre question et recoit l'Entree (C1.3).
   *
   * Le texte est construit ici a partir d'un entier valide, jamais d'une chaine du
   * client. Un `\r` nu ne part jamais par ce chemin.
   */
  async emitAnswer(paneId: number, optionIndex: number): Promise<void> {
    if (!Number.isInteger(optionIndex) || optionIndex < 1 || optionIndex > 99) {
      throw new ForbiddenError('FORBIDDEN_ACTION', `optionIndex invalide: ${optionIndex}`);
    }
    await sendKeys(this.ipc, paneId, `${optionIndex}\r`);
  }

  /**
   * Operation 1, interrompre (C21, A7).
   *
   * Aucune garde d'etat, volontairement : interrompre est l'action sure par defaut,
   * elle doit toujours passer. Jamais Ctrl-C : l'echappement arrete le tour de
   * l'agent, Ctrl-C tuerait le processus.
   */
  async emitInterrupt(paneId: number, deviceId?: string): Promise<EmitResult> {
    const pane = this.panes.get(paneId);
    if (!pane) {
      audit({ deviceId, action: 'pane.interrupt', paneId, result: 'denied', detail: 'pane_gone' });
      return { applied: false, reason: 'pane_gone' };
    }
    await sendKeys(this.ipc, paneId, KEY_TABLE.esc);
    audit({ deviceId, action: 'pane.interrupt', paneId, result: 'ok' });
    return { applied: true };
  }

  /**
   * Operation 2, envoyer un message libre.
   *
   * Deux appels separes (PRD R8, CA-09) : la separation laisse le TUI enregistrer le
   * collage avant la validation. La fenetre entre les deux est GARDEE (C23). Si le
   * texte est parti mais pas le retour chariot, il reste dans le composer du pane,
   * visible sur le Mac : rien n'est perdu, et Robin voit pourquoi.
   */
  async emitText(paneId: number, text: string, deviceId?: string): Promise<EmitResult> {
    const pane = this.panes.get(paneId);
    // Le bracketed paste n'est honore que par un programme qui a active DECSET 2004.
    // Sur un pane sans agent, les marqueurs sont ignores et chaque saut de ligne
    // s'execute : on refuse, ce qui ferme la derniere voie d'execution de commande.
    if (!pane || pane.agent === null) {
      audit({
        deviceId,
        action: 'pane.sendText',
        paneId,
        result: 'denied',
        detail: pane ? 'no_agent' : 'pane_gone',
      });
      throw new ForbiddenError('FORBIDDEN_ACTION', 'texte libre refuse vers un pane sans agent');
    }

    const payload = sanitizeFreeText(text);

    if (await this.hasParsedPromptPending(paneId)) {
      audit({
        deviceId,
        action: 'pane.sendText',
        paneId,
        result: 'denied',
        detail: 'became_awaiting',
      });
      return { applied: false, reason: 'became_awaiting' };
    }

    await sendKeys(this.ipc, paneId, payload); // appel 1, le texte

    // Le second appel est un retour chariot nu. Entre les deux, l'agent a pu basculer
    // en awaiting : ce retour chariot validerait alors l'option surlignee d'une
    // question que Robin n'a jamais vue. On referme la fenetre.
    if (await this.hasParsedPromptPending(paneId)) {
      audit({
        deviceId,
        action: 'pane.sendText',
        paneId,
        result: 'denied',
        detail: 'became_awaiting',
      });
      return { applied: false, reason: 'became_awaiting' };
    }

    await sendKeys(this.ipc, paneId, KEY_TABLE.enter); // appel 2, la validation
    // Jamais le texte dans le journal : Robin y tape parfois des secrets.
    audit({ deviceId, action: 'pane.sendText', paneId, result: 'ok', detail: `len=${text.length}` });
    return { applied: true };
  }

  /**
   * Operation 3, touches brutes de la table fermee (routes en lot 2).
   *
   * Sans la garde, `['digit2','enter']` choisirait l'option 2 en contournant
   * entierement le `promptHash`.
   */
  async emitKeys(paneId: number, keys: KeyName[], deviceId?: string): Promise<EmitResult> {
    const pane = this.panes.get(paneId);
    if (!pane) return { applied: false, reason: 'pane_gone' };
    const deciding = keys.some((k) => DECIDING_KEYS.includes(k));
    if (deciding && (await this.hasParsedPromptPending(paneId))) {
      throw new ForbiddenError(
        'FORBIDDEN_KEY',
        'Une question est en attente. Reponds par les boutons, ou ouvre le mode brut.',
      );
    }
    const payload = keys
      .map((k) => {
        const v = KEY_TABLE[k];
        if (v === undefined) throw new ForbiddenError('FORBIDDEN_KEY', `touche inconnue: ${k}`);
        return v;
      })
      .join('');
    await sendKeys(this.ipc, paneId, payload);
    audit({ deviceId, action: 'pane.sendKeys', paneId, result: 'ok', detail: `n=${keys.length}` });
    return { applied: true };
  }
}
