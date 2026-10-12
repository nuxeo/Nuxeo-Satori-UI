import type { StorybookConfig } from '@storybook/angular';

/**
 * The Satori-backed primitives, rendered by ID (plan section 9.4: the Satori variants get their
 * own stories, out of the token-free build). Needs `@hylandsoftware/satori-ui` installed, so a
 * GitHub Packages token; `satori-components`' Storybook is the one that builds without.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  // Satori's `sat.*` catalogue, where `provideAndConfigureSatoriUITranslations` fetches it.
  staticDirs: [
    {
      from: '../../../../node_modules/@hylandsoftware/satori-ui/i18n',
      to: 'i18n/@hylandsoftware/satori-ui',
    },
  ],
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
