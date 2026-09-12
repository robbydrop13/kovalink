// Genere les constantes du protocole dont les cibles Swift (NSE) ont besoin.
//
// La NSE ne peut pas importer `@kovalink/protocol` : sans ce fichier, son port de repli
// etait une constante en dur qui ne correspondait pas a `DEFAULT_PORT`. Le fichier
// est regenere a chaque `npm run build` a la racine (donc a chaque `protocol:sync` de
// l'app), et `protocol.test.ts` verifie qu'il est a jour.
import { readFileSync, writeFileSync } from 'node:fs';
import { stdout } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { DEFAULT_PORT } = await import(resolve(here, '../dist/index.js'));

export const SWIFT_TARGET = resolve(here, '../../../app/targets/notification-service/ProtocolConstants.swift');

export function renderSwift() {
  return `// GENERE par packages/protocol/scripts/gen-swift.mjs, ne pas modifier a la main.
// Source de verite : packages/protocol/src/pairing.ts (DEFAULT_PORT).

enum KovaLinkProtocol {
    /// Port d'ecoute par defaut du daemon. Repli quand le trousseau n'a pas de \`kl.port\`.
    static let defaultPort = ${DEFAULT_PORT}
}
`;
}

const next = renderSwift();
let current = '';
try {
  current = readFileSync(SWIFT_TARGET, 'utf8');
} catch {
  /* premier passage */
}
if (current !== next) {
  writeFileSync(SWIFT_TARGET, next);
  stdout.write(`protocole : ${SWIFT_TARGET} regenere (defaultPort=${DEFAULT_PORT})\n`);
}
