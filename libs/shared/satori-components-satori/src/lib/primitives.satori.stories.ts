import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { provideRouter, withDisabledInitialNavigation, withHashLocation } from '@angular/router';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideAndConfigureSatoriTranslations } from '@hylandsoftware/satori-ui/translations';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { NXS_PRIMITIVE_IDS, provideNxsComponents } from '@nuxeo/satori-platform/components';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';

import { provideNxsSatoriComponents } from './provide-nxs-satori-components';

/**
 * The same template and inputs as `satori-components`' "Primitives/By registered ID" story, with
 * `provideNxsSatoriComponents()` listed after `provideNxsComponents()`: each ID now resolves to
 * its Satori implementation, and nothing in the template changed.
 *
 * Also what a host owes Satori: `provideSatori()` for the theme and icons, and Satori's `sat.*`
 * catalogue — here through upstream's `provideAndConfigureSatoriTranslations`.
 *
 * The router is `satori-components`' story router: the breadcrumb's `/browse` link matches a route
 * that renders nothing, and hash location keeps a followed link inside the story's iframe.
 */
const meta: Meta = {
  title: 'Primitives/By registered ID',
  decorators: [
    applicationConfig({
      providers: [
        provideAndConfigureSatoriTranslations({ fallbackLang: 'en' }),
        provideRouter(
          [{ path: 'browse', children: [] }],
          withHashLocation(),
          withDisabledInitialNavigation(),
        ),
        provideSatori(),
        provideNxsComponents(),
        provideNxsSatoriComponents(),
      ],
    }),
    moduleMetadata({ imports: [ExtensionOutletComponent, MatIconModule, MatButtonModule] }),
  ],
};

export default meta;

export const SatoriRegistration: StoryObj = {
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
      // The card takes its handlers as inputs, like every other ID: the outlet binds no outputs.
      // These do nothing — the story is the card's appearance — but an `openHandler` is what makes
      // the card one that opens something, which is how browse and search render it.
      openCard: () => undefined,
      selectCard: () => undefined,
    },
    template: `
      <div style="display: grid; gap: 16px; justify-items: start">
        <lib-extension-outlet [componentId]="ids.avatar" [componentInputs]="avatar" />
        <lib-extension-outlet [componentId]="ids.breadcrumbs" [componentInputs]="breadcrumbs" />
        <lib-extension-outlet [componentId]="ids.tag" [componentInputs]="tag" />
        <lib-extension-outlet [componentId]="ids.statusTag" [componentInputs]="statusTag" />
        <lib-extension-outlet [componentId]="ids.richTooltip" [componentInputs]="tooltip" />
        <!--
          Sized like the tabs below: the error state fills a region, where the primitives above are
          small and inline. An outlet is an inline custom element and \`justify-items: start\`
          shrink-wraps it, which leaves a region-filling child 0 px wide.
        -->
        <lib-extension-outlet
          style="display: block; width: 420px"
          [componentId]="ids.errorState"
          [componentInputs]="errorState"
        />
        <ng-template #tabBody let-tab>
          <p style="padding: 16px">The {{ tab.label }} tab body.</p>
        </ng-template>
        <lib-extension-outlet
          style="display: flex; flex-direction: column; width: 480px; height: 120px"
          [componentId]="ids.tabs"
          [componentInputs]="{ tabs, label: 'Document views', selectedIndex: 0, body: tabBody }"
        />
        <lib-extension-outlet [componentId]="ids.actionBar" [componentInputs]="actionBar" />
        <ng-template #cardMedia>
          <mat-icon aria-hidden="true" style="font-size: 40px; width: 40px; height: 40px"
            >description</mat-icon
          >
        </ng-template>
        <lib-extension-outlet
          style="display: block; inline-size: 200px"
          [componentId]="ids.card"
          [componentInputs]="{
            heading: 'Claim 42 — water damage.pdf',
            subheading: 'File',
            selectionLabel: 'Select Claim 42 — water damage.pdf',
            selectionHandler: selectCard,
            openHandler: openCard,
            media: cardMedia
          }"
        />
        <ng-template #emptyActions>
          <button mat-flat-button type="button">Create folder</button>
        </ng-template>
        <lib-extension-outlet
          style="display: block; inline-size: 320px"
          [componentId]="ids.emptyState"
          [componentInputs]="{
            heading: 'No documents here',
            message: 'Drag a file in, or create a folder to get started.',
            icon: 'folder_open',
            actions: emptyActions
          }"
        />
      </div>
    `,
  }),
};
