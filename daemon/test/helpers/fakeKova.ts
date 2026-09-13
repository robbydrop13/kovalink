import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Delai d'inactivite du faux Kova. Il vaut 5 s sur la vraie machine. */
export const FAKE_KOVA_IDLE_MS = 120;

/**
 * Faux Kova, calque sur le comportement MESURE de Kova 1.11.0 : toute connexion
 * inactive depuis un delai est fermee par le serveur, SAUF celle qui porte un
 * abonnement. Chaque commande recue est enregistree et emise (`command`), ce qui
 * permet de tester `KeyGate` contre un VRAI `KovaIpc` plutot qu'un faux objet.
 */
export class FakeKova extends EventEmitter {
  readonly dir = mkdtempSync(join(tmpdir(), 'kovalink-sock-'));
  path = join(this.dir, `kova-${process.pid}.sock`);
  private server: Server | null = null;
  subscriptions: Socket[] = [];
  /** Nombre de connexions fermees pour inactivite : le cas nominal des requetes. */
  idleClosures = 0;
  /** Toutes les commandes recues hors `subscribe`, dans l'ordre. */
  received: Record<string, unknown>[] = [];
  /**
   * Reponse sur mesure a une commande, `null` pour la reponse par defaut (`ok`, tableau
   * vide). Sert a jouer un Kova trop vieux (`unknown command: move-tab`) ou un
   * `swap-pane` refuse, sans toucher au vrai `KovaIpc` qui parle au faux.
   */
  respond: ((msg: Record<string, unknown>) => { ok: boolean; data?: unknown; error?: string } | null) | null = null;

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((sock) => {
        let subscribed = false;
        let timer: NodeJS.Timeout | null = null;
        const armIdle = (): void => {
          if (timer) clearTimeout(timer);
          if (subscribed) return;
          timer = setTimeout(() => {
            this.idleClosures += 1;
            sock.destroy();
          }, FAKE_KOVA_IDLE_MS);
          timer.unref?.();
        };
        armIdle();
        sock.setEncoding('utf8');
        sock.on('data', (chunk: string) => {
          for (const line of chunk.split('\n').filter((l) => l.trim() !== '')) {
            const msg = JSON.parse(line) as Record<string, unknown>;
            if (msg['cmd'] === 'subscribe') {
              subscribed = true;
              if (timer) clearTimeout(timer);
              this.subscriptions.push(sock);
              sock.write(`${JSON.stringify({ ok: true, data: { panes: [] } })}\n`);
              continue;
            }
            this.received.push(msg);
            this.emit('command', msg);
            const custom = this.respond?.(msg) ?? null;
            sock.write(`${JSON.stringify(custom ?? { ok: true, data: [] })}\n`);
            armIdle();
          }
        });
        sock.on('error', () => undefined);
      });
      this.server.listen(this.path, () => {
        chmodSync(this.path, 0o600);
        resolve();
      });
    });
  }

  /** Coupe l'abonnement cote serveur : c'est le vrai incident. */
  dropSubscription(): void {
    for (const s of this.subscriptions) s.destroy();
    this.subscriptions = [];
  }

  stop(): void {
    this.server?.close();
    for (const s of this.subscriptions) s.destroy();
  }
}
