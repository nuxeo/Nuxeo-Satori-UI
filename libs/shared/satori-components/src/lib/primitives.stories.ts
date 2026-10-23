import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';

import { provideStoryRouter } from '../../.storybook/story-router';
import { NXS_PRIMITIVE_IDS } from './primitives';
import { provideNxsComponents } from './provide-nxs-components';

/**
 * The five `nxs.primitives.*` IDs Satori also implements, resolved through `lib-extension-outlet` as
 * a host renders them, with only `provideNxsComponents()` — what an application without Satori
 * gets. The Satori library's Storybook renders the same template with `provideNxsSatoriComponents()`
 * added.
 *
 * It names no component, so it has no API page; `primitives.mdx` is its Overview.
 */
const meta: Meta = {
  title: 'Primitives/By registered ID',
  decorators: [
    applicationConfig({
      providers: [provideTranslateService(), provideStoryRouter(), provideNxsComponents()],
    }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
};

export default meta;

export const MaterialRegistration: StoryObj = {
  render: () => ({
    props: {
      ids: NXS_PRIMITIVE_IDS,
      avatar: { initials: 'NK', color: 'teal', label: 'Narasimha Koppula' },
      breadcrumbs: {
        label: 'Breadcrumbs',
        items: [{ label: 'Domain', routerLink: ['/browse'] }, { label: 'Contracts' }],
      },
      tag: { label: 'Invoice', color: 'purple' },
      statusTag: { label: 'In progress', status: 'info', hideIcon: false },
      tooltip: {
        heading: 'Versioning',
        content: 'A new version is created each time you check in.',
        triggerLabel: 'About versioning',
      },
    },
    template: `
      <div style="display: grid; gap: 16px; justify-items: start">
        <lib-extension-outlet [componentId]="ids.avatar" [componentInputs]="avatar" />
        <lib-extension-outlet [componentId]="ids.breadcrumbs" [componentInputs]="breadcrumbs" />
        <lib-extension-outlet [componentId]="ids.tag" [componentInputs]="tag" />
        <lib-extension-outlet [componentId]="ids.statusTag" [componentInputs]="statusTag" />
        <lib-extension-outlet [componentId]="ids.richTooltip" [componentInputs]="tooltip" />
      </div>
    `,
  }),
};
