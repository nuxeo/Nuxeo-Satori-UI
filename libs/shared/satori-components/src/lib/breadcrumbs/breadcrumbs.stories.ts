import { ExtensionOutletComponent } from '@nuxeo-satori/platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, spyOn, waitFor, within } from 'storybook/test';

import { provideStoryRouter } from '../../../.storybook/story-router';
import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsBreadcrumbsComponent } from './breadcrumbs.component';

const meta: Meta<NxsBreadcrumbsComponent> = {
  title: 'Primitives/Breadcrumbs',
  component: NxsBreadcrumbsComponent,
  tags: ['autodocs'],
  decorators: [applicationConfig({ providers: [provideStoryRouter()] })],
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

/**
 * Following a router link navigates the story's own router: the iframe's hash changes, the trail
 * stays on screen, and nothing is logged.
 */
export const FollowingALink: Story = {
  name: 'Following a Link',
  play: async ({ canvas, userEvent }) => {
    window.history.replaceState(null, '', `${location.pathname}${location.search}`);
    const errors = spyOn(console, 'error');
    try {
      await userEvent.click(canvas.getByRole('link', { name: 'Domain' }));
      await waitFor(() => expect(location.hash).toBe('#/browse?path=%2Fdefault-domain'));
      await expect(location.pathname).toMatch(/\/iframe\.html$/);
      await expect(canvas.getByRole('link', { name: 'Workspaces' })).toBeVisible();
      await expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  },
};

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

const LONG_TRAIL = [
  'Domain',
  'Workspaces',
  'Legal',
  'Contracts',
  '2026',
  'Q3',
  'Suppliers',
  'Acme',
].map((label, index, all) =>
  index === all.length - 1 ? { label } : { label, routerLink: ['/browse'], queryParams: { index } },
);

/** A long trail in a wide box: every item shows, on one line. */
export const LongTrail: Story = {
  args: { items: LONG_TRAIL },
};

/**
 * The same trail in a 360-pixel box: the items after the first fold into "…", furthest from the
 * current page first, and the menu lists them in order.
 */
export const CollapsedTrail: Story = {
  args: { items: LONG_TRAIL },
  render: (args) => ({
    props: args,
    template: `<div style="width: 360px"><nxs-breadcrumbs [items]="items" [label]="label" /></div>`,
  }),
  play: async ({ canvas, userEvent }) => {
    const more = await canvas.findByRole('button', { name: 'Show more breadcrumbs' });
    await expect(canvas.getByRole('link', { name: 'Domain' })).toBeVisible();
    await expect(canvas.getByText('Acme')).toHaveAttribute('aria-current', 'page');
    await userEvent.click(more);
    const menu = within(canvas.getByRole('link', { name: 'Domain' }).ownerDocument.body);
    await expect(await menu.findByRole('menuitem', { name: 'Workspaces' })).toBeVisible();
  },
};

/** In a 120-pixel box only the first, "…" and the current page remain, the page's name cut short. */
export const VeryNarrow: Story = {
  args: { items: LONG_TRAIL },
  render: (args) => ({
    props: args,
    template: `<div style="width: 120px"><nxs-breadcrumbs [items]="items" [label]="label" /></div>`,
  }),
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
