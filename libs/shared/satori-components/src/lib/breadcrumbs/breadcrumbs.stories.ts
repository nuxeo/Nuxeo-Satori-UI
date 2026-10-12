import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { ExtensionOutletComponent } from '@nuxeo-satori/platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsBreadcrumbsComponent } from './breadcrumbs.component';

const meta: Meta<NxsBreadcrumbsComponent> = {
  title: 'Primitives/Breadcrumbs',
  component: NxsBreadcrumbsComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
  ],
  args: {
    label: 'Breadcrumbs',
    items: [
      { label: 'Domain', routerLink: ['/browse'], queryParams: { path: '/default-domain' } },
      {
        label: 'Workspaces',
        routerLink: ['/browse'],
        queryParams: { path: '/default-domain/workspaces' },
      },
      { label: 'Contracts' },
    ],
  },
};

export default meta;

type Story = StoryObj<NxsBreadcrumbsComponent>;

/** The last item has no link, so it is announced as the current page. */
export const Trail: Story = {};

/** Items with `href` are plain links, for pages outside the application. */
export const PlainLinks: Story = {
  args: {
    items: [
      { label: 'Intranet', href: 'https://intranet.example.com' },
      { label: 'Policies', href: 'https://intranet.example.com/policies' },
      { label: 'Records retention' },
    ],
  },
};

export const SingleItem: Story = { args: { items: [{ label: 'Domain' }] } };

/** A long trail wraps; Satori's implementation collapses the middle into a menu instead. */
export const LongTrail: Story = {
  args: {
    items: ['Domain', 'Workspaces', 'Legal', 'Contracts', '2026', 'Q3', 'Suppliers', 'Acme'].map(
      (label, index, all) =>
        index === all.length - 1
          ? { label }
          : { label, routerLink: ['/browse'], queryParams: { index } },
    ),
  },
};

/** Rendered by ID, the way a screen resolves `nxs.primitives.breadcrumbs`. */
export const ByRegisteredId: Story = {
  name: 'By Registered ID',
  decorators: [
    applicationConfig({ providers: [provideTranslateService(), provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  render: (args) => ({
    props: {
      breadcrumbsId: NXS_PRIMITIVE_IDS.breadcrumbs,
      inputs: { items: args.items, label: args.label },
    },
    template: `<lib-extension-outlet [componentId]="breadcrumbsId" [componentInputs]="inputs" />`,
  }),
};
