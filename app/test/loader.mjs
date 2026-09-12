// Crochet de résolution pour `node --test` : l'alias `@/` de tsconfig et les imports sans
// extension des sources TypeScript. Aucune dépendance, aucun transpileur : Node 22 dépouille
// les types lui même. Seules les fonctions PURES sont testées ici, jamais un module qui
// touche React Native ou un module natif Expo.
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function toFile(base) {
  for (const suffix of CANDIDATES) {
    const path = base + suffix;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith('@/')) {
    base = resolvePath(SRC, specifier.slice(2));
  } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.endsWith('.ts') || parent.endsWith('.tsx')) {
      base = resolvePath(dirname(parent), specifier);
    }
  }
  if (base) {
    const file = toFile(base);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return next(specifier, context);
}
