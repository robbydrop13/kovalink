// Glisser-déposer d'une liste verticale, sans reanimated : un `Gesture.Pan()` par ligne
// (API moderne de gesture-handler, `GestureDetector`) qui s'active après 300 ms sans
// bouger. Ses rappels tournent sur le fil JS : à chaque déplacement, le JS pose la
// translation du doigt sur une `Animated.Value` (pilote JS) qui déplace la copie flottante,
// et rejoue la machine de `dragMachine.ts` (rang visé, écarts, place du squelette). Les
// écarts des autres lignes et le squelette restent sur le pilote natif : ce sont des
// `timing` lancés depuis le JS, jamais des événements.
//
// Pourquoi pas `Animated.event(..., { useNativeDriver: true, listener })` sur le
// `PanGestureHandler` historique : sur Fabric (RN 0.86, gesture-handler 2.32) l'événement
// `onGestureHandlerEvent` d'un tel handler n'est remis qu'au module animé natif
// (`RNGestureHandlerManager.mm`, `sendEventForNativeAnimatedEvent` : seulement
// `notifyObserversOfEvent`, jamais la file JS) ; le `listener` ne tournait jamais, le rang
// visé ne changeait pas, et au lâcher `to === from` : rien ne partait.
//
// La ligne tenue ne change PAS d'apparence pendant le geste, hors son opacité, et la
// liste des enfants du conteneur ne change pas non plus au levé : sur iOS avec Fabric,
// tout enfant dont l'index change (un `zIndex`, ou un frère inséré AVANT lui) est retiré
// puis réinséré dans les vues natives ; quitter la fenêtre annule le toucher, et le geste
// est CANCELLED avant le premier déplacement. Le squelette (premier enfant) et la copie
// (dernier enfant) sont donc montés en permanence, vides et invisibles au repos : le levé
// ne fait que changer leurs propriétés. La vraie ligne reste en place, invisible, et
// garde le doigt ; la copie flotte au dessus des autres.
//
// La liste rendue pendant le geste est figée par l'écran (les instantanés continuent
// d'arriver) : les clés sont stables, la géométrie vient de `onLayout` et se remet à jour
// si les lignes changent de taille (le repli des onglets au levé).
//
// Les écarts des autres lignes sont des `Animated.Value` TENUES PAR CLÉ pour toute la vie
// de la liste, et remises à zéro par `setValue(0)` au lâcher, dans le même tour que le
// rendu du nouvel ordre. Pas un jeu de valeurs neuves : sur Fabric, une vue dont le
// `transform` a été piloté par le module animé natif ne le reprend plus jamais de React
// (`RCTViewComponentView`, `propKeysManagedByAnimated`), et `restoreDefaultValues` y est
// un no-op (`RCTPropsAnimatedNode`). Une valeur neuve à 0 rendue par React laissait donc
// la ligne écartée là où le geste l'avait poussée, d'une hauteur de ligne, par dessus
// l'onglet suivant. Seul le module animé peut ramener ce qu'il a déplacé.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef, type ReactNode, type RefObject } from 'react';
import { Animated, Easing, type LayoutChangeEvent, type ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import { colors, motion } from '@/theme';
import { ImpactStyle, NotifyType, impact, notify, selection } from '@/utils/haptics';
import { deadMove, reduce, stolen, type DragFrame, type DragState } from './dragMachine';
import type { Slot } from './dragSlots';

/** Ce que l'écran prête à la liste pour faire défiler pendant le geste. */
export interface DragScroll {
  scrollRef: RefObject<ScrollView | null>;
  /** Défilement courant, tenu à jour par `onScroll`. */
  offsetY: RefObject<number>;
  /** Fenêtre visible, mesurée à l'écran au levé. */
  viewport: RefObject<{ top: number; height: number }>;
  contentHeight: RefObject<number>;
  /** Vrai pendant le geste : le défilement au doigt est coupé. */
  lock: (locked: boolean) => void;
}

export const DragScrollContext = createContext<DragScroll | null>(null);

/** Tenir le doigt immobile ce temps soulève la ligne. */
const LONG_PRESS_MS = 300;
/** Tenir le doigt à moins de 72 pt d'un bord fait défiler, de 2 à 10 pt par image. */
const EDGE_PT = 72;
const STEP_MIN = 2;
const STEP_MAX = 10;
/** Course élastique au delà des bornes : 200 pt de doigt pour 48 pt de carte. */
const RUBBER_IN = 200;
const RUBBER_OUT = 48;
const SETTLE_MS = 180;
const PLACEHOLDER_OPACITY = 0.6;
/** Les diagnostics du geste, dans le journal de l'app (aucun canal persistant à ce jour). */
const LOG_PREFIX = '[KovaLink drag]';

export interface DragList<K extends string | number> {
  active: K | null;
  /** Le geste d'une ligne : à donner à un `GestureDetector` autour de sa zone de prise. */
  gesture: (key: K) => PanGesture;
  itemStyle: (key: K) => Animated.WithAnimatedValue<ViewStyle>;
  onItemLayout: (key: K) => (e: LayoutChangeEvent) => void;
  /** Le squelette de la place visée : à rendre PREMIER enfant du conteneur, toujours. */
  placeholder: ReactNode;
  /**
   * La copie qui flotte sous le doigt : à appeler DERNIER enfant du conteneur, dans le JSX,
   * toujours. Une fonction, pas un nœud : `opts.ghost` n'est ainsi appelé qu'une fois le
   * rendu de l'écran écrit en entier, jamais au milieu de ses déclarations (sur Hermes,
   * `const` devient `var` : une fonction déclarée plus bas y vaudrait encore `undefined`).
   */
  ghost: () => ReactNode;
}

interface Options<K> {
  keys: K[];
  /** Espace entre deux lignes (le `gap` du conteneur). */
  gap: number;
  /** Rayon des lignes, repris par le squelette et la copie. */
  radius: number;
  enabled: boolean;
  /** Le rendu visuel d'une ligne, sans ses gestes : ce que la copie flottante montre. */
  ghost: (key: K) => ReactNode;
  /** Le défilement de l'écran ; par défaut celui du `DragScrollContext` englobant. */
  scroll?: DragScroll | undefined;
  /** Rangs atteignables depuis `from` (inclusifs) ; toute la liste par défaut. */
  range?: (from: number) => [number, number];
  onLift?: () => void;
  /** Au lâcher, dans le même tour que la remise à zéro des transformations. `to` peut valoir `from`. */
  onDrop: (from: number, to: number) => void;
  /** Le tour suivant, une fois la liste rendue dans son nouvel ordre. */
  onSettled?: () => void;
}

/** La ligne tenue, côté React : de quoi rendre la copie et le squelette. */
interface Lifted<K> {
  key: K;
  y: number;
  h: number;
  bounds: DragState['bounds'];
}

/** L'état d'un geste en cours, hors React : lu et écrit par les rappels du geste seulement. */
interface Drag<K> {
  keys: K[];
  state: DragState;
  /** Dernières mesures reçues, relues d'un bloc quand les lignes changent de taille. */
  measured: Slot[];
  /** Translation du doigt, dernière valeur reçue. */
  translationY: number;
  /** Défilement automatique cumulé pendant le geste, en pt de contenu. */
  shift: number;
  absoluteY: number;
  /** Plus grand |déplacement| vu pendant le geste : l'auto-contrôle du lâcher s'en sert. */
  travel: number;
  rafId: number | null;
  /** Une relecture de la géométrie est programmée (les lignes ont changé de taille). */
  relayoutId: number | null;
  liftedAt: number;
}

function stopAutoScroll<K>(d: Drag<K>): void {
  if (d.rafId !== null) cancelAnimationFrame(d.rafId);
  d.rafId = null;
  if (d.relayoutId !== null) cancelAnimationFrame(d.relayoutId);
  d.relayoutId = null;
}

/** Profondeur du doigt dans la zone de bord : négative en haut, positive en bas, 0 ailleurs. */
function edgeDepth(absoluteY: number, viewport: { top: number; height: number }): number {
  // Pas encore mesurée (le `measureInWindow` du levé est asynchrone) : on ne défile pas.
  if (viewport.height <= 0) return 0;
  const top = viewport.top + EDGE_PT;
  const bottom = viewport.top + viewport.height - EDGE_PT;
  if (absoluteY < top) return absoluteY - top;
  if (absoluteY > bottom) return absoluteY - bottom;
  return 0;
}

export function useDragReorder<K extends string | number>(opts: Options<K>): DragList<K> {
  const scrollContext = useContext(DragScrollContext);
  const scroll = opts.scroll ?? scrollContext;
  // Les valeurs de la copie flottante : pilote JS, toutes (un même nœud ne mélange pas les
  // deux pilotes). Une seule vue, posée à chaque événement du doigt : c'est peu.
  const [dragY] = useState(() => new Animated.Value(0));
  const [scrollShift] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));
  // Le squelette et les écarts des autres lignes : pilote natif, des `timing` lancés du JS.
  const [placeholderY] = useState(() => new Animated.Value(0));
  const [lifted, setLifted] = useState<Lifted<K> | null>(null);
  const slots = useRef(new Map<K, Slot>());
  const drag = useRef<Drag<K> | null>(null);
  const active = lifted?.key ?? null;

  const { keys } = opts;
  /**
   * Les écarts des autres lignes, une valeur par clé, gardée d'un rendu et d'un instantané
   * à l'autre (voir l'en-tête : seule la valeur qui a déplacé la vue peut la ramener).
   */
  const offsets = useRef(new Map<K, Animated.Value>());
  /** Un écart ou le squelette a bougé depuis la dernière remise à zéro. */
  const displaced = useRef(false);
  const offsetOf = useCallback((key: K): Animated.Value => {
    let value = offsets.current.get(key);
    if (!value) {
      value = new Animated.Value(0);
      offsets.current.set(key, value);
    }
    return value;
  }, []);
  /**
   * Tout revient à 0, par le module animé : les écarts des lignes et le squelette. Appelé
   * au lâcher et à l'annulation, dans le même tour que le rendu du nouvel ordre, et à
   * chaque changement de liste hors geste (un écart ne survit jamais à un instantané).
   */
  const resetOffsets = useCallback(() => {
    if (!displaced.current) return;
    displaced.current = false;
    for (const value of offsets.current.values()) value.setValue(0);
    placeholderY.setValue(0);
  }, [placeholderY]);

  // La liste a changé (instantané, ordre en attente) sans geste en cours : aucun écart ne
  // doit rester, et les clés parties emportent leur valeur.
  useEffect(() => {
    if (drag.current) return;
    resetOffsets();
    const present = new Set<K>(keys);
    for (const key of [...offsets.current.keys()]) if (!present.has(key)) offsets.current.delete(key);
  }, [keys, resetOffsets]);

  // Les valeurs du doigt ne sont remises à zéro qu'une fois la copie vidée (après le rendu
  // du nouvel ordre) : les remettre avant ferait sauter la carte à son ancienne place.
  useEffect(() => {
    if (lifted !== null) return;
    dragY.setValue(0);
    scrollShift.setValue(0);
  }, [lifted, dragY, scrollShift]);

  // La copie suit le doigt plus le défilement, bornée à sa plage avec un élastique.
  const translate = useMemo(() => {
    if (!lifted) return null;
    const { minDy, maxDy } = lifted.bounds;
    return Animated.add(dragY, scrollShift).interpolate({
      inputRange: [minDy - RUBBER_IN, minDy, maxDy, maxDy + RUBBER_IN],
      outputRange: [minDy - RUBBER_OUT, minDy, maxDy, maxDy + RUBBER_OUT],
      extrapolate: 'clamp',
    });
  }, [lifted, dragY, scrollShift]);

  /** Une image de la machine à l'écran : les écarts des autres lignes et le squelette. */
  const applyFrame = useCallback(
    (d: Drag<K>, frame: DragFrame) => {
      const timing = (value: Animated.Value, toValue: number) =>
        Animated.timing(value, { toValue, duration: motion.fast, easing: Easing.out(Easing.quad), useNativeDriver: true });
      displaced.current = true;
      Animated.parallel([
        timing(placeholderY, frame.placeholderY),
        ...d.keys.flatMap((k, i) => (i !== d.state.from ? [timing(offsetOf(k), frame.moves[i] ?? 0)] : [])),
      ]).start();
    },
    [offsetOf, placeholderY],
  );

  const retarget = useCallback(
    (d: Drag<K>) => {
      const step = reduce(d.state, { type: 'move', dy: d.translationY + d.shift });
      if (!step.state || !step.frame) return;
      d.state = step.state;
      selection();
      applyFrame(d, step.frame);
    },
    [applyFrame],
  );

  // Une boucle d'images tant que le doigt reste près d'un bord : la liste défile, et la
  // carte reste sous le doigt immobile grâce à `scrollShift`.
  const autoScroll = useCallback(
    (d: Drag<K>) => {
      if (!scroll) return;
      if (edgeDepth(d.absoluteY, scroll.viewport.current) === 0) {
        stopAutoScroll(d);
        return;
      }
      if (d.rafId !== null) return;
      const tick = () => {
        d.rafId = null;
        if (drag.current !== d) return;
        const view = scroll.viewport.current;
        const depth = edgeDepth(d.absoluteY, view);
        if (depth === 0) return;
        const step = STEP_MIN + (STEP_MAX - STEP_MIN) * Math.min(1, Math.abs(depth) / EDGE_PT);
        const max = Math.max(0, scroll.contentHeight.current - view.height);
        const target = Math.max(0, Math.min(max, scroll.offsetY.current + Math.sign(depth) * step));
        const delta = target - scroll.offsetY.current;
        if (delta !== 0) {
          scroll.scrollRef.current?.scrollTo({ y: target, animated: false });
          scroll.offsetY.current = target;
          d.shift += delta;
          scrollShift.setValue(d.shift);
          retarget(d);
        }
        d.rafId = requestAnimationFrame(tick);
      };
      d.rafId = requestAnimationFrame(tick);
    },
    [scroll, scrollShift, retarget],
  );

  /** Un déplacement du doigt, sur le fil JS : la copie suit, la machine rejoue. */
  const onMove = useCallback(
    (translationY: number, absoluteY: number) => {
      const d = drag.current;
      if (!d) return;
      // Le défilement au doigt est coupé au premier déplacement, pas au levé : le levé ne
      // touche ainsi à rien d'autre que la ligne tenue (voir l'en-tête du fichier).
      if (d.travel === 0 && scroll) scroll.lock(true);
      d.translationY = translationY;
      d.absoluteY = absoluteY;
      d.travel = Math.max(d.travel, Math.abs(translationY + d.shift));
      dragY.setValue(translationY);
      retarget(d);
      autoScroll(d);
    },
    [scroll, dragY, retarget, autoScroll],
  );

  const rangeOf = (from: number): [number, number] => opts.range?.(from) ?? [0, keys.length - 1];

  const start = (key: K) => {
    if (drag.current || !opts.enabled) return;
    const from = keys.indexOf(key);
    if (from < 0) return;
    const step = reduce(null, { type: 'lift', index: from, slots: keys.map((k) => slots.current.get(k)), range: rangeOf(from), gap: opts.gap });
    if (!step.state || !step.frame) return;
    const held = step.state.slots[from] as Slot;
    // Le squelette naît à la place d'origine, avant d'apparaître.
    displaced.current = true;
    placeholderY.setValue(step.frame.placeholderY);
    drag.current = {
      keys: [...keys],
      state: step.state,
      measured: [...step.state.slots],
      translationY: 0,
      shift: 0,
      absoluteY: 0,
      travel: 0,
      rafId: null,
      relayoutId: null,
      liftedAt: Date.now(),
    };
    setLifted({ key, y: held.y, h: held.h, bounds: step.state.bounds });
    if (scroll) {
      const view = scroll.viewport;
      scroll.scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, y, _w, h) => {
        view.current = { top: y, height: h };
      });
    }
    impact(ImpactStyle.Medium);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1.02, damping: 18, stiffness: 220, useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 0.94, duration: motion.fast, useNativeDriver: false }),
    ]).start();
    opts.onLift?.();
  };

  const finish = (cancelled: boolean) => {
    const d = drag.current;
    if (!d) return;
    stopAutoScroll(d);
    const held = d.state.slots[d.state.from] as Slot;
    const step = reduce(d.state, { type: cancelled ? 'cancel' : 'release' });
    if (!step.drop) return;
    if (step.frame) applyFrame(d, step.frame);
    const { from, to, settle } = step.drop;
    const elapsed = Date.now() - d.liftedAt;
    // Le système a repris le toucher juste après le levé (défilement, remontage) : ce n'est
    // pas un geste de l'utilisateur, on remet en place sans retour haptique. Dit dans le
    // journal : c'est la classe de bug qui a déjà coûté deux correctifs.
    const silent = stolen(step.drop, elapsed);
    if (silent) console.warn(`${LOG_PREFIX} cancelled ${elapsed} ms after lift, the system took the touch back`);
    // Le doigt a parcouru plus que la hauteur de la ligne sans jamais changer de rang :
    // les déplacements n'atteignent pas la machine. Visible dans le journal, pas au doigt.
    if (deadMove(step.drop, d.travel, held.h)) {
      console.warn(`${LOG_PREFIX} travelled ${Math.round(d.travel)} pt over a ${Math.round(held.h)} pt row but the target never changed`);
    }
    Animated.parallel([
      Animated.timing(dragY, { toValue: settle - d.shift, duration: SETTLE_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(scale, { toValue: 1, duration: SETTLE_MS, useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 1, duration: SETTLE_MS, useNativeDriver: false }),
    ]).start(() => {
      if (drag.current !== d) return;
      drag.current = null;
      // Le même tour : les écarts et le squelette reviennent à 0 par le module animé, la
      // copie se vide, la vraie ligne redevient visible, et l'ordre visé se rend (`onDrop`).
      // Le module animé applique ses opérations juste après le montage de ce rendu : la
      // ligne écartée ne passe par aucune image intermédiaire.
      resetOffsets();
      setLifted(null);
      scroll?.lock(false);
      if (to !== from) notify(NotifyType.Success);
      else if (!silent) impact(ImpactStyle.Light);
      opts.onDrop(from, to);
      if (opts.onSettled) setTimeout(opts.onSettled, 0);
    });
  };

  // Un geste par ligne, refait à chaque rendu : `GestureDetector` garde le handler natif
  // et ne met à jour que sa configuration et ses rappels. Sans reanimated les rappels
  // tournent sur le fil JS ; `runOnJS(true)` le dit explicitement.
  const gesture = (key: K): PanGesture => {
    const index = keys.indexOf(key);
    const range = rangeOf(index);
    // Le geste actif reste actif : couper `enabled` en plein geste l'annulerait.
    const enabled = active === key || (active === null && opts.enabled && index >= 0 && range[0] < range[1]);
    return Gesture.Pan()
      .enabled(enabled)
      .activateAfterLongPress(LONG_PRESS_MS)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .runOnJS(true)
      .onStart(() => start(key))
      .onUpdate((e) => onMove(e.translationY, e.absoluteY))
      // `success` est faux quand le geste actif est CANCELLED ou FAILED.
      .onEnd((_e, success) => finish(!success));
  };

  // La ligne tenue reste en place, invisible : la copie la remplace à l'écran. Aucune autre
  // propriété ne change sur elle pendant le geste (voir l'en-tête du fichier).
  const itemStyle = (key: K): Animated.WithAnimatedValue<ViewStyle> => {
    if (active === key) return styles.hidden;
    return { transform: [{ translateY: offsetOf(key) }] };
  };

  const onItemLayout = (key: K) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    const slot = { y, h: height };
    slots.current.set(key, slot);
    const d = drag.current;
    if (!d) return;
    // Les lignes ont changé de taille pendant le geste (repli des onglets) : la géométrie
    // suit, une fois toutes les mesures du même rendu arrivées (une par ligne).
    const i = d.keys.indexOf(key);
    if (i < 0) return;
    d.measured[i] = slot;
    if (d.relayoutId !== null) return;
    d.relayoutId = requestAnimationFrame(() => {
      d.relayoutId = null;
      if (drag.current !== d) return;
      const relaid = reduce(d.state, { type: 'relayout', slots: [...d.measured] });
      if (!relaid.state || !relaid.frame) return;
      d.state = relaid.state;
      const held = relaid.state.slots[relaid.state.from] as Slot;
      setLifted((prev) => (prev ? { ...prev, y: held.y, h: held.h, bounds: relaid.state?.bounds ?? prev.bounds } : prev));
      // Le rang visé peut changer avec la nouvelle géométrie : une seule image, la dernière.
      const moved = reduce(d.state, { type: 'move', dy: d.translationY + d.shift });
      if (moved.state && moved.frame) {
        d.state = moved.state;
        applyFrame(d, moved.frame);
      } else {
        applyFrame(d, relaid.frame);
      }
    });
  };

  // Monté en permanence (voir l'en-tête) : au repos, sans hauteur et invisible.
  const placeholder = (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.placeholder,
        { height: lifted?.h ?? 0, opacity: lifted ? PLACEHOLDER_OPACITY : 0, borderRadius: opts.radius, transform: [{ translateY: placeholderY }] },
      ]}
    />
  );

  // Montée en permanence aussi : vide et invisible au repos, remplie au levé.
  const ghost = () => (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ghost,
        { top: lifted?.y ?? 0, borderRadius: opts.radius, transform: [{ translateY: translate ?? 0 }, { scale }], opacity: lifted ? opacity : 0 },
      ]}
    >
      {lifted ? opts.ghost(lifted.key) : null}
    </Animated.View>
  );

  return { active, gesture, itemStyle, onItemLayout, placeholder, ghost };
}

/** Une ligne de la liste : reçoit son écart, et s'efface quand elle est tenue (la copie flotte). */
export function DragItem<K extends string | number>({
  list,
  id,
  style,
  children,
}: {
  list: DragList<K>;
  id: K;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Animated.View style={[style, list.itemStyle(id)]} onLayout={list.onItemLayout(id)}>
      {children}
    </Animated.View>
  );
}

const styles = {
  hidden: { opacity: 0 } satisfies ViewStyle,
  ghost: {
    position: 'absolute',
    left: 0,
    right: 0,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    backgroundColor: colors.bg.raised,
  } satisfies ViewStyle,
  placeholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.strong,
    backgroundColor: colors.bg.raised,
  } satisfies ViewStyle,
};
