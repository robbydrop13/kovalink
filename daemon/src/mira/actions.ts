// Validation d'un geste venu de l'iPhone, AVANT de parler a Mira.
//
// Tout ce qui est refuse ici est refuse avec sa cause, en 400. Une touche hors liste, un
// texte trop long, une URL `file://` ne partent jamais vers la socket. Le detail d'audit
// ne porte jamais le texte tape (sa longueur seulement, comme `pane.sendText`) ni une URL
// entiere (l'hote seulement).
import {
  MIRA_KEYS,
  MIRA_MODIFIERS,
  MIRA_SCROLL_MAX,
  MIRA_TEXT_MAX,
  type MiraAction,
  type MiraModifier,
} from '@kovalink/protocol';

export type ParsedAction = { action: MiraAction } | { error: string };

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Une touche nommee de la liste, ou un caractere imprimable seul. */
export function isAllowedKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (MIRA_KEYS.includes(key)) return true;
  return key.length === 1 && key >= ' ' && key !== '\x7f';
}

/**
 * Une URL de navigation : http ou https seulement, `example.com` complete en `https://`.
 * `null` pour tout le reste (`file://`, `chrome://`, `javascript:`, une chaine vide).
 */
export function normalizeNavUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url.toString();
}

export function parseMiraAction(body: unknown): ParsedAction {
  const b = (body ?? {}) as Record<string, unknown>;
  switch (b['kind']) {
    case 'click':
      if (!finite(b['x']) || !finite(b['y']) || b['x'] < 0 || b['y'] < 0) return { error: 'click needs x and y in CSS pixels' };
      return { action: { kind: 'click', x: Math.round(b['x']), y: Math.round(b['y']) } };
    case 'type': {
      const text = b['text'];
      if (typeof text !== 'string' || text.length === 0) return { error: 'type needs a text' };
      if (text.length > MIRA_TEXT_MAX) return { error: `text too long (max ${MIRA_TEXT_MAX} chars)` };
      return { action: { kind: 'type', text } };
    }
    case 'key': {
      if (!isAllowedKey(b['key'])) return { error: 'key not allowed' };
      const mods = b['modifiers'];
      if (mods !== undefined) {
        if (!Array.isArray(mods) || !mods.every((m) => (MIRA_MODIFIERS as readonly string[]).includes(String(m)))) {
          return { error: 'modifiers must be among shift, ctrl, alt, meta' };
        }
      }
      const modifiers = mods as MiraModifier[] | undefined;
      return { action: { kind: 'key', key: b['key'], ...(modifiers?.length ? { modifiers } : {}) } };
    }
    case 'scroll':
      if (!finite(b['dy'])) return { error: 'scroll needs dy' };
      return { action: { kind: 'scroll', dy: Math.round(Math.max(-MIRA_SCROLL_MAX, Math.min(MIRA_SCROLL_MAX, b['dy']))) } };
    case 'nav': {
      const url = normalizeNavUrl(b['url']);
      if (!url) return { error: 'nav needs an http or https URL' };
      return { action: { kind: 'nav', url } };
    }
    case 'back':
    case 'forward':
    case 'reload':
    case 'activate':
      return { action: { kind: b['kind'] } };
    default:
      return { error: 'unknown action kind' };
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Detail d'audit : la nature du geste, jamais son contenu. */
export function auditDetail(action: MiraAction): string {
  switch (action.kind) {
    case 'click':
      return `x=${action.x} y=${action.y}`;
    case 'type':
      return `len=${action.text.length}`;
    case 'key':
      return `key=${action.key === ' ' ? 'Space' : action.key.length === 1 ? 'char' : action.key}${action.modifiers?.length ? ` mods=${action.modifiers.join('+')}` : ''}`;
    case 'scroll':
      return `dy=${action.dy}`;
    case 'nav':
      return `host=${hostOf(action.url)}`;
    default:
      return '';
  }
}
