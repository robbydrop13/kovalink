#!/usr/bin/env node
import { existsSync } from 'node:fs';
import type { Server as HttpsServer } from 'node:https';
import type { FastifyInstance } from 'fastify';
import type { Pane } from '@kovalink/protocol';
import { purgeAudit } from './audit.js';
import { loadConfig, saveConfig } from './config.js';
import { installLaunchAgent, uninstallLaunchAgent } from './install.js';
import {
  detectLiveInstance,
  EXIT_ALREADY_RUNNING,
  EXIT_NO_LISTENER,
  writeInstanceLock,
} from './lock.js';
import { UploadStore } from './fs/uploads.js';
import { KovaIpc } from './kova/ipc.js';
import { KeyGate } from './kova/keygate.js';
import { PaneStore, type WorkingTransition } from './kova/panes.js';
import { LAYOUT_POLL_MS } from './kova/layoutPoll.js';
import { purgeOrphanRaws, RAW_PURGE_INTERVAL_MS, realRawPurgeDeps } from './kova/rawPurge.js';
import { logger } from './logger.js';
import { runPair } from './pair.js';
import { paths } from './paths.js';
import { answerPrompt } from './prompt/answer.js';
import { PromptDetector, type AwaitingPrompt } from './prompt/detector.js';
import { PromptRefs } from './prompt/refs.js';
import { PromptState } from './prompt/state.js';
import { PushNotifier } from './push/policy.js';
import { PushSender } from './push/sender.js';
import { startPeerRefresh } from './net/tailscale.js';
import { BIND_RESCAN_MS, currentBinds } from './security/bind.js';
import {
  CERT_CHECK_INTERVAL_MS,
  CertificateError,
  certExpiresAt,
  ensureCertificate,
  sameMaterial,
  type TlsMaterial,
} from './security/tls.js';
import { loadMasterSecret } from './security/token.js';
import { SleepAssertion } from './sleep.js';
import { clearRuntimeState, initRuntimeState, updateRuntimeState } from './state.js';
import { runStatus } from './status.js';
import { TranscriptTailer } from './transcript/tailer.js';
import { TurnEndDetector, type TurnEndPrompt } from './turnEnd.js';
import { Hub } from './server/hub.js';
import { createHttpServer } from './server/index.js';
import { AuthFailures, RateLimiter } from './server/rate.js';
import { NonceStore, type Services } from './server/services.js';

const DAEMON_VERSION = '0.1.0';

/** Detection de reveil apres veille : un ecart superieur a 5 s signale un saut d'horloge. */
const CLOCK_TICK_MS = 1_000;
const CLOCK_JUMP_MS = 5_000;

async function run(): Promise<void> {
  // Contrainte 5 : jamais root.
  if (process.getuid?.() === 0) {
    process.stderr.write('kovalinkd refuse de demarrer en root.\n');
    process.exit(1);
  }

  const cfgFile = paths.config();
  if (!existsSync(cfgFile)) saveConfig(loadConfig());
  const cfg = (): ReturnType<typeof loadConfig> => loadConfig();
  const config = cfg();

  // Instance unique. Deux daemons poseraient deux assertions d'alimentation, ecriraient
  // dans le meme journal d'audit et parleraient tous deux a Kova : le second doit sortir,
  // pas se contenter d'echouer sur le port.
  //
  // La detection n'ecrit RIEN. Le verrou n'est pose qu'apres une ecoute reellement
  // etablie, sans quoi une instance qui echoue sur EADDRINUSE ecraserait le verrou de
  // celle qui fonctionne, et laisserait un daemon fantome se declarer demarre.
  const live = await detectLiveInstance(config.port);
  if (live) {
    const detail =
      live.kind === 'lock'
        ? `pid ${live.lock.pid}, depuis ${live.lock.startedAt}`
        : `le port ${live.port} est deja pris`;
    process.stderr.write(
      `kovalinkd tourne deja (${detail}).\n` +
        `Arrete le d abord : launchctl bootout gui/$(id -u)/io.claap.kovalinkd\n`,
    );
    process.exit(EXIT_ALREADY_RUNNING);
  }
  purgeAudit();
  // CA-129 : les captures `.raw` des Kova morts partent a la corbeille, au demarrage
  // puis une fois par jour. Verdict par `ps -p <pid> -o comm=`, jamais `kill(pid, 0)`.
  const purgeRaws = (): void => {
    try {
      purgeOrphanRaws(realRawPurgeDeps);
    } catch (e) {
      logger.warn('purge .raw en echec', { err: (e as Error).message });
    }
  };
  purgeRaws();
  const rawPurgeTimer = setInterval(purgeRaws, RAW_PURGE_INTERVAL_MS);
  rawPurgeTimer.unref?.();

  const master = loadMasterSecret();
  // Bloc C : purge des `.part` abandonnes depuis plus de 24 h. Un transfert coupe et
  // jamais repris ne doit pas laisser un fichier cache dans un dossier de projet.
  const uploads = new UploadStore(cfg);
  const purgedParts = uploads.purge();
  if (purgedParts > 0) logger.info('transferts abandonnes purges', { n: purgedParts });
  const ipc = new KovaIpc();
  const panes = new PaneStore();
  const refs = new PromptRefs();
  const prompts = new PromptState(ipc, refs);
  const keygate = new KeyGate(ipc, panes, prompts);
  const tailer = new TranscriptTailer();
  const push = new PushSender(cfg);
  const sleep = new SleepAssertion(() => cfg().preventSleep);

  const nonces = new NonceStore();
  const services: Services = {
    cfg,
    daemonVersion: DAEMON_VERSION,
    master,
    ipc,
    panes,
    keygate,
    prompts,
    refs,
    // Seul chemin vers `KeyGate.emitAnswer` : relecture, hash, awaitingSince, index.
    answer: (req, deviceId) => answerPrompt({ panes, prompts, keygate, nonces }, req, deviceId),
    tailer,
    sleep,
    rate: new RateLimiter(),
    authFailures: new AuthFailures(),
    nonces,
  };
  const hub = new Hub(services);

  // --- Flux Kova ---------------------------------------------------------

  const refreshTabs = async (): Promise<void> => {
    try {
      panes.setTabs(await ipc.listTabs());
    } catch {
      /* Kova vient de tomber, le reconnecteur s'en charge */
    }
  };

  /**
   * Kova n'emet AUCUN evenement quand un onglet est renomme, deplace ou cree vide : son
   * `subscribe` ne connait que `focus`, `pane-open`, `pane-close`, `pane-working` et
   * `pane-status`. Sans relecture, l'ordre et les noms des onglets restaient figes dans
   * l'app jusqu'au prochain redemarrage du daemon (mesure le 12 septembre 2026 : l'onglet
   * « Perso » deplace en 2e position sur le Mac, toujours en 8e sur l'iPhone). On relit
   * donc `list-tabs` + `list-panes` a chaque `focus` et toutes les `LAYOUT_POLL_MS`, et on
   * ne diffuse un instantane que si la mise en page (ordre, titres, cwd) a change.
   */
  let layoutSignature = '';
  const layoutOf = (tabs: Record<string, unknown>[], rawPanes: Record<string, unknown>[]): string =>
    JSON.stringify([
      tabs.map((t) => [t['id'], t['window'], t['tab_index'], t['title']]),
      rawPanes.map((p) => [p['id'], p['window'], p['tab'], p['title'], p['cwd'], p['agent']]),
    ]);
  const refreshLayout = async (reason: string): Promise<void> => {
    try {
      const [tabs, rawPanes] = await Promise.all([ipc.listTabs(), ipc.listPanes()]);
      const signature = layoutOf(tabs, rawPanes);
      if (signature === layoutSignature) return;
      layoutSignature = signature;
      panes.setTabs(tabs);
      panes.replaceAll(rawPanes);
      hub.pushPanesSnapshot();
      logger.debug('mise en page relue', { reason });
    } catch {
      /* Kova vient de tomber, le reconnecteur s'en charge */
    }
  };
  const layoutTimer = setInterval(() => void refreshLayout('sondage'), LAYOUT_POLL_MS);
  layoutTimer.unref?.();

  /** Relecture complete de `list-panes`, puis diffusion. Jamais sur le chemin d'une requete. */
  const refreshPanes = async (reason: string): Promise<void> => {
    try {
      panes.replaceAll(await ipc.listPanes());
      hub.pushPanesSnapshot();
      logger.debug('panes relus', { reason });
    } catch (e) {
      logger.warn('relecture des panes en echec', { reason, err: (e as Error).message });
    }
  };

  ipc.on('snapshot', (data: unknown) => {
    const d = data as { panes?: Record<string, unknown>[]; app_active?: boolean; focus?: { id?: number } };
    if (Array.isArray(d.panes)) panes.replaceAll(d.panes);
    panes.appActive = d.app_active === true;
    panes.focusPaneId = typeof d.focus?.id === 'number' ? d.focus.id : null;
    void refreshTabs().then(() => hub.pushPanesSnapshot());
    sleep.reconcile(panes.anyWorking());
  });

  ipc.on('event', (ev: Record<string, unknown>) => {
    switch (ev['event']) {
      case 'ping':
        return;
      case 'focus': {
        panes.appActive = ev['app_active'] === true;
        const raw = ev['pane'] as Record<string, unknown> | undefined;
        const pane = raw ? panes.upsertRaw(raw) : null;
        panes.focusPaneId = pane?.id ?? null;
        hub.pushPaneEvent({
          t: 'pane.event',
          ev: 'focus',
          appActive: panes.appActive,
          reason: String(ev['reason'] ?? ''),
          pane,
        });
        void refreshLayout('focus');
        return;
      }
      case 'pane-status': {
        const paneId = Number(ev['pane_id']);
        const awaiting = ev['awaiting'] === true;
        const awaitingSince = (ev['awaiting_since'] as string | null) ?? null;
        // Un `awaiting: false` de Kova ne leve pas un `awaiting` synthetise par le
        // daemon (`PromptDetector`) : Kova dit `false` pendant qu'une question attend.
        if (!awaiting && panes.isSyntheticAwaiting(paneId)) return;
        panes.setAwaiting(paneId, awaiting, awaitingSince);
        // `awaiting` n'est PAS un declencheur de notification sur cette machine (D1) :
        // on relaie l'etat, on ne pousse rien.
        if (!awaiting) refs.invalidatePane(paneId);
        prompts.invalidate(paneId);
        hub.pushPaneEvent({ t: 'pane.event', ev: 'pane-status', paneId, awaiting, awaitingSince });
        return;
      }
      case 'pane-working': {
        const paneId = Number(ev['pane_id']);
        const working = ev['working'] === true;
        // Un pane ouvert APRES le daemon nait en `agent: null` (un shell), et Kova ne
        // reemet pas le pane quand `claude` y demarre : `pane-working` ne porte que le
        // booleen. Sans relecture, la detection de fin de tour et de prompt ignorait ce
        // pane pour toujours (`agent !== 'claude'`). Mesure sur un pane jetable.
        if (working && (panes.get(paneId)?.agent ?? null) === null) void refreshPanes('agent inconnu');
        panes.setWorking(paneId, working);
        // Le tour suivant a commence : l'ancienne fin de tour n'est plus a rejouer.
        if (working) hub.forgetPrompt(paneId);
        hub.pushPaneEvent({ t: 'pane.event', ev: 'pane-working', paneId, working });
        sleep.reconcile(panes.anyWorking());
        return;
      }
      case 'pane-open': {
        const pane = panes.upsertRaw(ev['pane'] as Record<string, unknown>);
        hub.pushPaneEvent({ t: 'pane.event', ev: 'pane-open', pane });
        void refreshLayout('pane-open');
        return;
      }
      case 'pane-close': {
        const paneId = Number(ev['pane_id']);
        const window = Number(ev['window'] ?? 0);
        const tab = Number(ev['tab'] ?? 0);
        panes.remove(paneId, window, tab);
        refs.invalidatePane(paneId);
        hub.forgetPrompt(paneId);
        hub.pushPaneEvent({ t: 'pane.event', ev: 'pane-close', paneId, window, tab });
        void refreshLayout('pane-close');
        return;
      }
      default:
        // Evenement inconnu : ignore silencieusement, jamais une erreur.
        return;
    }
  });

  ipc.on('status', (status: 'up' | 'down' | 'reconnecting', pid: number | null) => {
    hub.pushDaemonStatus(status, pid);
    updateRuntimeState({ kova: { status, pid } });
    // CA-123 : Kova est absent depuis `KOVA_DOWN_AFTER_MS`. Les panes n'existent plus,
    // on ne les laisse pas fantomes dans la liste de l'app : liste videe, instantane
    // vide diffuse, tails detaches par les evenements `close`, assertion relachee.
    if (status === 'down') {
      const n = panes.all().length;
      panes.replaceAll([]);
      panes.setTabs([]);
      hub.pushPanesSnapshot();
      sleep.reconcile(false);
      if (n > 0) logger.info('kova absent, liste des panes videe', { panes: n });
    }
  });

  ipc.on('ready', () => {
    void (async () => {
      try {
        panes.replaceAll(await ipc.listPanes());
        await refreshTabs();
        hub.pushPanesSnapshot();
      } catch (e) {
        logger.warn('rafraichissement initial en echec', { err: (e as Error).message });
      }
    })();
  });

  panes.on('close', (paneId: number) => {
    const pane = panes.get(paneId);
    const sessionId = pane?.agent_session_id ?? null;
    if (sessionId) tailer.detach(sessionId);
  });

  // --- Regles anti-bruit par evenement (PRD 4.4) --------------------------
  // Un seul chemin de notification pour la fin de tour (D1) ET la question detectee
  // (A6) : session ouverte sur un telephone VIVANT au premier plan, Robin devant son
  // Mac (suspension 60 s). Le reste (reglages d'appareil, heures calmes, plafond) est
  // decide dans `PushSender`, et la categorie `KL_AWAITING_*` vient de `categoryForPrompt`.
  const badge = (): number => panes.all().reduce((n, p) => n + (p.awaiting ? 1 : 0), 0);
  const notifier = new PushNotifier({
    isWatchedLive: (sessionId, paneId, now) => hub.isWatching(sessionId, paneId, now),
    isMacFocused: (paneId) => panes.appActive && panes.focusPaneId === paneId,
    pane: (paneId) => panes.get(paneId),
    isRefValid: (ref) => refs.resolve(ref) !== null,
    // Badge d'icone : le nombre REEL de panes en attente. Il valait 1 en dur.
    send: (prompt, pane) => push.send(prompt, pane, { cfg: cfg() }, badge()),
  });

  // --- Detection d'un prompt de permission (lot 2, A6) ---------------------

  const promptDetector = new PromptDetector(panes, prompts, refs);
  promptDetector.on('prompt', (prompt: AwaitingPrompt, pane: Pane) => {
    // L'etat de la liste d'abord : la ligne passe en `Attend ta reponse` (PRD A2).
    hub.pushPaneEvent({
      t: 'pane.event',
      ev: 'pane-status',
      paneId: pane.id,
      awaiting: true,
      awaitingSince: prompt.awaitingSince,
    });
    hub.pushPrompt(prompt);
    notifier.notify(prompt, pane);
  });
  promptDetector.on('resolved', (paneId: number) => {
    // Une question reglee sur le Mac pendant la suspension ne doit plus notifier.
    notifier.cancel(paneId);
    hub.pushPaneEvent({ t: 'pane.event', ev: 'pane-status', paneId, awaiting: false, awaitingSince: null });
    hub.pushPrompt({ state: 'none', paneId });
  });

  // --- Detection de fin de tour et push (D1) ------------------------------

  const detector = new TurnEndDetector(panes, refs, cfg);
  detector.on('turn-end', (prompt: TurnEndPrompt, pane: Pane) => {
    hub.pushPrompt(prompt);
    notifier.notify(prompt, pane);
  });

  panes.on('working', (t: WorkingTransition) => {
    if (!t.working) refs.sweep();
  });

  ipc.start();
  // Rafraichissement de fond de l'etat Tailscale : jamais sur le chemin d'une requete.
  const stopPeerRefresh = startPeerRefresh();

  // --- Ecouteurs HTTPS ---------------------------------------------------

  if (!config.tsDns) {
    process.stderr.write(
      'Aucun nom MagicDNS dans ~/.kovalink/config.json (`tsDns`). Le certificat ne peut pas etre emis.\n',
    );
    process.exit(2);
  }
  let tls: TlsMaterial;
  try {
    tls = ensureCertificate(config.tsDns);
  } catch (e) {
    // Echec propre et explicite : sans certificat il n'y a pas d'ecoute possible, mais
    // le daemon ne doit pas rendre une trace d'appel a Robin.
    const message = e instanceof CertificateError ? e.message : (e as Error).message;
    logger.error('certificat TLS indisponible', { err: message });
    process.stderr.write(`${message}\n`);
    ipc.stop();
    process.exit(3);
  }
  const servers = new Map<string, FastifyInstance>();

  const reconcileBinds = async (): Promise<void> => {
    const wanted = new Set(currentBinds());
    for (const [addr, app] of servers) {
      if (wanted.has(addr)) continue;
      servers.delete(addr);
      await app.close();
      logger.info('ecouteur ferme', { addr });
    }
    for (const addr of wanted) {
      if (servers.has(addr)) continue;
      try {
        const app = await createHttpServer(services, hub, tls, uploads);
        await app.listen({ host: addr, port: config.port });
        servers.set(addr, app);
        logger.info('ecouteur ouvert', { addr, port: config.port });
      } catch (e) {
        logger.warn('ecouteur en echec', { addr, err: (e as Error).message });
      }
    }
  };
  initRuntimeState({
    pid: process.pid,
    version: DAEMON_VERSION,
    startedAt: new Date().toISOString(),
    binds: [],
    port: config.port,
    kova: { status: ipc.state, pid: ipc.pid },
    tsDns: config.tsDns,
    certExpiresAt: certExpiresAt(),
  });
  await reconcileBinds();

  // Zero ecouteur est une erreur FATALE : un daemon qui se declare demarre sans rien
  // ecouter est un fantome, et il ne doit surtout pas toucher au verrou d'une autre
  // instance. La loopback est toujours disponible : n'avoir aucun ecouteur signifie
  // que le port est pris, donc qu'une autre instance vit.
  if (servers.size === 0) {
    const message =
      `Aucun ecouteur n a pu etre ouvert sur le port ${config.port}. ` +
      `Une autre instance le detient probablement, ou le port est occupe par un autre programme.`;
    logger.error('aucun ecouteur', { port: config.port });
    process.stderr.write(`${message}\n`);
    ipc.stop();
    process.exit(EXIT_NO_LISTENER);
  }

  // L'ecoute est etablie : on peut enfin revendiquer le verrou.
  const acquired = writeInstanceLock();
  if ('heldBy' in acquired) {
    process.stderr.write(
      `kovalinkd tourne deja (pid ${acquired.heldBy.pid}, depuis ${acquired.heldBy.startedAt}).\n`,
    );
    ipc.stop();
    await Promise.all([...servers.values()].map((srv) => srv.close()));
    process.exit(EXIT_ALREADY_RUNNING);
  }
  const lock = acquired;
  updateRuntimeState({ binds: [...servers.keys()] });
  // L'adresse Tailscale n'existe qu'une fois Tailscale demarre : on re-scanne.
  const bindTimer = setInterval(
    () => void reconcileBinds().then(() => updateRuntimeState({ binds: [...servers.keys()] })),
    BIND_RESCAN_MS,
  );
  bindTimer.unref?.();
  hub.startHeartbeat();

  // --- Renouvellement du certificat a chaud (A12, S3) ----------------------
  // Le daemon vit sous launchd des semaines durant, le certificat Let's Encrypt 90
  // jours. `ensureCertificate` n'etait appele qu'au demarrage : passe ~69 jours sans
  // redemarrage, tous les handshakes echouaient et rien ne le reemettait. Une fois par
  // jour, on rejoue `tailscale cert` a moins de `RENEW_BELOW_DAYS` de l'expiration et on
  // recharge le contexte TLS de chaque ecouteur SANS redemarrer ni couper les sockets.
  const tsDns = config.tsDns;
  const renewCertificate = (): void => {
    let fresh: TlsMaterial;
    try {
      fresh = ensureCertificate(tsDns);
    } catch (e) {
      const message = e instanceof CertificateError ? e.message : (e as Error).message;
      logger.warn('renouvellement du certificat en echec, on reessaiera demain', { err: message });
      return;
    }
    if (sameMaterial(fresh, tls)) {
      logger.debug('certificat verifie, pas de renouvellement necessaire');
      return;
    }
    tls = fresh;
    for (const [addr, app] of servers) {
      try {
        // Fastify type son serveur brut en `http.Server` ; le notre est un `https.Server`.
        (app.server as unknown as HttpsServer).setSecureContext({ key: fresh.key, cert: fresh.cert });
      } catch (e) {
        logger.warn('rechargement TLS en echec sur un ecouteur', { addr, err: (e as Error).message });
      }
    }
    const expires = certExpiresAt();
    updateRuntimeState({ certExpiresAt: expires });
    logger.info('certificat renouvele et recharge a chaud', { expiresAt: expires, listeners: servers.size });
  };
  const certTimer = setInterval(renewCertificate, CERT_CHECK_INTERVAL_MS);
  certTimer.unref?.();

  // --- Reveil apres veille -----------------------------------------------

  let lastTick = Date.now();
  const clockTimer = setInterval(() => {
    const now = Date.now();
    const drift = now - lastTick - CLOCK_TICK_MS;
    lastTick = now;
    if (drift < CLOCK_JUMP_MS) return;
    // Les sockets survivent rarement a une veille : autant les considerer morts.
    logger.info('reveil detecte, invalidation des connexions', { driftMs: drift });
    tailer.detachAll();
    // `restart`, pas `stop` puis `start` : l'etat passe par `reconnecting`, jamais par
    // `down`, sans quoi un simple reveil viderait la liste des panes de l'app.
    ipc.restart('reveil');
    // Un ecouteur peut avoir ete cree par la reconciliation des adresses avec un
    // ancien materiel TLS : le reveil est aussi un bon moment pour verifier le certificat.
    renewCertificate();
  }, CLOCK_TICK_MS);
  clockTimer.unref?.();

  const shutdown = (signal: string): void => {
    logger.info('arret demande', { signal });
    clearInterval(bindTimer);
    clearInterval(clockTimer);
    clearInterval(certTimer);
    clearInterval(rawPurgeTimer);
    clearInterval(layoutTimer);
    hub.stopHeartbeat();
    stopPeerRefresh();
    detector.stop();
    notifier.stop();
    promptDetector.stop();
    sleep.stop();
    push.stop();
    tailer.detachAll();
    ipc.stop();
    clearRuntimeState();
    lock.release();
    void Promise.all([...servers.values()].map((s) => s.close())).finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('kovalinkd demarre', { version: DAEMON_VERSION, binds: [...servers.keys()] });
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'run';
  switch (command) {
    case 'run':
      return run();
    case 'pair':
      return runPair();
    case 'install':
      installLaunchAgent();
      return;
    case 'uninstall':
      uninstallLaunchAgent();
      return;
    case 'status':
      runStatus();
      return;
    default:
      process.stdout.write('usage: kovalinkd [run|status|pair|install|uninstall]\n');
      process.exitCode = 1;
  }
}

void main().catch((e: unknown) => {
  logger.error('demarrage en echec', { err: (e as Error).message });
  process.exit(1);
});
