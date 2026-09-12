const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'targets/**'],
  },
  {
    rules: {
      'import/no-unresolved': 'off',
    },
  },
];
