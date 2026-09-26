// Pont Slack : transport. Jetons lus dans le Trousseau, Socket Mode (aucune URL
// publique), Web API pour repondre. Absent de jetons, le module journalise une ligne et
// reste eteint : le reste du daemon ne change pas.
import { execFileSync } from 'node:child_process';
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { logger } from '../logger.js';
import { SlackBridge, type BridgeDeps, type SlackApi } from './bridge.js';
import type { SlackEnvelope } from './logic.js';

export const KEYCHAIN_SERVICE = 'kovalink-slack';
const AUTH_RETRY_MS = 5 * 60_000;

export interface SlackTokens {
  bot: string;
  app: string;
}

function keychain(account: string): string | null {
  try {
    const out = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    )
      .toString()
      .trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

export function readSlackTokens(): SlackTokens | null {
  const bot = keychain('bot-token');
  const app = keychain('app-token');
  if (!bot || !app) return null;
  return { bot, app };
}

/** Adaptateur `@slack/logger` -> journal du daemon (qui redige les jetons). */
function slackLogger(): NonNullable<ConstructorParameters<typeof SocketModeClient>[0]>['logger'] {
  let level = 'warn';
  const fmt = (args: unknown[]): string => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (...a: unknown[]) => logger.warn('slack sdk', { msg: fmt(a) }),
    error: (...a: unknown[]) => logger.error('slack sdk', { msg: fmt(a) }),
    setLevel: (l: string) => {
      level = l;
    },
    getLevel: () => level,
    setName: () => undefined,
  } as unknown as NonNullable<ConstructorParameters<typeof SocketModeClient>[0]>['logger'];
}

function webApi(web: WebClient): SlackApi {
  const code = (e: unknown): string => (e as { data?: { error?: string } }).data?.error ?? '';
  return {
    post: async (channel, threadTs, text) => {
      await web.chat.postMessage({ channel, thread_ts: threadTs, text, unfurl_links: false, unfurl_media: false });
    },
    react: async (channel, ts, name) => {
      try {
        await web.reactions.add({ channel, timestamp: ts, name });
      } catch (e) {
        if (code(e) !== 'already_reacted') throw e;
      }
    },
    unreact: async (channel, ts, name) => {
      try {
        await web.reactions.remove({ channel, timestamp: ts, name });
      } catch (e) {
        if (code(e) !== 'no_reaction') throw e;
      }
    },
    userName: async (userId) => {
      const res = await web.users.info({ user: userId });
      const u = res.user;
      return u?.profile?.display_name || u?.real_name || u?.name || null;
    },
  };
}

export interface SlackHandle {
  bridge: SlackBridge | null;
  stop(): void;
}

/**
 * Demarre le pont s'il a ses deux jetons. Ne leve jamais : toute erreur est journalisee
 * et le daemon continue sans Slack.
 */
export function startSlack(deps: Omit<BridgeDeps, 'api' | 'identity'>): SlackHandle {
  const handle: SlackHandle & { socket: SocketModeClient | null; retry: NodeJS.Timeout | null; stopped: boolean } = {
    bridge: null,
    socket: null,
    retry: null,
    stopped: false,
    stop() {
      this.stopped = true;
      if (this.retry) clearTimeout(this.retry);
      this.bridge?.stop();
      void this.socket?.disconnect().catch(() => undefined);
    },
  };

  const tokens = readSlackTokens();
  if (!tokens) {
    logger.info('slack: tokens missing, Slack bridge off', { keychainService: KEYCHAIN_SERVICE });
    return handle;
  }

  const boot = async (): Promise<void> => {
    if (handle.stopped) return;
    const web = new WebClient(tokens.bot, { logger: slackLogger() as never });
    let identity: { botUserId: string; teamId: string };
    try {
      const auth = await web.auth.test();
      if (!auth.user_id || !auth.team_id) throw new Error('auth.test sans user_id ni team_id');
      identity = { botUserId: auth.user_id, teamId: auth.team_id };
    } catch (e) {
      const err = (e as { data?: { error?: string } }).data?.error ?? (e as Error).message;
      if (err === 'invalid_auth' || err === 'not_authed' || err === 'account_inactive' || err === 'token_revoked') {
        logger.warn('slack: bot token refused, Slack bridge off', { err });
        return;
      }
      logger.warn('slack: auth.test failed, retry in 5 min', { err });
      handle.retry = setTimeout(() => void boot(), AUTH_RETRY_MS);
      handle.retry.unref?.();
      return;
    }

    const bridge = new SlackBridge({ ...deps, api: webApi(web), identity });
    handle.bridge = bridge;

    const socket = new SocketModeClient({ appToken: tokens.app, logger: slackLogger(), autoReconnectEnabled: true });
    handle.socket = socket;
    socket.on('slack_event', ({ ack, type, body }: { ack: () => Promise<void>; type: string; body: SlackEnvelope }) => {
      void ack().catch(() => undefined);
      if (type !== 'events_api') return;
      void bridge.handleEnvelope(body).catch((e: unknown) => {
        logger.warn('slack: evenement en echec', { err: (e as Error).message });
      });
    });
    socket.on('connected', () => logger.info('slack: socket mode connected', { team: identity.teamId }));
    socket.on('reconnecting', () => logger.info('slack: socket mode reconnecting'));
    socket.on('disconnected', () => logger.info('slack: socket mode disconnected'));
    try {
      await socket.start();
      logger.info('slack: bridge on', { botUserId: identity.botUserId, team: identity.teamId });
    } catch (e) {
      logger.warn('slack: socket mode start failed, retry in 5 min', { err: (e as Error).message });
      handle.bridge = null;
      handle.socket = null;
      handle.retry = setTimeout(() => void boot(), AUTH_RETRY_MS);
      handle.retry.unref?.();
    }
  };
  void boot();
  return handle;
}
