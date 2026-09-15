import {
  APP_URL_SCHEME,
  categoryForPrompt,
  DEFAULT_PUSH_CATEGORY,
  NOTIFICATION_CATEGORY,
  promptDeepLinkPath,
  type NotificationCategory,
  type Pane,
  type Prompt,
  type PushPayload,
} from '@kovalink/protocol';
import type { KovalinkConfig } from '../config.js';
import { logger } from '../logger.js';
import { loadDevices, saveDevices, type DeviceRecord } from '../security/token.js';
import { deliveryFor, HourlyCap, inQuietHours, type DevicePushPrefs } from './policy.js';

const RECEIPT_DELAY_MS = 15 * 60_000;
/** Un appel Expo sans reponse ne doit pas laisser un envoi pendu sans trace. */
const EXPO_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: timeout after ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Les regles vivent dans `policy.ts` ; reexportees pour les appelants historiques. */
export { inQuietHours };
export type DevicePrefs = DevicePushPrefs;

/**
 * Message tel qu'Expo l'attend. A ne pas confondre avec `PushPayload` du protocole,
 * qui est la charge utile `data` lue par la NSE et par l'action rapide.
 */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  /** `null` en mode passif : aucun son (CA-130). */
  sound: 'default' | null;
  priority: 'high' | 'normal';
  /** `passive` : n'allume pas l'ecran, ne sonne pas, reste dans le centre de notifications. */
  interruptionLevel: 'active' | 'passive';
  categoryId: NotificationCategory;
  mutableContent: true;
  ttl: number;
  collapseId: string;
  badge: number;
  data: PushPayload;
}

export interface SuppressionContext {
  cfg: KovalinkConfig;
  now?: Date;
}

/**
 * Charge utile APNs. SANS AUCUN CONTENU et SANS `paneId` dans `data` (A14, C24) : seule
 * la reference opaque transite. Le titre ne porte jamais l'`ai-title`, qui est genere a
 * partir du contenu de la conversation.
 *
 * `collapseId` par PANE (PRD 4.4, CA-14) : une seule banniere vivante par pane, la
 * nouvelle remplace la precedente. Il derivait du `promptRef`, neuf a chaque fin de
 * tour, donc deux fins de tour faisaient deux bannieres.
 */
export function buildPayload(
  prompt: Prompt,
  pane: Pane,
  expoPushToken: string,
  awaitingCount: number,
  passive = false,
): ExpoPushMessage | null {
  if (prompt.state === 'none') return null;
  const promptRef = prompt.promptRef;
  return {
    to: expoPushToken,
    title: `${pane.title ?? pane.agent ?? 'session'} . ${pane.projectName}`,
    body: prompt.state === 'turn_end' ? 'Turn finished' : 'Validation required',
    sound: passive ? null : 'default',
    priority: passive ? 'normal' : prompt.state === 'turn_end' ? 'normal' : 'high',
    interruptionLevel: passive ? 'passive' : 'active',
    // La charge utile porte toujours le pire cas : si la NSE est tuee avant d'ecrire
    // quoi que ce soit, la banniere s'affiche sans action d'approbation.
    categoryId: DEFAULT_PUSH_CATEGORY,
    mutableContent: true,
    ttl: 600,
    collapseId: `pane-${pane.id}`,
    badge: awaitingCount,
    // A14 et C24 : ni contenu, ni paneId. Le nom du projet et le titre d'onglet sont
    // deja dans le titre de la banniere, la NSE s'en sert comme sous-titre de repli.
    data: {
      kind: prompt.state === 'turn_end' ? 'turn_end' : 'awaiting',
      promptRef,
      project: pane.projectName,
      tab: pane.title ?? pane.agent ?? 'Kova',
      issuedAt: Date.now(),
      // Le CHEMIN est la valeur de reference : le schema depend de l'environnement qui
      // ouvre le lien (un build enregistre `kovalink://`, Expo Go non). Le daemon ne peut
      // pas savoir lequel tourne, il ne doit donc pas trancher a la place de l'app.
      deepLinkPath: promptDeepLinkPath(promptRef),
      deepLink: `${APP_URL_SCHEME}:/${promptDeepLinkPath(promptRef)}`,
      targetCategory: categoryForPrompt(prompt),
    },
  };
}

/**
 * Banniere agregee du plafond horaire (PRD 4.4, CA-32) : `{n} agents attendent`,
 * `Ouvrir` pour seule action, un `collapseId` fixe pour qu'une seule vive a la fois.
 * Aucune reference de prompt : elle ouvre la liste, pas une session.
 */
function buildAggregatePayload(
  expoPushToken: string,
  waiting: number,
  awaitingCount: number,
  passive: boolean,
): ExpoPushMessage {
  return {
    to: expoPushToken,
    title: 'KovaLink',
    body: waiting === 1 ? '1 agent is waiting' : `${waiting} agents are waiting`,
    sound: passive ? null : 'default',
    priority: 'normal',
    interruptionLevel: passive ? 'passive' : 'active',
    categoryId: NOTIFICATION_CATEGORY.AGGREGATE,
    mutableContent: true,
    ttl: 600,
    collapseId: 'aggregate',
    badge: awaitingCount,
    data: {
      kind: 'aggregate',
      promptRef: '',
      issuedAt: Date.now(),
      deepLinkPath: '/',
      deepLink: `${APP_URL_SCHEME}:///`,
      targetCategory: NOTIFICATION_CATEGORY.AGGREGATE,
    },
  };
}

type ExpoTicket = { status: string; id?: string; details?: { error?: string } };

/**
 * Envoi APNs via Expo. Les tickets sont relus 15 minutes plus tard :
 * `DeviceNotRegistered` supprime le jeton, sans quoi on pousserait indefiniment vers
 * un appareil desinstalle.
 */
/** Sous-ensemble du SDK Expo utilise ici. Injectable pour tester `send` sans reseau. */
export interface ExpoLike {
  chunkPushNotifications(messages: unknown[]): unknown[][];
  sendPushNotificationsAsync(chunk: unknown[]): Promise<unknown[]>;
  getPushNotificationReceiptsAsync(ids: string[]): Promise<Record<string, { status: string; details?: { error?: string } }>>;
}

export class PushSender {
  private expo: ExpoLike | null = null;
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly cap: HourlyCap;

  constructor(
    private readonly cfg: () => KovalinkConfig,
    cap = new HourlyCap(),
    private readonly expoFactory?: () => Promise<ExpoLike>,
  ) {
    this.cap = cap;
  }

  /**
   * Compose les messages d'un evenement, appareil par appareil. Separe de l'envoi
   * reseau pour etre teste : la suppression, le mode passif et l'agregation sont
   * decides ici, la ligne HTTP vers Expo n'est qu'un transport.
   */
  compose(
    prompt: Prompt,
    pane: Pane,
    ctx: SuppressionContext,
    targets: (DeviceRecord & { expoPushToken: string })[],
    awaitingCount: number,
  ): { messages: ExpoPushMessage[]; routed: Map<string, string> } {
    const messages: ExpoPushMessage[] = [];
    const routed = new Map<string, string>();
    if (targets.length === 0) return { messages, routed };
    const now = ctx.now ?? new Date();
    // Le plafond est GLOBAL, un evenement compte une fois quel que soit le nombre
    // d'appareils : on le consulte avant la boucle.
    const admission = this.cap.admit(pane.id, now.getTime());
    if (admission.aggregated) {
      logger.info('push agrege, plafond horaire atteint', { paneId: pane.id, waiting: admission.waiting });
    }
    // Un jeton par message : la decision est prise APPAREIL PAR APPAREIL, parce que
    // les heures calmes et `onlyValidations` sont des reglages d'appareil.
    for (const device of targets) {
      const delivery = deliveryFor(prompt, ctx.cfg, device.prefs, now);
      if (delivery.kind === 'suppress') {
        logger.info('push supprime', { paneId: pane.id, deviceId: device.deviceId, reason: delivery.reason });
        continue;
      }
      if (delivery.passive) {
        logger.info('push en mode passif, heures calmes', { paneId: pane.id, deviceId: device.deviceId });
      }
      const payload = admission.aggregated
        ? buildAggregatePayload(device.expoPushToken, admission.waiting, awaitingCount, delivery.passive)
        : buildPayload(prompt, pane, device.expoPushToken, awaitingCount, delivery.passive);
      if (payload) {
        messages.push(payload);
        routed.set(device.expoPushToken, device.deviceId);
      }
    }
    return { messages, routed };
  }

  private async client(): Promise<ExpoLike> {
    if (!this.expo) {
      if (this.expoFactory) {
        this.expo = await this.expoFactory();
      } else {
        const { Expo } = await import('expo-server-sdk');
        this.expo = new Expo() as unknown as ExpoLike;
      }
    }
    return this.expo;
  }

  /** `awaitingCount` alimente le badge d'icone : il etait fige a 1, quel que soit l'etat. */
  async send(
    prompt: Prompt,
    pane: Pane,
    ctx: SuppressionContext,
    awaitingCount = 0,
  ): Promise<number> {
    const devices = loadDevices();
    const paired = Object.values(devices).filter((d) => !d.revoked);
    const targets = paired.filter(
      (d): d is DeviceRecord & { expoPushToken: string } =>
        typeof d.expoPushToken === 'string' && d.expoPushToken.length > 0,
    );
    if (targets.length === 0) {
      // Un iPhone en Expo Go n'a pas de jeton push : sans cette ligne, une fin de tour
      // detectee ne laissait AUCUNE trace de ce qu'elle etait devenue (CA-12).
      logger.info('push sans destinataire', {
        paneId: pane.id,
        kind: prompt.state === 'turn_end' ? 'turn_end' : 'awaiting',
        categoryId: categoryForPrompt(prompt),
        reason: 'aucun_jeton_push',
        pairedDevices: paired.length,
      });
      return 0;
    }

    const { messages, routed } = this.compose(prompt, pane, ctx, targets, awaitingCount);
    if (messages.length === 0) return 0;
    // Le chargement du SDK peut echouer (dependance manquante, mesure le 15 septembre
    // 2026 : `promise-limit` absent). Hors de ce try, le rejet remontait jusqu'a un
    // `void` et TUAIT le daemon a chaque push : aucun envoi n'est jamais parti.
    let expo: ExpoLike;
    try {
      expo = await this.client();
    } catch (e) {
      logger.warn('envoi push en echec', { paneId: pane.id, stage: 'sdk', err: (e as Error).message });
      return 0;
    }

    let sent = 0;
    for (const chunk of expo.chunkPushNotifications(messages as never)) {
      try {
        const tickets = (await withTimeout(
          expo.sendPushNotificationsAsync(chunk),
          EXPO_TIMEOUT_MS,
          'expo send',
        )) as ExpoTicket[];
        sent += tickets.length;
        // Le ticket `i` correspond au message `i` du meme lot : c'est ce lien qui permet
        // de ne desinscrire QUE l'appareil fautif.
        const messagesSent = chunk as unknown as ExpoPushMessage[];
        const owners = messagesSent.map((m) => routed.get(m.to) ?? null);
        // Une ligne PAR emission acceptee par Expo (CA-12) : sans elle, l'ecart entre
        // l'evenement Kova et l'APNs ne se mesure pas, et un push perdu par Expo est
        // indiscernable d'un push jamais tente. `ticketId` et non `ticket` : cette
        // derniere cle est redigee par le journal (c'est celle du ticket WS).
        tickets.forEach((t, i) => {
          const m = messagesSent[i];
          if (!m) return;
          const entry = {
            paneId: pane.id,
            deviceId: owners[i],
            kind: m.data.kind,
            categoryId: m.data.targetCategory,
            ticketId: t.id ?? null,
            passive: m.interruptionLevel === 'passive',
          };
          if (t.status === 'ok') logger.info('push envoye', entry);
          else logger.warn('push refuse par Expo', { ...entry, error: t.details?.error ?? t.status });
        });
        this.scheduleReceipts(tickets, owners);
      } catch (e) {
        logger.warn('envoi push en echec', { err: (e as Error).message });
      }
    }
    return sent;
  }

  private scheduleReceipts(tickets: ExpoTicket[], owners: (string | null)[]): void {
    /** Ticket -> appareil emetteur. Sans ce lien, un seul refus desinscrivait TOUT. */
    const byId = new Map<string, string>();
    tickets.forEach((t, i) => {
      const owner = owners[i];
      if (t.status === 'ok' && t.id && owner) byId.set(t.id, owner);
    });
    if (byId.size === 0) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.checkReceipts(byId);
    }, RECEIPT_DELAY_MS);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async checkReceipts(byId: Map<string, string>): Promise<void> {
    try {
      const expo = await this.client();
      const receipts = await expo.getPushNotificationReceiptsAsync([...byId.keys()]);
      const devices = loadDevices();
      let changed = false;
      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status !== 'error') continue;
        if (receipt.details?.error !== 'DeviceNotRegistered') continue;
        const deviceId = byId.get(receiptId);
        const device = deviceId ? devices[deviceId] : undefined;
        if (device?.expoPushToken) {
          // SEUL l'appareil desinscrit perd son jeton. L'ancien code les effacait tous :
          // un iPhone reinstalle coupait les notifications de tous les autres.
          delete device.expoPushToken;
          changed = true;
          logger.info('jeton push retire, appareil desinscrit', { deviceId });
        }
      }
      if (changed) saveDevices(devices);
    } catch (e) {
      logger.warn('lecture des tickets push en echec', { err: (e as Error).message });
    }
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
