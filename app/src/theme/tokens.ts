// Tokens de design, source unique. Palette : design system Claap, depuis ./ds
// (généré depuis packages/protocol/tokens/ds.json).
// v1 : mode sombre uniquement (A9). Le jeu clair est spécifié dans le design system mais
// n'est volontairement pas câblé ici.
import { ds } from './ds';

export const dark = {
  bg: {
    base: ds.dark.bg0,
    raised: ds.dark.bg1,
    overlay: ds.dark.bgElev,
    inset: ds.dark.bg0,
    pressed: ds.dark.hover,
    scrim: 'rgba(0,0,0,0.60)',
  },
  border: { subtle: ds.dark.b3, strong: ds.dark.b2, focus: ds.dark.selRail },
  text: {
    primary: ds.dark.t1,
    secondary: ds.dark.t2,
    tertiary: ds.dark.t3,
    disabled: '#7a7a7a',
    inverse: ds.dark.bg0,
    onFill: '#FFFFFF',
  },
  accent: { primary: ds.dark.accent, primaryPressed: ds.dark.accentHover, subtleBg: ds.dark.selBg },
  status: {
    awaiting: ds.dark.warnDot,
    awaitingBg: ds.dark.warnBg,
    working: ds.dark.infoDot,
    workingBg: ds.dark.selBg,
    idle: ds.dark.t3,
    closed: '#7a7a7a',
    error: ds.dark.critDot,
    success: ds.dark.okDot,
  },
  action: {
    approve: { bg: ds.dark.accent, bgPressed: ds.dark.accentHover, text: '#FFFFFF' },
    reject: { bg: '#ED3726', bgPressed: '#CC2314', text: '#FFFFFF' },
    always: { border: ds.dark.okDot, bg: ds.dark.bg1, text: ds.dark.ok },
    neutral: { bg: ds.dark.btn2, text: ds.dark.t1 },
    interrupt: { border: ds.dark.critDot, text: ds.dark.crit },
  },
  link: {
    direct: ds.dark.okDot,
    relayed: ds.dark.infoDot,
    connecting: ds.dark.warnDot,
    macUnreachable: ds.dark.warnDot,
    offline: ds.dark.critDot,
  },
  diff: {
    addBg: '#10251A',
    addText: '#7EE2AC',
    addGutter: '#1C8052',
    delBg: '#2B1416',
    delText: '#FF9E96',
    delGutter: '#B02A22',
    ctxText: '#9BA3AF',
    lineNo: '#5A616D',
    hunkBg: '#101720',
    hunkText: '#7C8593',
  },
  syn: {
    keyword: '#C792EA',
    string: '#9ECE6A',
    number: '#FF9E64',
    comment: '#6B7280',
    function: '#7AA2F7',
    type: '#2AC3DE',
    punct: '#9BA3AF',
  },
  tab: [
    ds.tagDots.dark.red,
    ds.tagDots.dark.orange,
    ds.tagDots.dark.yellow,
    ds.tagDots.dark.green,
    ds.tagDots.dark.blue,
    ds.tagDots.dark.violet,
  ],
  tabNone: ds.dark.t3,
} as const;

export const space = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

export const radius = { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, full: 999 } as const;

export const motion = {
  instant: 100,
  fast: 160,
  base: 220,
  slow: 320,
  enter: 220,
  exit: 160,
  pulse: 1400,
  spinner: 900,
} as const;

export const type = {
  display: { size: 28, line: 34, weight: '700', tracking: -0.4 },
  title1: { size: 22, line: 28, weight: '600', tracking: -0.3 },
  title2: { size: 17, line: 22, weight: '600', tracking: -0.2 },
  body: { size: 17, line: 24, weight: '400', tracking: 0 },
  bodyStrong: { size: 17, line: 24, weight: '600', tracking: 0 },
  callout: { size: 15, line: 20, weight: '400', tracking: 0 },
  calloutStrong: { size: 15, line: 20, weight: '600', tracking: 0 },
  /** Lignes d'action du chat : 14 pt secondaire (docs/13, point 5). */
  action: { size: 14, line: 18, weight: '400', tracking: 0 },
  footnote: { size: 13, line: 18, weight: '400', tracking: 0 },
  caption: { size: 11, line: 14, weight: '500', tracking: 0.2 },
  monoCode: { size: 13, line: 20, weight: '400', tracking: 0, mono: true },
  monoCodeInline: { size: 15, line: 20, weight: '400', tracking: 0, mono: true },
  monoDiff: { size: 12, line: 18, weight: '400', tracking: 0, mono: true },
  monoTerminal: { size: 12, line: 16, weight: '400', tracking: 0, mono: true },
  monoPath: { size: 13, line: 18, weight: '400', tracking: 0, mono: true },
} as const;

// Constantes de gabarit, section 2.4.
export const layout = {
  screenPaddingH: 16,
  navBarHeight: 44,
  rowMinHeight: 64,
  touchMin: 44,
  touchPrimary: 60,
  composerMinHeight: 52,
  composerMaxHeight: 148,
  validationBarMaxHeight: 268,
  bubbleMaxWidthRatio: 0.82,
  assistantMaxWidthRatio: 0.92,
  thumbZone: 220,
  // Fenêtre d'armement de la barre de validation, section 4.3.4.
  armingWindowMs: 400,
  // Repli monospace, section 4.6 et point 9 du lot 1.
  monospaceFallbackLines: 30,
} as const;

// Police monospace : SF Mono n'est pas exposée aux applications tierces sous ce nom,
// Menlo est le repli documenté du design.
export const MONO_FAMILY = 'Menlo';

export type TypeToken = keyof typeof type;
