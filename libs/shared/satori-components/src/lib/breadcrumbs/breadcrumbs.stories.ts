import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { NxsBreadcrumbsComponent } from './breadcrumbs.component';

const meta: Meta<NxsBreadcrumbsComponent> = {
  title: 'Primitives/Breadcrumbs',
  component: NxsBreadcrumbsComponent,
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
