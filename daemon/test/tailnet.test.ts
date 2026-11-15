import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasTailnetBind,
  parseBackend,
  TAILNET_GRACE_MS,
  TAILNET_OK,
  tailnetState,
  tailnetStep,
  tailnetWarning,
  type TailnetWatch,
} from '../src/net/tailnet.js';

const LOOPBACK = ['127.0.0.1', '::1'];
const WITH_TAILNET = [...LOOPBACK, '100.122.21.106', 'fd7a:115c:a1e0::62f:156b'];
const RESCAN = 30_000;

/**
 * 12/11/2026 17:07 : le Mac redemarre, Tailscale se lance sans se connecter. Le daemon
 * n'ecoute que la loopback pendant 28 heures et ne dit rien ; le telephone affiche
 * « No sessions ». L'ecoute Tailscale revient le 13/11 a 21:40, quand Tailscale est
 * reconnecte a la main.
 */
describe('ecoute Tailscale absente : le telephone ne joint plus le Mac', () => {
  it('reconnait une adresse Tailscale parmi les ecouteurs', () => {
    assert.equal(hasTailnetBind(LOOPBACK), false);
    assert.equal(hasTailnetBind(WITH_TAILNET), true);
    assert.equal(hasTailnetBind(['127.0.0.1', '192.168.1.20']), false);
  });

  it('lit l etat de Tailscale dans `tailscale status --json`', () => {
    assert.equal(parseBackend(JSON.stringify({ BackendState: 'Stopped', Peer: {} })), 'Stopped');
    assert.equal(parseBackend(JSON.stringify({ BackendState: 'Running' })), 'Running');
    assert.equal(parseBackend('{}'), null);
    assert.equal(parseBackend('Tailscale is stopped.'), null);
  });

  it('rejoue le redemarrage du 12/11 : alerte et une seule reconnexion, apres le delai', () => {
    const start = Date.parse('2026-11-12T16:07:02Z');
    let watch: TailnetWatch = TAILNET_OK;
    const seen: string[] = [];
    // Vingt minutes de re-scans, Tailscale lance mais arrete.
    for (let t = start; t <= start + 20 * 60_000; t += RESCAN) {
      const step = tailnetStep(watch, hasTailnetBind(LOOPBACK), 'Stopped', t, { autoUp: true });
      watch = step.state;
      if (step.warn) seen.push(`warn+${t - start}`);
      if (step.tryUp) seen.push(`up+${t - start}`);
    }
    assert.deepEqual(seen, [`warn+${TAILNET_GRACE_MS}`, `up+${TAILNET_GRACE_MS}`], 'une alerte, une tentative, pas avant deux minutes');
    assert.equal(watch.missingSince, start);
    // `tailscale up` a pris : l'adresse revient au re-scan suivant.
    const back = tailnetStep(watch, hasTailnetBind(WITH_TAILNET), 'Running', start + 21 * 60_000, { autoUp: true });
    assert.deepEqual(back.state, TAILNET_OK);
    assert.equal(back.recoveredAfterMs, 21 * 60_000);
    assert.equal(back.warn || back.tryUp, false);
  });

  it('ne dit rien pendant le delai de montee ni pour une coupure de trente secondes', () => {
    let watch: TailnetWatch = TAILNET_OK;
    const a = tailnetStep(watch, false, 'Starting', 0, { autoUp: true });
    watch = a.state;
    const b = tailnetStep(watch, false, 'Starting', RESCAN, { autoUp: true });
    assert.equal(a.warn || a.tryUp || b.warn || b.tryUp, false);
    const c = tailnetStep(b.state, true, 'Running', 2 * RESCAN, { autoUp: true });
    assert.equal(c.recoveredAfterMs, null, 'une coupure jamais annoncee ne s annonce pas retablie');
  });

  it('ne touche jamais a un Tailscale deconnecte de son compte, ni quand le reglage l interdit', () => {
    const late = { missingSince: 0, warned: false, upTried: false };
    const login = tailnetStep(late, false, 'NeedsLogin', TAILNET_GRACE_MS, { autoUp: true });
    assert.equal(login.warn, true);
    assert.equal(login.tryUp, false);
    const off = tailnetStep(late, false, 'Stopped', TAILNET_GRACE_MS, { autoUp: false });
    assert.equal(off.warn, true);
    assert.equal(off.tryUp, false);
    const unknown = tailnetStep(late, false, null, TAILNET_GRACE_MS, { autoUp: true });
    assert.equal(unknown.tryUp, false, 'etat inconnu : on ne lance rien');
    // Arrete plus tard, apres un etat inconnu : la tentative part alors, une fois.
    const then = tailnetStep(unknown.state, false, 'Stopped', TAILNET_GRACE_MS + RESCAN, { autoUp: true });
    assert.equal(then.tryUp, true);
    assert.equal(then.warn, false, 'deja dit');
    assert.equal(tailnetStep(then.state, false, 'Stopped', TAILNET_GRACE_MS + 2 * RESCAN, { autoUp: true }).tryUp, false);
  });

  it('`status` dit la panne et quoi faire, et se tait quand tout va bien', () => {
    const start = Date.parse('2026-11-12T16:07:02Z');
    const down: TailnetWatch = { missingSince: start, warned: true, upTried: true };
    const stopped = tailnetWarning(tailnetState(down, false, 'Stopped'), start + 3_600_000);
    assert.match(stopped ?? '', /aucune ecoute Tailscale depuis 2026-11-12T16:07:02\.000Z, le telephone ne peut pas joindre ce Mac/);
    assert.match(stopped ?? '', /tailscale up/);
    assert.match(tailnetWarning(tailnetState(down, false, 'NeedsLogin'), start + 3_600_000) ?? '', /reconnecte toi/);
    assert.equal(tailnetWarning(tailnetState(down, false, 'Stopped'), start + 60_000), null, 'encore dans le delai');
    assert.equal(tailnetWarning(tailnetState(TAILNET_OK, true, 'Running'), start), null);
    assert.equal(tailnetWarning(undefined, start), null, 'etat publie par un daemon plus ancien');
  });
});
