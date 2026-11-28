import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { StorybookConfig } from '@storybook/angular';

/** The application's catalogues, copied to `i18n/` below and fetched by `preview.ts`. */
const CATALOGUE_DIR = join(import.meta.dirname, '../../../../apps/nuxeo-ui/public/i18n');

/**
 * A content hash of the catalogues this build ships, which `preview.ts` puts on the URL it fetches
 * them from.
 *
 * Every other file a built Storybook serves has a hash in its name, so a browser or a CDN holding
 * an old copy is holding it under an old name and the new build never asks for it. The catalogues
 * are copied in by `staticDirs` and keep their own names, so they are the one output that *can* be
 * served stale to a bundle that expects the new one — and GitHub Pages serves them with
 * `cache-control: max-age=600`. For ten minutes after a deploy that adds keys, the previous
 * catalogue answers the new bundle and every key added in that deploy renders as the raw key.
 *
 * That is not hypothetical: it is what NXSAT-331's three components showed on the published docs
 * pages. Putting the hash on the query string makes the catalogue part of the cache key, so a
 * build only ever reads the catalogue it was built against.
 */
const catalogueVersion = createHash('sha256')
  .update(
    readdirSync(CATALOGUE_DIR)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => `${file}:${readFileSync(join(CATALOGUE_DIR, file), 'utf8')}`)
      .join('\n'),
  )
  .digest('hex')
  .slice(0, 16);

/**
 * Storybook for the `nxs-` component library — the parity surface, the human documentation and
 * the agent's usage reference (`satori_component_library` plan, section 9.4).
 *
 * Each component has an **Overview** (an MDX page beside its stories), an **API** page (the
 * `autodocs` page, which `preview.ts` renders from Compodoc's output) and its stories.
 * `getting-started.mdx` comes first.
 *
 * Builds without a Satori token: nothing reachable from here, from `preview.ts` or from the
 * default theme imports `@hylandsoftware/*` or `@alfresco/*`. `checkSatoriComponentsDependencies`
 * holds that statically, and CI builds this Storybook with both scopes removed from
 * `node_modules`. The product theme is the opt-in `satori` configuration of `build-storybook`.
 */
const config: StorybookConfig = {
  stories: ['./getting-started.mdx', '../src/**/*.mdx', '../src/**/*.stories.ts'],
  // The application's catalogue, for components whose chrome is translated through ngx-translate
  // under keys the application owns, such as `nxs-permissions-panel`.
  staticDirs: [{ from: '../../../../apps/nuxeo-ui/public/i18n', to: 'i18n' }],
  // Read by `preview.ts` as `process.env.NXS_CATALOGUE_VERSION`, which webpack inlines, so the
  // version travels in the same hashed bundle as the code that fetches the catalogue.
  env: (config) => ({ ...config, NXS_CATALOGUE_VERSION: catalogueVersion }),
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/angular',
    options: {},
  },
  docs: {
    // The page `autodocs` generates for each component. `preview.ts` renders it as the inputs and
    // outputs reference, so it is named for what it shows.
    defaultName: 'API',
  },
  core: {
    disableTelemetry: true,
  },
};

export default config;
