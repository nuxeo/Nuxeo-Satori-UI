import satoriAdoption from '@hylandsoftware/satori-lint/stylelint/satori-adoption.stylelintrc';

export default {
  ...satoriAdoption,
  ignoreFiles: ['**/dist/**', '**/node_modules/**', '**/out-tsc/**'],
  rules: {
    ...satoriAdoption.rules,
    // 167 DS-internal overrides are tracked by `npm run satori:check`.
    // Warn until the override count is reduced; then flip to error.
    '@hylandsoftware/satori-lint/stylelint/no-ds-internals-overrides': [true, { severity: 'warning' }],
  },
};
