import type { StorybookConfig } from '@storybook/angular';

/**
 * Storybook for the `nxs-` component library — the parity surface, the human documentation and
 * the agent's usage reference (`satori_component_library` plan, section 9.4).
 *
 * Builds without a Satori token: nothing reachable from here, from `preview.ts` or from the
 * default theme imports `@hylandsoftware/*` or `@alfresco/*`. `checkSatoriComponentsDependencies`
 * holds that statically, and CI builds this Storybook with both scopes removed from
 * `node_modules`. The product theme is the opt-in `satori` configuration of `build-storybook`.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  // The application's catalogue, for components whose chrome is translated through ngx-translate
  // under keys the application owns, such as `nxs-permissions-panel`.
  staticDirs: [{ from: '../../../../apps/nuxeo-ui/public/i18n', to: 'i18n' }],
  addons: [],
  framework: {
    name: '@storybook/angular',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
};

export default config;
