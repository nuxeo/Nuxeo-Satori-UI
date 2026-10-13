import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fireEvent, fn, waitFor, within } from 'storybook/test';

import { NxsTabBodyDirective, type NxsTab } from './tab-body.directive';
import { NxsTabsComponent } from './tabs.component';

/** The packaged `tabs` slot of a File the user can manage, plus one a manifest adds. */
const FILE_TABS: readonly NxsTab[] = [
  { id: 'app.tabs.view', label: 'View', icon: 'visibility' },
  { id: 'app.tabs.permissions', label: 'Permissions', icon: 'lock' },
  { id: 'app.tabs.history', label: 'History', icon: 'history' },
  { id: 'app.tabs.publishing', label: 'Publishing', icon: 'publish' },
  { id: 'acme.tabs.claims', label: 'Claims', icon: 'assignment' },
];

const BODY = `
  <nxs-tabs [tabs]="tabs" [label]="label" [selectedIndex]="selectedIndex" (selectedTabChange)="selectedTabChange($event)" style="height: 220px">
    <ng-template nxsTabBody let-tab>
      <p style="padding: 16px">The {{ tab.label }} tab body, rendered for <code>{{ tab.id }}</code>.</p>
    </ng-template>
  </nxs-tabs>
`;

/**
 * The tab strip of a document page. The host resolves its `tabs` slot into entries and marks one
 * template every body renders from, so a tab a manifest adds renders like a packaged one.
 */
const meta: Meta<NxsTabsComponent> = {
  title: 'Documents/Tabs',
  component: NxsTabsComponent,
  tags: ['autodocs'],
  decorators: [moduleMetadata({ imports: [NxsTabBodyDirective] })],
  render: (args) => ({ props: args, template: BODY }),
  args: {
    tabs: FILE_TABS,
    label: 'Document views',
    selectedIndex: 0,
    selectedTabChange: fn(),
  },
  argTypes: {
    tabs: { description: 'The tabs, in display order, already translated. Required.' },
    label: { control: 'text', description: 'The tab list’s accessible name. Optional.' },
    selectedIndex: {
      control: { type: 'number', min: 0, max: 4 },
      description: 'The selected tab’s position. Two-way.',
    },
    selectedTabChange: { control: false, description: 'The tab selected, by ID.' },
  },
};

export default meta;

type Story = StoryObj<NxsTabsComponent>;

/** Four packaged tabs and a contributed "Claims" tab, all rendered from one body template. */
export const FileTabs: Story = {};

/** The host selects Publishing itself, as the Properties panel's Publications count does. */
export const SelectedByTheHost: Story = { args: { selectedIndex: 3 } };

/** The arrow keys move between tabs and Enter selects one. */
export const SelectedFromTheKeyboard: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const view = await canvas.findByRole('tab', { name: /View/ });
    view.focus();
    // With `keyCode`, as a browser sends it: Material's key manager reads it and the synthetic
    // `userEvent.keyboard` events leave it unset.
    fireEvent.keyDown(view, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
    const permissions = canvas.getByRole('tab', { name: /Permissions/ });
    await waitFor(() => expect(permissions).toHaveFocus());
    fireEvent.keyDown(permissions, { key: 'Enter', code: 'Enter', keyCode: 13 });
    await waitFor(() =>
      expect(canvas.getByRole('tab', { name: /Permissions/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    await expect(args.selectedTabChange).toHaveBeenCalled();
  },
};
