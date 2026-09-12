// Écran de session. L'écran central du produit depuis D1 : la notification arrive, Robin
// ouvre, LIT LE DERNIER ÉCHANGE, et donne la suite.
//
// Lisibilité (docs/13-chat-lisibilite.md) : un bandeau d'état fixe dit si l'agent travaille,
// le texte de l'assistant est pleine largeur sans bulle, les actions sont des lignes
// compactes avec leur état, la vue est calée sur les TROIS derniers échanges et
// l'historique se charge en tirant vers le haut. La fenêtre visible ne se referme jamais
// tant que l'écran est ouvert : un nouvel envoi ne replie pas ce que Robin lisait
// (points 7, 8 et 10).
//
// Deux vues internes en lot 1 : `Chat` et `Term` (repli monospace, alimenté en direct par
// `pane.screen`). La vue `Fichiers` est en lot 3 et n'est pas rendue, plutôt qu'affichée morte.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NotifyType, notify } from '@/utils/haptics';

import { attachmentsDir, indexToolResults, type PromptOption, type Turn } from '@/protocol';
import { colors, layout, radius, space } from '@/theme';
import { Button, LinkAction } from '@/ui/Button';
import { LinkPill } from '@/ui/LinkPill';
import { Banner, EmptyState, SkeletonList } from '@/ui/States';
import { Txt } from '@/ui/Txt';
import { Icon } from '@/ui/Icon';
import { AgentStatus } from '@/features/chat/AgentStatus';
import { AssistantTurn, OrphanResults, QuietSystemRow, StreamDot, SystemRow, UserBubble } from '@/features/chat/Bubble';
import { feedItems } from '@/features/chat/systemEvents';
import { Composer } from '@/features/chat/Composer';
import { StaleQueue } from '@/features/chat/StaleQueue';
import { confirmCellularSend } from '@/features/chat/AttachmentViews';
import { totalSize, type Attachment } from '@/features/chat/attachments';
import { ValidationBar } from '@/features/prompt/ValidationBar';
import { MonospaceFallback } from '@/features/terminal/MonospaceFallback';
import { NumericKeypad } from '@/features/terminal/NumericKeypad';
import { useInterrupt } from '@/features/sessions/useInterrupt';
import { followSessionOnMac, showPaneMenu } from '@/features/sessions/openOnMac';
import { dismissBannersForPane, paneIdentity } from '@/notifications/banners';
import {
  attachSession,
  detachSession,
  forceReconnect,
  peek,
  requestScreen,
  setVisiblePane,
} from '@/net/connection';
import { fetchTurns } from '@/net/http';
import { LINK_LABEL, isDegraded, useConnection } from '@/store/connection';
import { paneById, usePanes } from '@/store/panes';
import { usePrompts } from '@/store/prompts';
import { useScreens } from '@/store/screen';
import {
  recentExchanges,
  toolCallIds,
  transcriptMark,
  unconfirmed,
  useSession,
  withoutEchoed,
  type PendingMessage,
} from '@/store/session';
import { answerPrompt } from '@/actions/answer';
import { flushOutbox } from '@/actions/outboxRunner';
import { sendText, type Pieces, type SendTextOutcome } from '@/actions/sendText';
import {
  TEXT_QUEUE_MAX,
  confirmStale,
  countPending,
  dequeue,
  pending as pendingJobs,
  staleTexts,
  type OutboxJob,
} from '@/db/outbox';
import { needsCellularChoice } from '@/store/transfers';
import { shortAgeMs, truncatePath } from '@/utils/time';
import { useClock } from '@/utils/useClock';
import { bootWarn } from '@/env';
import { useOutboxNotices } from '@/store/outboxNotices';
import { t } from '@/i18n/en';

type ViewMode = 'chat' | 'term';

/** Au delà, on montre une erreur actionnable plutôt qu'un squelette qui ne finit jamais. */
const SESSION_RESOLVE_TIMEOUT_MS = 8_000;

/**
 * Rafraîchissement du repli monospace. Le design dit 1 Hz ; le daemon plafonne `screen` à
 * 60 lectures par minute et par appareil, 2 s laisse la moitié de marge à un `Rafraîchir`.
 */
const SCREEN_REFRESH_MS = 2_000;
/** Guet d'une bulle en file : la vidange a lieu hors de cet écran, à la reconnexion. */
const QUEUE_POLL_MS = 2_000;

/** Cause lisible d'un `applied: false` du daemon. Toujours une phrase, jamais un code nu. */
function refusalLabel(reason: string | undefined): string {
  switch (reason) {
    case 'became_awaiting':
      return t.sessionRefusalBecameAwaiting;
    case 'not_submitted':
      return t.sessionRefusalNotSubmitted;
    case 'pane_gone':
      return t.paneGoneOnMac;
    default:
      return t.sessionRefusalUnknown(reason ?? t.sessionReasonUnknown);
  }
}

export default function SessionScreen() {
  const params = useLocalSearchParams<{ paneId: string; focus?: string; view?: string }>();
  const paneId = Number(params.paneId);
  const insets = useSafeAreaInsets();

  const pane = usePanes((s) => paneById(s.panes, paneId));
  const allPanes = usePanes((s) => s.panes);
  const workingSince = usePanes((s) => s.workingSince[paneId] ?? null);
  const prompt = usePrompts((s) => s.byPane[paneId]);
  const phase = usePrompts((s) => s.phase[paneId] ?? 'hidden');
  const notice = usePrompts((s) => s.notice[paneId] ?? null);
  const setPhase = usePrompts((s) => s.setPhase);
  const setNotice = usePrompts((s) => s.setNotice);
  const link = useConnection((s) => s.link);
  const degraded = isDegraded(link);
  const session = useSession();
  const screen = useScreens((s) => s.byPane[paneId]);
  const { run: interrupt } = useInterrupt();

  const [view, setView] = useState<ViewMode>(params.view === 'term' ? 'term' : 'chat');
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [queued, setQueued] = useState(0);
  /** Textes de ce pane en file depuis plus de 15 min : ils attendent Robin (CA-122). */
  const [stale, setStale] = useState<OutboxJob[]>([]);
  /**
   * Premier `seq` visible de la session courante. Posé une fois, à partir des trois
   * derniers échanges, puis jamais relevé : la fenêtre ne fait que grandir (docs/13, 8 et 10).
   */
  const [floor, setFloor] = useState<{ sessionId: string | null; seq: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Pane dont le délai de résolution est écoulé. On sort du squelette, quoi qu'il arrive. */
  const [timedOutPaneId, setTimedOutPaneId] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  /** Collé en bas tant que Robin n'est pas remonté dans l'historique. */
  const stickToBottom = useRef(true);

  const agentSessionId = pane?.agent_session_id ?? null;

  // Abonnement : uniquement le pane et la session visibles. Jamais les autres.
  useEffect(() => {
    setVisiblePane(paneId);
    // « Suivre sur le Mac » : l'onglet bascule sur le Mac comme avec Cmd+P, quel que soit
    // le chemin d'arrivée (liste, palette, notification, nouvel onglet). En arrière plan :
    // l'écran s'ouvre quoi qu'il arrive, un échec se dit dans un toast.
    const notice = followSessionOnMac(paneId);
    if (notice) {
      const timer = setTimeout(() => setToast(notice), 0);
      return () => {
        clearTimeout(timer);
        setVisiblePane(null);
        detachSession();
      };
    }
    return () => {
      setVisiblePane(null);
      detachSession();
    };
  }, [paneId]);

  useEffect(() => {
    if (agentSessionId) attachSession(agentSessionId);
  }, [agentSessionId]);

  // Robin lit ce pane : ses bannières ont servi, elles quittent le centre de notifications
  // (CA-14). Idem quand le pane n'a plus rien à demander.
  const projectName = pane?.projectName ?? null;
  const tabLabel = pane ? paneIdentity(pane).tab : null;
  const promptRef = prompt && prompt.state !== 'none' ? prompt.promptRef : null;
  useEffect(() => {
    if (projectName === null || tabLabel === null) return;
    void dismissBannersForPane({ id: paneId, projectName, tab: tabLabel }, promptRef ? [promptRef] : []);
  }, [paneId, projectName, tabLabel, promptRef]);

  // Repli monospace : demandé tant que la vue Term est affichée, puis toutes les 2 s.
  useEffect(() => {
    if (view !== 'term') return;
    requestScreen(paneId);
    const timer = setInterval(() => requestScreen(paneId), SCREEN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [view, paneId]);

  // Un `awaiting` qui arrive force le défilement jusqu'au bas du dernier échange (P2).
  useEffect(() => {
    if (prompt && prompt.state !== 'none') {
      stickToBottom.current = true;
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [prompt]);

  const refreshQueue = useCallback(() => {
    void countPending('text').then(setQueued);
    void Promise.all([pendingJobs(), staleTexts()]).then(([live, stale]) => {
      setStale(stale.filter((j) => j.paneId === paneId));
      // Une bulle `queued` dont le nonce a quitté la file est PARTIE : la vidange l'a
      // envoyée à la reconnexion. Elle passe `sent`, datée de maintenant, et entre dans
      // le compte « Non confirmé » si son écho ne suit pas.
      const inQueue = new Set([...live, ...stale].map((j) => j.nonce));
      const left = (m: PendingMessage): boolean => m.state === 'queued' && !inQueue.has(m.nonce);
      // Refusée par la vidange : échec visible avec la cause, jamais « envoyée ». Une
      // seule session est ouverte à la fois : les refus en attente sont tous pour elle.
      const notices = useOutboxNotices.getState();
      const refused = { ...notices.refused };
      const firstCause = Object.values(refused)[0];
      if (firstCause) setToast(t.sessionRefusedByMac(firstCause));
      for (const nonce of Object.keys(refused)) notices.forget(nonce);
      setPending((p) => {
        if (!p.some(left)) return p;
        const ts = new Date().toISOString();
        return p.map((m) => {
          if (!left(m)) return m;
          const cause = refused[m.nonce];
          return cause ? { ...m, state: 'failed', error: cause } : { ...m, state: 'sent', ts };
        });
      });
    });
  }, [paneId]);

  // Relu à chaque envoi et à chaque changement de liaison : un texte devient « à confirmer »
  // avec le temps, sans que rien d'autre ne bouge.
  useEffect(() => {
    refreshQueue();
  }, [refreshQueue, pending.length, link]);

  // Tant qu'une bulle est en file, on guette sa sortie : la vidange se fait hors de cet
  // écran, à la reconnexion, sans le prévenir.
  const hasQueued = pending.some((m) => m.state === 'queued');
  useEffect(() => {
    if (!hasQueued) return;
    const timer = setInterval(refreshQueue, QUEUE_POLL_MS);
    return () => clearInterval(timer);
  }, [hasQueued, refreshQueue]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Filet contre l'écran vide. Un lien profond vers un pane fermé entre temps laissait
  // `pane` indéfini et la session en `idle` : la condition de squelette restait vraie
  // pour toujours, et l'écran affichait des rectangles gris sans fin ni explication.
  // On mémorise QUEL pane a expiré plutôt qu'un booléen remis à zéro dans l'effet :
  // le changement de pane suffit alors à invalider l'expiration, sans setState synchrone.
  useEffect(() => {
    const timer = setTimeout(() => setTimedOutPaneId(paneId), SESSION_RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [paneId]);
  const resolveTimedOut = timedOutPaneId === paneId;

  // Dérivé, pas mis dans l'état : aucune course possible entre l'arrivée du tour serveur
  // et l'ajout de la bulle locale, quel que soit l'ordre des deux.
  const stillPending = useMemo(
    () => withoutEchoed(pending, session.turns, session.sessionId),
    [pending, session.turns, session.sessionId],
  );
  // Horloge à la seconde, seulement quand un message attend sa confirmation (CA-48).
  const now = useClock(stillPending.some((m) => m.state === 'sent'));
  const late = useMemo(() => unconfirmed(stillPending, now), [stillPending, now]);

  const closed = session.status === 'closed';
  // CA-70 : un autre pane passe en attente pendant que celui ci est ouvert. La question
  // affichée reste celle de ce pane, une bannière annonce l'autre.
  const otherAwaiting = useMemo(
    () => allPanes.filter((p) => p.awaiting && p.id !== paneId),
    [allPanes, paneId],
  );
  const working = pane?.working === true;
  const awaiting = pane?.awaiting === true;
  const chatCapable = pane?.chatCapable !== false;
  const hasAgentSession = agentSessionId !== null;

  // Les trois derniers échanges d'abord ; l'historique au dessus sur demande. Le plancher
  // est posé au premier rendu de la session et ne remonte jamais : un nouvel envoi ajoute
  // en bas, il ne replie rien en haut.
  // État dérivé du rendu précédent (motif React « storing information from previous
  // renders ») : posé pendant le rendu, sans effet ni rendu en cascade.
  // Filet : si plus AUCUN tour n'atteint le plancher (numérotation qui a changé après une
  // reconnexion sur un daemon ancien), l'écran resterait vide sous les bulles locales,
  // c'est la capture du 12 septembre. On repose alors le plancher sur ce que l'on a.
  const lastKnown = session.turns[session.turns.length - 1];
  const floorStale = !!floor && !!lastKnown && floor.sessionId === session.sessionId && floor.seq > lastKnown.seq;
  if (session.turns.length > 0 && (!floor || floor.sessionId !== session.sessionId || floorStale)) {
    const first = recentExchanges(session.turns)[0];
    if (first) setFloor({ sessionId: session.sessionId, seq: first.seq });
  }
  const turns = useMemo(() => {
    if (showHistory) return session.turns;
    if (!floor || floor.sessionId !== session.sessionId) return recentExchanges(session.turns);
    return session.turns.filter((turn) => turn.seq >= floor.seq);
  }, [session.turns, session.sessionId, showHistory, floor]);
  const hiddenCount = session.turns.length - turns.length;
  // La jointure `tool_use` vers `tool_result` : une fois, sur tout ce qui est en mémoire.
  const results = useMemo(() => indexToolResults(session.turns), [session.turns]);
  const callIds = useMemo(() => toolCallIds(session.turns), [session.turns]);
  const lastTurn = session.turns[session.turns.length - 1];
  // Le tour assistant en cours d'écriture : le daemon le complète ligne par ligne (V6).
  const streamingTurnId =
    working && lastTurn?.kind === 'assistant' && !lastTurn.stopReason ? lastTurn.id : null;
  // L'agent travaille mais n'a pas encore commencé à écrire : un point pulse en bas.
  const tailDot =
    working && (!lastTurn || lastTurn.kind !== 'assistant' || lastTurn.stopReason === 'end_turn');
  const finishedAt = useMemo(() => {
    if (working) return null;
    if (prompt?.state === 'turn_end') return Date.parse(prompt.endedAt) || null;
    for (let i = session.turns.length - 1; i >= 0; i--) {
      const turn = session.turns[i];
      if (turn?.kind === 'assistant') return Date.parse(turn.ts) || null;
    }
    return null;
  }, [working, prompt, session.turns]);

  const loadOlder = useCallback(async () => {
    if (!session.sessionId || loadingOlder) return;
    const first = session.turns[0];
    setLoadingOlder(true);
    stickToBottom.current = false;
    try {
      const page = await fetchTurns(session.sessionId, first ? { beforeSeq: first.seq } : {});
      useSession.getState().applyOlder(session.sessionId, page.turns, page.hasMoreBefore);
    } catch (e) {
      setToast(t.sessionHistoryUnavailable(e instanceof Error ? e.message : String(e)));
    } finally {
      setLoadingOlder(false);
    }
  }, [session.sessionId, session.turns, loadingOlder]);

  /**
   * Historique en TIRANT vers le haut (docs/13, point 6) : le premier tirage révèle ce
   * qui est déjà en mémoire au dessus du dernier échange, les suivants demandent une page
   * plus ancienne au Mac. Les liens restent pour VoiceOver et pour qui préfère un tap.
   */
  const pullOlder = useCallback(() => {
    if (!showHistory && hiddenCount > 0) {
      stickToBottom.current = false;
      setShowHistory(true);
      return;
    }
    if (session.hasMoreBefore && !degraded) void loadOlder();
  }, [showHistory, hiddenCount, session.hasMoreBefore, degraded, loadOlder]);

  /**
   * Envoi d'un message, avec ou sans pièces jointes (docs/15). Rend `true` quand le
   * message est parti ou mis en file, `false` quand rien n'est parti : le composer garde
   * alors le texte et les vignettes.
   */
  const onSend = useCallback(
    async (text: string, attachments: Attachment[] = []): Promise<boolean> => {
      if (text.length === 0 && attachments.length === 0) return false;
      let pieces: Pieces | null = null;
      if (attachments.length > 0) {
        if (!agentSessionId) {
          setToast(t.sessionNoAgentForAttachments);
          return false;
        }
        // A4 : au delà de 100 Mo en cellulaire, une question, une seule, pour tout le message.
        const cellular = await needsCellularChoice(totalSize(attachments.filter((a) => !a.path)));
        if (cellular && !(await confirmCellularSend(totalSize(attachments)))) return false;
        pieces = { items: attachments, destDir: attachmentsDir(agentSessionId), cellularApproved: cellular };
      }
      // Lu AVANT l'envoi : tout tour utilisateur au delà de cette borne est potentiellement
      // l'écho de ce message.
      const { sessionId, afterSeq } = transcriptMark();
      const ts = new Date().toISOString();
      // RÈGLE : aucun envoi ne disparaît sans message visible ET sans ligne de journal.
      // Toute issue autre que « parti » ou « en file » rend `false` (le composer garde le
      // texte) après un toast, et `bootWarn` la trace.
      let outcome: SendTextOutcome;
      try {
        outcome = await sendText(paneId, text, prompt, pieces);
      } catch (e) {
        bootWarn('text send, exception', e);
        setToast(t.sessionSendFailed(e instanceof Error ? e.message : String(e)));
        return false;
      }
      if (!outcome.ok) {
        if (outcome.kind === 'locked') {
          bootWarn('text send refused', 'parsed prompt awaiting');
          setToast(t.sessionAnswerFirst);
          return false;
        }
        if (outcome.kind === 'cancelled') {
          bootWarn('text send cancelled', 'Face ID refused or cancelled');
          setToast(t.sessionFaceIdCancelled);
          return false;
        }
        if (outcome.kind === 'queued') {
          setPending((p) => [
            ...p,
            {
              nonce: outcome.nonce,
              text,
              state: 'queued',
              ts,
              afterSeq,
              sessionId,
              ...(outcome.attachments.length > 0 ? { attachments: outcome.attachments } : {}),
            },
          ]);
          return true;
        }
        if (outcome.kind === 'refused') {
          // Rien n'est mis en file : le Mac a répondu et a dit non. On montre sa raison.
          bootWarn('text send refused by the Mac', outcome.cause);
          setToast(t.sessionRefusedByMac(outcome.cause));
          return false;
        }
        bootWarn('text send refused', 'queue full');
        setToast(t.sessionQueueFull(TEXT_QUEUE_MAX));
        return false;
      }
      const applied = outcome.result.applied;
      const cause = applied ? null : refusalLabel(outcome.result.reason);
      setPending((p) => [
        ...p,
        {
          nonce: outcome.nonce,
          text,
          state: applied ? 'sent' : 'failed',
          ts,
          afterSeq,
          sessionId,
          ...(cause ? { error: cause } : {}),
          ...(outcome.attachments.length > 0 ? { attachments: outcome.attachments } : {}),
        },
      ]);
      if (!applied) {
        // Le Mac a accepté la requête mais n'a rien validé dans le pane : la bulle passe en
        // échec avec la cause, et le message reste renvoyable. Jamais silencieux.
        bootWarn('text send not applied', outcome.result.reason ?? 'no reason');
        setToast(cause ?? t.sessionNotDelivered);
        if (outcome.result.reason === 'became_awaiting') peek(paneId);
      }
      stickToBottom.current = true;
      scrollRef.current?.scrollToEnd({ animated: true });
      return true;
    },
    [paneId, prompt, agentSessionId],
  );

  /**
   * Renvoi d'un message en échec : la bulle disparaît, l'envoi repart tel quel. Les
   * pièces déjà arrivées sur le Mac gardent leur chemin et ne sont pas renvoyées.
   */
  const retry = useCallback(
    (m: PendingMessage) => {
      setPending((p) => p.filter((x) => x.nonce !== m.nonce));
      void onSend(m.text, m.attachments ?? []);
    },
    [onSend],
  );

  /** CA-122 : Robin confirme, le texte repart avec une vie neuve par la file. */
  const sendStale = useCallback(
    async (job: OutboxJob) => {
      await confirmStale(job.nonce);
      const report = await flushOutbox();
      const refused = report.refused.find((r) => r.nonce === job.nonce);
      if (refused) setToast(t.sessionRefusedByMac(refused.cause));
      else if (report.sent === 0) setToast(t.sessionMacUnreachableQueued);
      refreshQueue();
    },
    [refreshQueue],
  );

  const discardStale = useCallback(
    async (job: OutboxJob) => {
      await dequeue(job.nonce);
      setPending((p) => p.filter((m) => m.nonce !== job.nonce));
      refreshQueue();
    },
    [refreshQueue],
  );

  const onAnswer = useCallback(
    async (option: PromptOption) => {
      if (!prompt || prompt.state !== 'parsed') return;
      setPhase(paneId, 'authenticating', option.index);
      const outcome = await answerPrompt({
        paneId,
        optionIndex: option.index,
        optionKind: option.kind,
        optionLabel: option.label,
        promptHash: prompt.promptHash,
        awaitingSince: prompt.awaitingSince,
      });
      if (!outcome.ok) {
        setPhase(paneId, outcome.kind === 'cancelled' ? 'armed' : 'failed');
        if (outcome.kind !== 'cancelled') {
          notify(NotifyType.Error);
          // La cause EXACTE, pas « Envoi impossible ». Un refus du daemon et un Mac
          // éteint demandent deux gestes différents : les confondre fait perdre du temps.
          setNotice(
            paneId,
            outcome.kind === 'refused'
              ? t.sessionRefusedByMac(outcome.cause)
              : t.sessionSendFailedRetry(outcome.cause),
          );
        }
        return;
      }
      if (outcome.result.applied) {
        setPhase(paneId, 'sent');
        notify(NotifyType.Success);
        return;
      }
      if (outcome.result.reason === 'prompt_changed') {
        // Rien n'a été envoyé, et ce fait est écrit dans le bandeau. `hash_mismatch` n'est
        // pas `expired` : ici ce n'est PAS réglé, et Robin a failli répondre à côté.
        setPhase(paneId, 'hash_mismatch');
        setNotice(paneId, t.sessionPromptChanged);
        notify(NotifyType.Warning);
        peek(paneId);
        return;
      }
      if (outcome.result.reason === 'pane_gone') {
        // CA-69 : le pane a été fermé entre l'affichage et le tap. Rien n'est parti.
        setPhase(paneId, 'expired');
        setNotice(paneId, t.sessionGoneNothingSent);
        notify(NotifyType.Warning);
        return;
      }
      if (outcome.result.reason === 'not_awaiting') {
        // `expired` : c'est réglé, Robin a répondu sur le Mac.
        setPhase(paneId, 'expired');
        setNotice(paneId, t.sessionAnsweredOnMac);
        peek(paneId);
        return;
      }
      setPhase(paneId, 'armed');
      setNotice(paneId, t.sessionAlreadyAnswered);
    },
    [paneId, prompt, setNotice, setPhase],
  );

  /**
   * `Répondre autrement` : envoi de l'option de refus par le chemin protégé, puis ouverture
   * du composer une fois le prompt refermé. Jamais un chiffre déguisé en phrase.
   */
  const onRespondOtherwise = useCallback(async () => {
    if (!prompt || prompt.state !== 'parsed') return;
    const reject = prompt.options.find((o) => o.kind === 'reject');
    if (!reject) return;
    await onAnswer(reject);
    setNotice(paneId, t.sessionRejectSent);
  }, [onAnswer, paneId, prompt, setNotice]);

  const openMenu = useCallback(() => showPaneMenu(paneId, setToast), [paneId]);

  if (!pane && session.status !== 'ready') {
    if (resolveTimedOut) {
      return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
          <NavBar view={view} onView={setView} title={t.sessionsTitle} onMenu={openMenu} />
          <EmptyState title={t.sessionPaneNotFoundTitle} body={t.sessionPaneNotFoundBody(paneId, LINK_LABEL[link])}>
            <Button label={t.actionRetry} onPress={forceReconnect} />
            <Button label={t.actionSeeSessions} kind="secondary" onPress={() => router.replace('/')} />
          </EmptyState>
        </View>
      );
    }
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <NavBar view={view} onView={setView} title={t.sessionsTitle} onMenu={openMenu} />
        <SkeletonList count={4} height={72} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ paddingTop: insets.top }}>
        <NavBar view={view} onView={setView} title={t.sessionsTitle} onMenu={openMenu} />
        <View style={styles.subtitle}>
          <Txt variant="calloutStrong" color={colors.text.primary} numberOfLines={1}>
            {pane ? `${pane.projectName} · ${pane.title ?? pane.agent ?? t.paneFallbackTitle}` : t.sessionFallbackTitle}
          </Txt>
          <View style={styles.grow} />
          <Txt variant="monoPath" color={colors.text.tertiary} numberOfLines={1}>
            {pane ? truncatePath(pane.cwd) : ''}
          </Txt>
        </View>
        <AgentStatus
          degraded={degraded}
          closed={closed}
          awaiting={awaiting}
          working={working}
          workingSince={workingSince}
          finishedAt={finishedAt}
        />
      </View>

      {closed ? (
        <Banner
          tone="error"
          text={t.sessionGone}
          actionLabel={t.actionBack}
          onAction={() => router.back()}
        />
      ) : null}
      {degraded ? (
        // CA-120 : hors ligne, le dernier échange vient du cache local et le bandeau le
        // dit, avec l'âge de ce cache. Rien n'est présenté comme frais.
        <Banner
          tone={link === 'offline' ? 'offline' : 'warn'}
          text={t.sessionDegradedBanner(
            link === 'offline',
            session.servedFromCacheAt !== null ? shortAgeMs(now - session.servedFromCacheAt) : null,
          )}
          actionLabel={t.actionRetry}
          onAction={forceReconnect}
        />
      ) : session.servedFromCacheAt !== null ? (
        // Ouverture depuis le cache, liaison vivante : le Mac réconcilie (design 4.2).
        <Banner tone="working" text={t.sessionCacheUpdating} />
      ) : null}
      {!chatCapable ? (
        <Banner
          text={t.sessionChatUnavailable}
          actionLabel={t.actionOpenTerminal}
          onAction={() => setView('term')}
        />
      ) : null}
      {session.status === 'error' ? (
        <Banner
          tone="error"
          text={session.error ?? t.sessionTranscriptUnreadable}
          actionLabel={t.actionOpenTerminal}
          onAction={() => setView('term')}
        />
      ) : null}
      {late.length > 0 && !closed ? (
        // CA-48 : le Mac a accepté le message, le pane ne l'a pas écrit dans son transcript
        // après 20 s. On n'affirme rien, on envoie voir le terminal.
        <Banner
          tone="warn"
          text={
            late.length === 1
              ? t.sessionUnconfirmedOne
              : t.sessionUnconfirmedMany(late.length)
          }
          actionLabel={t.actionOpenTerminal}
          onAction={() => setView('term')}
        />
      ) : null}
      {otherAwaiting.length > 0 && !closed ? (
        <Banner
          tone="warn"
          text={
            otherAwaiting.length === 1 && otherAwaiting[0]
              ? t.sessionOtherAwaitingOne(otherAwaiting[0].projectName, paneIdentity(otherAwaiting[0]).tab)
              : t.sessionOtherAwaitingMany(otherAwaiting.length)
          }
          actionLabel={t.actionSee}
          onAction={() =>
            otherAwaiting.length === 1 && otherAwaiting[0]
              ? router.push(`/session/${otherAwaiting[0].id}?focus=awaiting`)
              : router.replace('/')
          }
        />
      ) : null}
      {!closed ? (
        <StaleQueue
          jobs={stale}
          now={now}
          onSend={(job) => void sendStale(job)}
          onDiscard={(job) => void discardStale(job)}
        />
      ) : null}

      {view === 'chat' ? (
        <ScrollView
          ref={scrollRef}
          style={styles.grow}
          contentContainerStyle={styles.chat}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          refreshControl={
            hiddenCount > 0 || session.hasMoreBefore ? (
              <RefreshControl
                refreshing={loadingOlder}
                onRefresh={pullOlder}
                tintColor={colors.text.secondary}
                title={hiddenCount > 0 ? t.sessionHistoryCount(hiddenCount) : t.sessionOlder}
                titleColor={colors.text.tertiary}
              />
            ) : undefined
          }
          onScrollBeginDrag={() => {
            stickToBottom.current = false;
          }}
          onContentSizeChange={() => {
            if (stickToBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {session.status === 'loading' && !degraded && !resolveTimedOut ? (
            <SkeletonList count={4} height={72} />
          ) : null}

          {session.status === 'loading' && (degraded || resolveTimedOut) ? (
            // Jamais un squelette sans fin (CA-120) : sans cache et sans Mac, on le dit.
            <EmptyState
              title={degraded ? t.sessionTranscriptOfflineTitle : t.sessionTranscriptWaitingTitle}
              body={degraded ? t.sessionTranscriptOfflineBody : t.sessionTranscriptWaitingBody}
            >
              <Button label={t.actionRetry} kind="secondary" onPress={forceReconnect} />
              <Button label={t.actionOpenTerminal} kind="secondary" onPress={() => setView('term')} />
            </EmptyState>
          ) : null}

          {session.status === 'ready' && session.turns.length === 0 ? (
            <EmptyState
              title={t.sessionNothingTitle}
              body={hasAgentSession ? t.sessionNothingBodyAgent : t.sessionNothingBodyNoAgent}
            >
              <Button label={t.actionOpenTerminal} kind="secondary" onPress={() => setView('term')} />
            </EmptyState>
          ) : null}

          {hiddenCount > 0 ? (
            <LinkAction
              label={t.sessionHistoryCount(hiddenCount)}
              accessibilityHint={t.sessionHistoryHint}
              onPress={() => {
                stickToBottom.current = false;
                setShowHistory(true);
              }}
            />
          ) : null}
          {showHistory && session.hasMoreBefore ? (
            <LinkAction
              label={loadingOlder ? t.actionLoading : t.actionLoadOlder}
              disabled={loadingOlder}
              onPress={() => void loadOlder()}
            />
          ) : null}

          {feedItems(turns).map((item) =>
            item.kind === 'quiet' ? (
              <QuietSystemRow key={item.key} turns={item.turns} />
            ) : (
              <TurnView
                key={item.turn.id}
                turn={item.turn}
                working={working}
                streaming={item.turn.id === streamingTurnId}
                results={results}
                callIds={callIds}
              />
            ),
          )}

          {stillPending.map((m) => (
            <UserBubble
              key={m.nonce}
              state={m.state}
              error={m.error}
              attachments={m.attachments}
              onRetry={m.state === 'failed' ? () => retry(m) : undefined}
              turn={{
                id: m.nonce,
                kind: 'user',
                ts: m.ts,
                seq: Number.MAX_SAFE_INTEGER,
                uuids: [],
                blocks: [{ type: 'text', text: m.text }],
                isSidechain: false,
              }}
            />
          ))}

          {tailDot ? <StreamDot /> : null}
        </ScrollView>
      ) : (
        <View style={styles.grow}>
          {screen ? (
            <MonospaceFallback
              screen={screen.lines.join('\n')}
              cols={screen.cols}
              rows={screen.rows}
              paneLabel={pane ? `${pane.projectName} · ${pane.title ?? ''}` : ''}
              frozen={degraded ? t.sessionFrozenSnapshot : null}
            />
          ) : prompt?.state === 'unparsable' ? (
            <MonospaceFallback
              screen={prompt.rawScreen}
              cols={prompt.cols}
              rows={prompt.rows}
              paneLabel={pane ? `${pane.projectName} · ${pane.title ?? ''}` : ''}
              frozen={degraded ? t.sessionFrozenSnapshot : null}
            />
          ) : (
            <EmptyState
              title={degraded ? t.sessionScreenUnavailableTitle : t.sessionScreenCapturingTitle}
              body={degraded ? t.sessionScreenUnavailableBody : t.sessionScreenCapturingBody}
            >
              <Button label={t.actionRefresh} kind="secondary" onPress={() => requestScreen(paneId)} />
            </EmptyState>
          )}
          {pane?.awaiting ? (
            <NumericKeypad
              onDigit={(d) => {
                void onSend(String(d));
              }}
            />
          ) : null}
        </View>
      )}

      {prompt ? (
        <ValidationBar
          prompt={prompt}
          phase={phase}
          notice={notice}
          unavailable={degraded}
          onAnswer={(o) => void onAnswer(o)}
          onInterrupt={() => void interrupt(paneId)}
          onOpenTerminal={() => setView('term')}
          onRespondOtherwise={() => void onRespondOtherwise()}
          onFreeText={() => setView('chat')}
          onRetry={forceReconnect}
        />
      ) : null}

      {toast ? (
        <View style={styles.toast}>
          <Txt variant="footnote" color={colors.text.primary}>
            {toast}
          </Txt>
        </View>
      ) : null}

      <View style={{ paddingBottom: insets.bottom }}>
        <Composer
          paneId={paneId}
          prompt={prompt}
          working={working}
          degraded={degraded}
          disabled={closed || !hasAgentSession}
          disabledPlaceholder={
            closed ? t.sessionGoneShort : t.sessionNoAgentSession
          }
          queuedCount={queued}
          onSend={onSend}
          onInterrupt={() => void interrupt(paneId)}
          onLockedTap={() => setToast(t.sessionAnswerFirst)}
          onNotice={setToast}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function TurnView({
  turn,
  working,
  streaming,
  results,
  callIds,
}: {
  turn: Turn;
  working: boolean;
  streaming: boolean;
  results: ReturnType<typeof indexToolResults>;
  callIds: ReadonlySet<string>;
}) {
  if (turn.kind === 'user') return <UserBubble turn={turn} state="sent" />;
  if (turn.kind === 'system') return <SystemRow turn={turn} />;
  if (turn.kind === 'tool_result') return <OrphanResults turn={turn} callIds={callIds} />;
  return <AssistantTurn turn={turn} working={working} streaming={streaming} results={results} />;
}

function NavBar({
  view,
  onView,
  title,
  onMenu,
}: {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  title: string;
  onMenu: () => void;
}) {
  return (
    <View style={styles.nav}>
      <LinkAction icon="chevron-left" label={title} onPress={() => router.back()} />
      <View style={styles.grow} />
      <View style={styles.segmented}>
        {(['chat', 'term'] as const).map((v) => (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityState={{ selected: view === v }}
            onPress={() => onView(v)}
            style={[styles.segment, view === v && styles.segmentOn]}
          >
            <Txt variant="caption" color={view === v ? colors.text.primary : colors.text.secondary}>
              {v === 'chat' ? t.sessionViewChat : t.sessionViewTerm}
            </Txt>
          </Pressable>
        ))}
      </View>
      <View style={styles.grow} />
      <LinkPill compact />
      {/* Menu `...` du design 4.2 : `Ouvrir sur le Mac`. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.sessionMoreActions}
        hitSlop={8}
        onPress={onMenu}
        style={styles.menu}
      >
        <Icon name="more-horizontal" size={24} color={colors.text.secondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.base },
  nav: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: layout.screenPaddingH,
  },
  menu: { minWidth: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  subtitle: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: layout.screenPaddingH,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  chat: { paddingHorizontal: layout.screenPaddingH, paddingVertical: space[4] },
  grow: { flex: 1 },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.sm,
    backgroundColor: colors.bg.overlay,
    padding: 2,
  },
  segment: { paddingHorizontal: space[5], paddingVertical: space[3], borderRadius: radius.sm },
  segmentOn: { backgroundColor: colors.bg.raised },
  toast: {
    alignSelf: 'center',
    marginBottom: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: radius.full,
    backgroundColor: colors.bg.overlay,
  },
});
