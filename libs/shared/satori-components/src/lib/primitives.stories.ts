import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { provideStoryRouter } from '../../.storybook/story-router';
import { NXS_PRIMITIVE_IDS } from './primitives';
import { provideNxsComponents } from './provide-nxs-components';

/**
 * The `nxs.primitives.*` IDs, each of which Satori also implements, resolved through
 * `lib-extension-outlet` as a host renders them, with only `provideNxsComponents()` — what an
 * application without Satori gets. The Satori library's Storybook renders the same template with
 * `provideNxsSatoriComponents()` added.
 *
 * It names no component, so it has no API page; `primitives.mdx` is its Overview.
 */
const meta: Meta = {
  title: 'Primitives/By registered ID',
  decorators: [
    applicationConfig({
      providers: [provideStoryRouter(), provideNxsComponents()],
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
      errorState: {
        status: 500,
        heading: 'Failed to load folder contents.',
        retryable: true,
      },
      tabs: [
        { id: 'app.tabs.view', label: 'View' },
        { id: 'app.tabs.permissions', label: 'Permissions' },
        { id: 'app.tabs.history', label: 'History' },
        { id: 'acme.tabs.claims', label: 'Claims' },
      ],
      actionBar: {
        moreLabel: 'More actions',
        actions: [
          { id: 'app.toolbar.edit', label: 'Edit', icon: 'pencil' },
          { id: 'app.toolbar.addToCollection', label: 'Add to collection', icon: 'add_list' },
          {
            id: 'app.toolbar.unlock',
            label: 'Unlock',
            icon: 'lock',
            tooltip: 'Locked by Jane Doe on May 3, 2026',
            disabled: true,
            active: true,
          },
          { id: 'app.toolbar.delete', label: 'Delete', icon: 'trash' },
          { id: 'app.toolbar.publish', label: 'Publish document', icon: 'publish', overflow: true },
          { id: 'app.toolbar.export', label: 'Export', icon: 'import_export', overflow: true },
        ],
      },
    },
    template: `
      <div style="display: grid; gap: 16px; justify-items: start">
        <lib-extension-outlet [componentId]="ids.avatar" [componentInputs]="avatar" />
        <lib-extension-outlet [componentId]="ids.breadcrumbs" [componentInputs]="breadcrumbs" />
        <lib-extension-outlet [componentId]="ids.tag" [componentInputs]="tag" />
        <lib-extension-outlet [componentId]="ids.statusTag" [componentInputs]="statusTag" />
        <lib-extension-outlet [componentId]="ids.richTooltip" [componentInputs]="tooltip" />
        <lib-extension-outlet [componentId]="ids.errorState" [componentInputs]="errorState" />
        <ng-template #tabBody let-tab>
          <p style="padding: 16px">The {{ tab.label }} tab body.</p>
        </ng-template>
        <lib-extension-outlet
          style="display: flex; flex-direction: column; width: 480px; height: 120px"
          [componentId]="ids.tabs"
          [componentInputs]="{ tabs, label: 'Document views', selectedIndex: 0, body: tabBody }"
        />
        <lib-extension-outlet [componentId]="ids.actionBar" [componentInputs]="actionBar" />
      </div>
    `,
  }),
};
