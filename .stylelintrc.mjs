import satoriAdoption from '@hylandsoftware/satori-lint/stylelint/satori-adoption.stylelintrc';

export default {
  ...satoriAdoption,
  ignoreFiles: ['**/dist/**', '**/node_modules/**', '**/out-tsc/**'],
  rules: {
    ...satoriAdoption.rules,
    // DS-internal overrides are tracked by `npm run satori:check` — 1 *unsuppressed* as of
    // 2026-10-28, down from the 167 this comment used to cite. The other 154 are still here,
    // each behind a `stylelint-disable-next-line` across 32 files, so that drop was mostly
    // suppression rather than removal.
    //
    // Which is why promoting this to `error` is smaller than it sounds: a disable comment
    // suppresses an error exactly as it suppresses a warning, so the flip binds only the one
    // remaining finding and anything new. Worth doing as a ratchet, but do it deliberately in a
    // change of its own and watch something go red — not as a side effect of a docs update.
    // `docs/satori-adoption-dashboard.md` has the counts and the command that produces them.
    '@hylandsoftware/satori-lint/stylelint/no-ds-internals-overrides': [
      true,
      { severity: 'warning' },
    ],
  },
};
