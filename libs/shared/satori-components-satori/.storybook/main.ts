import type { StorybookConfig } from '@storybook/angular';

/**
 * The Satori-backed primitives, rendered by ID (plan section 9.4: the Satori variants get their
 * own stories, out of the token-free build). Needs `@hylandsoftware/satori-ui` installed, so a
 * GitHub Packages token; `satori-components`' Storybook is the one that builds without.
 */
const config: StorybookConfig = {
  stories: [
    '../../satori-components/.storybook/getting-started.mdx',
    '../../satori-components/src/**/*.mdx',
    '../../satori-components/src/**/*.stories.ts',
    '../src/**/*.stories.ts',
  ],
  staticDirs: [
    { from: '../../../../apps/nuxeo-ui/public/i18n', to: 'i18n' },
    {
      from: '../../../../node_modules/@hylandsoftware/satori-ui/i18n',
      to: 'i18n/@hylandsoftware/satori-ui',
    },
  ],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/angular',
    options: {},
  },
  docs: {
    defaultName: 'API',
  },
  core: {
    disableTelemetry: true,
  },
};

export default config;
