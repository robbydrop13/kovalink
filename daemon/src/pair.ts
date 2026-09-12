import { hostname } from 'node:os';

import { encodePairPayload, PAIRING_PAYLOAD_VERSION, PAIRING_TTL_MS } from '@kovalink/protocol';

import { loadConfig } from './config.js';
import { consumePairing, readPairing, writePairing } from './pairing.js';

const ESC = String.fromCharCode(27);
/** Efface l'ecran, puis le scrollback, puis repositionne le curseur. */
const CLEAR_SCREEN = `${ESC}[2J${ESC}[3J${ESC}[H`;

/**
 * Affiche le QR d'appairage hors bande.
 *
 * Le terminal de Robin EST un pane Kova : tout ce qui s'y affiche atterrit dans
 * `~/Library/Logs/Kova/pty-capture-*.raw`, un fichier en 0644 lisible par tout compte
 * local. Le TTL de `PAIRING_TTL_MS` limite le risque, l'effacement de l'ecran le referme.
 */
export async function runPair(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.tsDns) {
    process.stderr.write(
      'Aucun nom MagicDNS configure. Renseigne `tsDns` dans ~/.kovalink/config.json.\n',
    );
    process.exitCode = 1;
    return;
  }

  const { code, expiresAt } = writePairing();
  // Format defini dans `@kovalink/protocol` : source unique de verite, l'app le decode
  // avec la meme fonction. C'est ce qui manquait et qui rendait le QR inutilisable.
  const url = encodePairPayload({
    v: PAIRING_PAYLOAD_VERSION,
    code,
    tsDns: cfg.tsDns,
    port: cfg.port,
    name: hostname().replace(/\.local$/, ''),
    exp: expiresAt,
  });

  const qrcode = (await import('qrcode-terminal')).default;
  process.stdout.write('\nScanne ce code depuis KovaLink sur ton iPhone.\n\n');
  qrcode.generate(url, { small: true });
  process.stdout.write(
    `\nValide ${Math.round(PAIRING_TTL_MS / 60_000)} minutes, usage unique.\n`,
  );

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (!readPairing()) {
        clearInterval(timer);
        resolve();
      }
    }, 1000);
    const deadline = setTimeout(
      () => {
        clearInterval(timer);
        resolve();
      },
      Math.max(1000, expiresAt - Date.now()),
    );
    deadline.unref?.();
  });

  consumePairing();
  process.stdout.write(CLEAR_SCREEN);
  process.stdout.write('Appairage termine : code consomme ou expire.\n');
}
