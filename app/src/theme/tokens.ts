// Tokens de design, source unique. Recopiés de docs/02-design.md section 2.
// v1 : mode sombre uniquement (A9). Le jeu clair est spécifié dans le document mais
// n'est volontairement pas câblé ici.

export const dark = {
  bg: {
    base: '#0B0D10',
    raised: '#14171C',
    overlay: '#1B1F26',
    inset: '#070809',
    pressed: '#1F242B',
    scrim: 'rgba(0,0,0,0.60)',
  },
  border: { subtle: '#23272F', strong: '#333944', focus: '#4C8DFF' },
  text: {
    primary: '#E8EAED',
    secondary: '#9BA3AF',
    tertiary: '#7C8593',
    disabled: '#5A616D',
    inverse: '#0B0D10',
    onFill: '#FFFFFF',
  },
  accent: { primary: '#4C8DFF', primaryPressed: '#3A79E6', subtleBg: '#12213A' },
  status: {
    awaiting: '#FFB020',
    awaitingBg: '#2A1F08',
    working: '#38BDF8',
    workingBg: '#0A1F2B',
    idle: '#7C8593',
    closed: '#5A616D',
    error: '#FF5C5C',
    success: '#3DD68C',
  },
  action: {
    approve: { bg: '#1C8052', bgPressed: '#166843', text: '#FFFFFF' },
    reject: { bg: '#B02A22', bgPressed: '#8E211B', text: '#FFFFFF' },
    always: { border: '#2E9E63', bg: '#101C16', text: '#6FE0A6' },
    neutral: { bg: '#2A2F38', text: '#E8EAED' },
    interrupt: { border: '#FF5C5C', text: '#FF7A7A' },
  },
  link: {
    direct: '#3DD68C',
    relayed: '#4C8DFF',
    connecting: '#FFB020',
    macUnreachable: '#FF9F45',
    offline: '#FF5C5C',
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
  tab: ['#FF6B6B', '#FF9F45', '#FFD84D', '#4ADE80', '#60A5FA', '#C084FC'],
  tabNone: '#7C8593',
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
