import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Regles de projet. La plus importante est la premiere : `sendKeys` est le point
 * d'ecriture brute vers un pane, et `KeyGate` en est le SEUL appelant autorise.
 */
export default tseslint.config(
  // `app/` porte sa propre configuration : ce fichier couvre le daemon et le protocole.
  // `.claude/` accueille les worktrees des autres agents : jamais lintes d'ici.
  { ignores: ['**/dist/**', '**/node_modules/**', 'app/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/kova/sendKeys.js', './sendKeys.js', '../kova/sendKeys.js'],
              message:
                'Ecriture vers un pane : passe par KeyGate. Voir daemon/src/kova/keygate.ts.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='0.0.0.0']",
          message: 'Bind exclusif : loopback et Tailscale uniquement, jamais 0.0.0.0.',
        },
        {
          selector: "Property[key.name='cmd'][value.value='send-keys']",
          message: 'send-keys ne se construit que dans kova/sendKeys.ts, appele par KeyGate.',
        },
        {
          selector: "ImportSpecifier[imported.name='claimRawChannel']",
          message: 'Le canal brut IPC est reserve a kova/sendKeys.ts (K1).',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    // Le seul fichier autorise a importer sendKeys.js et a construire la commande.
    files: ['daemon/src/kova/keygate.ts', 'daemon/src/kova/sendKeys.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['daemon/src/kova/keygate.ts'],
    rules: {
      // La suppression des C0 passe forcement par une classe de caracteres de controle.
      'no-control-regex': 'off',
    },
  },
  {
    // Les tests doivent pouvoir nommer les commandes qu'ils verifient etre refusees.
    // La regle reste stricte sur `daemon/src`, ou un test dedie balaye les sources.
    files: ['daemon/test/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['daemon/src/kova/ipc.ts'],
    rules: {
      // Le garde-fou runtime qui refuse `send-keys` doit pouvoir nommer la commande.
      'no-restricted-syntax': 'off',
    },
  },
);
