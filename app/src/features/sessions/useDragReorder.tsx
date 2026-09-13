// Glisser-déposer d'une liste verticale, sans reanimated : un `PanGestureHandler` par
// ligne qui s'active après 300 ms sans bouger, un seul `Animated.Value` natif pour la
// translation du doigt, et une valeur par ligne pour l'écart que les autres ouvrent. Les
// transformations restent sur le pilote natif ; le JS ne calcule que le rang visé.
//
// La liste rendue pendant le geste est figée par l'écran (les instantanés continuent
// d'arriver) : les clés sont stables, la géométrie vient de `onLayout` et se remet à jour
// si les lignes changent de taille (le repli des onglets au levé).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef, type ReactNode, type RefObject } from 'react';
import { Animated, Easing, type LayoutChangeEvent, type ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import {
  State,
  type HandlerStateChangeEvent,
  type PanGestureHandlerEventPayload,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerProps,
} from 'react-native-gesture-handler';
import { colors, motion, radius } from '@/theme';
import { ImpactStyle, NotifyType, impact, notify, selection } from '@/utils/haptics';
import { bounds as boundsOf, displacements, nextSlot, settleOffset, type Slot } from './dragSlots';

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

/** Tenir le doigt à moins de 72 pt d'un bord fait défiler, de 2 à 10 pt par image. */
const EDGE_PT = 72;
const STEP_MIN = 2;
const STEP_MAX = 10;
/** Course élastique au delà des bornes : 200 pt de doigt pour 48 pt de carte. */
const RUBBER_IN = 200;
const RUBBER_OUT = 48;
const SETTLE_MS = 180;

export interface DragList<K extends string | number> {
  active: K | null;
  handlerProps: (key: K) => PanGestureHandlerProps;
  itemStyle: (key: K) => Animated.WithAnimatedValue<ViewStyle>;
  onItemLayout: (key: K) => (e: LayoutChangeEvent) => void;
}

interface Options<K> {
  keys: K[];
  /** Espace entre deux lignes (le `gap` du conteneur). */
  gap: number;
  enabled: boolean;
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

interface Bounds {
  minDy: number;
  maxDy: number;
}

/** L'état d'un geste en cours, hors React : lu et écrit par les événements natifs seulement. */
interface Drag<K> {
  keys: K[];
  slots: Slot[];
  from: number;
  to: number;
  range: [number, number];
  gap: number;
  bounds: Bounds;
  /** Translation du doigt, dernière valeur reçue. */
  translationY: number;
  /** Défilement automatique cumulé pendant le geste, en pt de contenu. */
  shift: number;
  absoluteY: number;
  rafId: number | null;
  /** Une relecture de la géométrie est programmée (les lignes ont changé de taille). */
  relayoutId: number | null;
}

const sameBounds = (a: Bounds, b: Bounds): boolean => a.minDy === b.minDy && a.maxDy === b.maxDy;

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
  const [dragY] = useState(() => new Animated.Value(0));
  const [scrollShift] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));
  const [active, setActive] = useState<K | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  /** Les écarts des autres lignes : un jeu neuf à chaque lâcher, remis à zéro par le rendu. */
  const [generation, setGeneration] = useState(0);
  const slots = useRef(new Map<K, Slot>());
  const drag = useRef<Drag<K> | null>(null);

  const { keys } = opts;
  const offsets = useMemo(() => {
    void generation;
    return new Map(keys.map((k) => [k, new Animated.Value(0)] as const));
  }, [keys, generation]);

  // Les valeurs du doigt ne sont remises à zéro qu'une fois la carte détachée d'elles (après
  // le rendu du nouvel ordre) : les remettre avant ferait sauter la carte à son ancienne place.
  useEffect(() => {
    if (active !== null) return;
    dragY.setValue(0);
    scrollShift.setValue(0);
  }, [active, dragY, scrollShift]);

  // La carte tenue suit le doigt plus le défilement, bornée à sa plage avec un élastique.
  const translate = useMemo(() => {
    if (!bounds) return null;
    const { minDy, maxDy } = bounds;
    return Animated.add(dragY, scrollShift).interpolate({
      inputRange: [minDy - RUBBER_IN, minDy, maxDy, maxDy + RUBBER_IN],
      outputRange: [minDy - RUBBER_OUT, minDy, maxDy, maxDy + RUBBER_OUT],
      extrapolate: 'clamp',
    });
  }, [bounds, dragY, scrollShift]);

  const shiftRows = useCallback(
    (d: Drag<K>) => {
      const moves = displacements(d.slots, d.from, d.to, d.gap);
      Animated.parallel(
        d.keys.flatMap((k, i) => {
          const value = offsets.get(k);
          return value && i !== d.from
            ? [Animated.timing(value, { toValue: moves[i] ?? 0, duration: motion.fast, easing: Easing.out(Easing.quad), useNativeDriver: true })]
            : [];
        }),
      ).start();
    },
    [offsets],
  );

  const retarget = useCallback(
    (d: Drag<K>) => {
      const next = nextSlot(d.slots, d.from, d.to, d.translationY + d.shift, d.gap, d.range);
      if (next === d.to) return;
      d.to = next;
      selection();
      shiftRows(d);
    },
    [shiftRows],
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

  const onMove = useCallback(
    (e: PanGestureHandlerGestureEvent) => {
      const d = drag.current;
      if (!d) return;
      d.translationY = e.nativeEvent.translationY;
      d.absoluteY = e.nativeEvent.absoluteY;
      retarget(d);
      autoScroll(d);
    },
    [retarget, autoScroll],
  );

  // Un seul événement animé, passé à tous les gestionnaires : seul l'actif émet. Le
  // `listener` ne tourne que sur un événement natif, jamais pendant un rendu.
  const onGestureEvent = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => Animated.event([{ nativeEvent: { translationY: dragY } }], { useNativeDriver: true, listener: onMove }),
    [dragY, onMove],
  );

  const rangeOf = (from: number): [number, number] => opts.range?.(from) ?? [0, keys.length - 1];

  const start = (key: K) => {
    if (drag.current || !opts.enabled) return;
    const from = keys.indexOf(key);
    if (from < 0) return;
    const range = rangeOf(from);
    const measured = keys.map((k) => slots.current.get(k));
    if (range[0] >= range[1] || measured.some((s, i) => !s && i >= range[0] && i <= range[1])) return;
    const list = measured.map((s) => s ?? { y: 0, h: 0 });
    const b = boundsOf(list, from, range);
    drag.current = { keys: [...keys], slots: list, from, to: from, range, gap: opts.gap, bounds: b, translationY: 0, shift: 0, absoluteY: 0, rafId: null, relayoutId: null };
    setBounds(b);
    setActive(key);
    if (scroll) {
      scroll.lock(true);
      scroll.scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, y, _w, h) => {
        scroll.viewport.current = { top: y, height: h };
      });
    }
    impact(ImpactStyle.Medium);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1.02, damping: 18, stiffness: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.94, duration: motion.fast, useNativeDriver: true }),
    ]).start();
    opts.onLift?.();
  };

  const finish = (cancelled: boolean) => {
    const d = drag.current;
    if (!d) return;
    stopAutoScroll(d);
    if (cancelled && d.to !== d.from) {
      d.to = d.from;
      shiftRows(d);
    }
    const { from, to } = d;
    Animated.parallel([
      Animated.timing(dragY, { toValue: settleOffset(d.slots, from, to) - d.shift, duration: SETTLE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: SETTLE_MS, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: SETTLE_MS, useNativeDriver: true }),
    ]).start(() => {
      if (drag.current !== d) return;
      drag.current = null;
      // Le même tour : les transformations disparaissent avec le rendu du nouvel ordre (un
      // jeu d'écarts neuf, la carte rendue sans son interpolation).
      setGeneration((g) => g + 1);
      setBounds(null);
      setActive(null);
      scroll?.lock(false);
      if (to !== from) notify(NotifyType.Success);
      else impact(ImpactStyle.Light);
      opts.onDrop(from, to);
      if (opts.onSettled) setTimeout(opts.onSettled, 0);
    });
  };

  const onStateChange = (key: K, e: HandlerStateChangeEvent<PanGestureHandlerEventPayload>) => {
    const { state } = e.nativeEvent;
    if (state === State.ACTIVE) start(key);
    else if (state === State.END) finish(false);
    else if (state === State.CANCELLED || state === State.FAILED) finish(true);
  };

  const handlerProps = (key: K): PanGestureHandlerProps => {
    const index = keys.indexOf(key);
    const range = rangeOf(index);
    // Le gestionnaire actif reste actif : couper `enabled` en plein geste l'annulerait.
    return {
      enabled: active === key || (active === null && opts.enabled && index >= 0 && range[0] < range[1]),
      activateAfterLongPress: 300,
      maxPointers: 1,
      shouldCancelWhenOutside: false,
      onGestureEvent,
      onHandlerStateChange: (e) => onStateChange(key, e),
    };
  };

  const itemStyle = (key: K): Animated.WithAnimatedValue<ViewStyle> => {
    if (active === key && translate) {
      return { ...styles.lifted, transform: [{ translateY: translate }, { scale }], opacity };
    }
    const offset = offsets.get(key);
    return offset ? { transform: [{ translateY: offset }] } : {};
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
    d.slots[i] = slot;
    if (d.relayoutId !== null) return;
    d.relayoutId = requestAnimationFrame(() => {
      d.relayoutId = null;
      if (drag.current !== d) return;
      const b = boundsOf(d.slots, d.from, d.range);
      if (!sameBounds(b, d.bounds)) {
        d.bounds = b;
        setBounds(b);
      }
      retarget(d);
    });
  };

  return { active, handlerProps, itemStyle, onItemLayout };
}

/** Une ligne de la liste : reçoit son écart, et l'allure « soulevée » quand elle est tenue. */
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
  lifted: {
    zIndex: 10,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    backgroundColor: colors.bg.raised,
    borderRadius: radius.md,
  } satisfies ViewStyle,
};
