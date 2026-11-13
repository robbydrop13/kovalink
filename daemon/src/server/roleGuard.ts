import type { ErrorPayload } from '@kovalink/protocol';
import type { FastifyInstance } from 'fastify';
import type { KovalinkConfig } from '../config.js';

/**
 * Familles de routes fermees sur un Mac secondaire. Elles pilotent des outils du Mac
 * principal (`attn`, `routinectl`, `team`) : sur un Mac de secours, une routine lancee
 * ou une carte fermee le serait en double, ou sur un etat qui n'est pas celui de Robin.
 */
const PRIMARY_ONLY = ['/v1/attention', '/v1/routines', '/v1/agents'];

export function primaryOnly(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return PRIMARY_ONLY.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Refus explicite, comme les messages de lot 2 : `FORBIDDEN_ACTION` et une phrase, pas
 * un 404 que l'app prendrait pour une divergence de contrat. `preHandler` : l'auth
 * (`onRequest`) passe avant, un appel sans jeton reste un 401.
 */
export function registerRoleGuard(app: FastifyInstance, cfg: () => KovalinkConfig): void {
  app.addHook('preHandler', async (req, reply) => {
    if (cfg().role !== 'secondary' || !primaryOnly(req.url)) return;
    const payload: ErrorPayload = {
      code: 'FORBIDDEN_ACTION',
      message: 'available on the primary Mac only',
      retryable: false,
    };
    return reply.code(403).send(payload);
  });
}
