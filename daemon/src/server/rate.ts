/** Limitation de debit par `deviceId`, jamais par IP : sur Tailscale relaye, plusieurs
 *  chemins presentent la meme adresse, et il n'existe qu'un utilisateur legitime. */
const RATE_RULES: Record<string, number> = {
  interrupt: 30,
  answer: 30,
  text: 30,
  prompt: 60,
  panes: 120,
  // La vue Term sonde l'ecran a 1 Hz (60/min) : de la marge pour le pull-to-refresh.
  screen: 150,
  launch: 10,
  // Terminal depuis l'app : une ligne ou une touche par geste, les fleches s'enchainent vite.
  terminal: 240,
  turns: 120,
  // Bloc C. Un dossier profond se parcourt vite : le quota de listing est large.
  // Les morceaux d'upload ne sont pas limites du tout, un fichier de 3 Go en compte 750.
  fsList: 300,
  fsRead: 300,
  audit: 60,
  // Navigateur : le miroir sonde l'onglet toutes les 700 ms (4 captures/s de marge), et
  // un formulaire se remplit a coups de taps et de touches (10 gestes/s).
  miraShot: 240,
  miraAct: 600,
  health: 60,
  pair: 10,
  authFail: 10,
};

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** Vrai si l'appel passe. Faux s'il depasse le quota de la minute glissante. */
  allow(key: string, action: string, now = Date.now()): boolean {
    const limit = RATE_RULES[action];
    if (limit === undefined) return true;
    const id = `${action}:${key}`;
    const bucket = this.buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(id, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
  }

  sweep(now = Date.now()): void {
    for (const [id, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(id);
  }
}

/** 10 echecs en 5 min bloquent le deviceId 15 min. L'IP n'est qu'auditee. */
export class AuthFailures {
  private readonly fails = new Map<string, { count: number; until: number }>();

  blocked(key: string, now = Date.now()): boolean {
    const f = this.fails.get(key);
    return !!f && f.until > now && f.count >= RATE_RULES['authFail']!;
  }

  record(key: string, now = Date.now()): void {
    const f = this.fails.get(key);
    if (!f || f.until <= now) {
      this.fails.set(key, { count: 1, until: now + 5 * 60_000 });
      return;
    }
    f.count += 1;
    if (f.count >= RATE_RULES['authFail']!) f.until = now + 15 * 60_000;
  }

  clear(key: string): void {
    this.fails.delete(key);
  }
}
