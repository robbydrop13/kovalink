import {
  DECIDING_KEYS,
  KEY_TABLE,
  isAttachmentPath,
  type ActionResponse,
  type KeyName,
} from '@kovalink/protocol';
import { basename } from 'node:path';
import { audit } from '../audit.js';
import { logger } from '../logger.js';
import type { PromptState } from '../prompt/state.js';
import type { KovaIpc } from './ipc.js';
import type { PaneStore } from './panes.js';
// SEUL import autorise de ce module dans tout le projet (regle no-restricted-imports).
import { sendKeys } from './sendKeys.js';

export const MAX_TEXT = 8192;

/** Ctrl-U : Claude Code vide son champ de saisie. Sert a ne jamais laisser un texte orphelin. */
const CLEAR_LINE = '\u0015';
/** Cadence et plafond de la lecture d'ecran qui encadre un envoi de texte. */
const COMPOSER_POLL_MS = 150;
const ABSORB_MAX_MS = 3_000;
const SUBMIT_WAIT_MS = 1_200;
const ENTER_ATTEMPTS = 3;
/** Le composer de Claude Code commence par ce caractere. */
const COMPOSER_PREFIX = '❯';
const NEEDLE_LEN = 20;

/** La ligne du composer de Claude Code : la derniere qui commence par `❯`, sinon `null`. */
export function composerLine(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i] ?? '';
    if (l.trimStart().startsWith(COMPOSER_PREFIX)) return l;
  }
  return null;
}

/**
 * Ce que le composer doit montrer quand il a absorbe le texte : le debut de la premiere
 * ligne non vide. Si cette ligne est un chemin de piece jointe, Claude Code la reecrit en
 * `[Image #n]` (image) ou la garde telle quelle (autre fichier) : les deux formes valent.
 */
export function composerNeedles(text: string): string[] {
  const first = text
    .normalize('NFC')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return [];
  if (isAttachmentPath(first)) return ['[Image #', basename(first)];
  return [first.slice(0, NEEDLE_LEN)];
}

export function composerShows(lines: readonly string[], text: string): boolean {
  const line = composerLine(lines);
  if (line === null) return false;
  const needles = composerNeedles(text);
  return needles.length > 0 && needles.some((n) => line.includes(n));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
 * Cinq operations, et cinq seulement : `emitAnswer`, `emitInterrupt`, `emitText`,
 * `emitKeys`, `emitLaunch`. Le test `keygate.test.ts` verifie cette liste et le nombre
 * d'appelants.
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

  /** Lignes visibles du pane, `null` si l'ecran n'est pas lisible. */
  private async composer(paneId: number): Promise<readonly string[] | null> {
    try {
      const screen = await this.prompts.screen(paneId);
      return screen?.lines ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Attend que le composer ait ABSORBE le collage : deux lectures identiques d'affilee
   * qui montrent le texte. Mesure sur la machine (Claude Code 2.1.269) : un chemin
   * d'image colle est converti en `[Image #n]` en 300 a 700 ms, et un retour chariot
   * recu pendant cette conversion est PERDU. C'est exactement le message de Robin du
   * 12 septembre a 15:25 : texte et capture restes dans le champ, `ok` dans l'audit.
   * Rend `true` si l'absorption a ete observee, `false` si l'ecran est illisible ou si
   * le plafond est atteint (on tente quand meme la validation, puis on verifie).
   */
  private async waitAbsorbed(paneId: number, text: string): Promise<boolean> {
    const deadline = Date.now() + ABSORB_MAX_MS;
    let previous: string | null = null;
    while (Date.now() < deadline) {
      const lines = await this.composer(paneId);
      if (lines === null) return false;
      const line = composerLine(lines);
      if (line !== null && line === previous && composerShows(lines, text)) return true;
      previous = line;
      await sleep(COMPOSER_POLL_MS);
    }
    return false;
  }

  /** Vrai des que le composer ne montre plus le texte : le message est parti. */
  private async submitted(paneId: number, text: string): Promise<boolean> {
    const deadline = Date.now() + SUBMIT_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(COMPOSER_POLL_MS);
      const lines = await this.composer(paneId);
      if (lines === null) return true; // ecran illisible : on ne peut pas prouver le contraire
      if (!composerShows(lines, text)) return true;
    }
    return false;
  }

  /** Vide le champ de saisie : jamais de texte orphelin dans le terminal. */
  private async clearComposer(paneId: number): Promise<void> {
    try {
      await sendKeys(this.ipc, paneId, CLEAR_LINE);
    } catch (e) {
      logger.warn('impossible de vider le composer apres un refus', { paneId, err: (e as Error).message });
    }
  }

  /**
   * Operation 2, envoyer un message libre.
   *
   * Deux appels separes (PRD R8, CA-09) : la separation laisse le TUI enregistrer le
   * collage avant la validation, et l'ATTENTE entre les deux est mesuree sur l'ecran,
   * pas fixee : le retour chariot ne part que quand le composer montre le texte absorbe
   * (voir `waitAbsorbed`). La fenetre entre les deux reste GARDEE (C23), et si le retour
   * chariot est refuse ou n'a pas ete honore, le texte deja colle est EFFACE (Ctrl-U)
   * avant de repondre : rien ne reste dans le champ sans que l'app le sache.
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
    const deny = (detail: string, reason: 'became_awaiting' | 'not_submitted'): EmitResult => {
      audit({ deviceId, action: 'pane.sendText', paneId, result: 'denied', detail });
      return { applied: false, reason };
    };

    if (await this.hasParsedPromptPending(paneId)) return deny('became_awaiting', 'became_awaiting');

    await sendKeys(this.ipc, paneId, payload); // appel 1, le texte
    const absorbed = await this.waitAbsorbed(paneId, text);

    for (let attempt = 1; attempt <= ENTER_ATTEMPTS; attempt++) {
      // Entre le collage et la validation, l'agent a pu basculer en awaiting : ce retour
      // chariot validerait alors l'option surlignee d'une question que Robin n'a jamais
      // vue. On referme la fenetre, et on efface ce qui vient d'etre colle.
      if (await this.hasParsedPromptPending(paneId)) {
        await this.clearComposer(paneId);
        return deny('became_awaiting_after_paste', 'became_awaiting');
      }
      await sendKeys(this.ipc, paneId, KEY_TABLE.enter); // appel 2, la validation
      if (await this.submitted(paneId, text)) {
        // Jamais le texte dans le journal : Robin y tape parfois des secrets.
        audit({
          deviceId,
          action: 'pane.sendText',
          paneId,
          result: 'ok',
          detail: `len=${text.length}${attempt > 1 ? ` enter=${attempt}` : ''}${absorbed ? '' : ' absorb=timeout'}`,
        });
        return { applied: true };
      }
    }
    // Le texte est toujours dans le champ apres trois validations : on l'efface et on le dit.
    await this.clearComposer(paneId);
    logger.warn('texte colle mais jamais valide par le TUI, champ vide', { paneId, len: text.length });
    return deny('not_submitted', 'not_submitted');
  }

  /**
   * Operation 4, lancer l'agent dans un onglet que `new-tab` vient de creer (Cmd+O).
   *
   * Mesure sur la machine : le champ `command` de `new-tab` est TAPE dans le shell du
   * nouveau pane, sans etre execute. Ce retour chariot l'execute. Il n'est accepte que
   * sur un pane SANS agent, au repos : sur un agent vivant, il validerait n'importe quoi.
   */
  async emitLaunch(paneId: number, deviceId?: string): Promise<EmitResult> {
    const pane = this.panes.get(paneId);
    if (!pane) return { applied: false, reason: 'pane_gone' };
    if (pane.agent !== null || pane.child_processes.length > 0) {
      throw new ForbiddenError('FORBIDDEN_ACTION', 'lancement refuse : ce pane a deja un processus');
    }
    await sendKeys(this.ipc, paneId, KEY_TABLE.enter);
    audit({ deviceId, action: 'pane.launch', paneId, result: 'ok' });
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
