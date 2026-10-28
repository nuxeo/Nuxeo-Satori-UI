import satoriAdoption from '@hylandsoftware/satori-lint/stylelint/satori-adoption.stylelintrc';

export default {
  ...satoriAdoption,
  ignoreFiles: ['**/dist/**', '**/node_modules/**', '**/out-tsc/**'],
  rules: {
    ...satoriAdoption.rules,
    // DS-internal overrides are tracked by `npm run satori:check` — 1 left as of 2026-10-28, down
    // from the 167 this comment used to cite. Still a warning only because promoting it to `error`
    // on the last one is a change that should fail a pull request deliberately, not as a side
    // effect of a docs update: fix that override, then flip this and watch something go red.
    // `docs/satori-adoption-dashboard.md` has the current count and the command that produces it.
    '@hylandsoftware/satori-lint/stylelint/no-ds-internals-overrides': [
      true,
      { severity: 'warning' },
    ],
  },
};
