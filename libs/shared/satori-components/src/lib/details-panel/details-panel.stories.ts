import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NxsDetailsPanelComponent, type NxsDetailsPanelTab } from './details-panel.component';

const VIEWS: readonly NxsDetailsPanelTab[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'comments', label: 'Comments' },
  { id: 'activity', label: 'Activity' },
];

/**
 * The side panel of a document page: a header with a close button, a strip of views, and the
 * selected view's content, which the host projects.
 */
const meta: Meta<NxsDetailsPanelComponent> = {
  title: 'Documents/Details panel',
  component: NxsDetailsPanelComponent,
  tags: ['autodocs'],
  render: (args) => ({
    props: args,
    template: `
      <nxs-details-panel [heading]="heading" [label]="label" [tabs]="tabs" [selected]="selected" [closeLabel]="closeLabel" (closed)="closed()" style="width: 380px; height: 260px; border: 1px solid var(--mat-sys-outline-variant)">
        <p>The {{ selected }} view's content, projected by the page.</p>
      </nxs-details-panel>
    `,
  }),
  args: {
    heading: 'Quarterly report.pdf',
    label: 'Document properties',
    tabs: VIEWS,
    selected: 'properties',
    closeLabel: '',
    closed: fn(),
  },
  argTypes: {
    heading: { control: 'text', description: 'The header text, usually the file name.' },
    label: {
      control: 'text',
      description: 'The region’s accessible name. Blank falls back to `heading`.',
    },
    tabs: { description: 'The views, in order, already translated. Required.' },
    selected: {
      control: 'select',
      options: ['properties', 'comments', 'activity'],
      description: 'The selected view’s ID. Two-way.',
    },
    closeLabel: {
      control: 'text',
      description: 'The close button’s name. Blank falls back to “Close details”.',
    },
    closed: { control: false, description: 'The close button was pressed.' },
  },
};

export default meta;

type Story = StoryObj<NxsDetailsPanelComponent>;

/** Properties, Comments and Activity, with Properties selected. */
export const DocumentDetails: Story = {};

/** A document without the Commentable facet: Web UI offers no Comments view, so neither does the page. */
export const NotCommentable: Story = {
  args: { tabs: VIEWS.filter((view) => view.id !== 'comments') },
};

/** The arrow keys move between views and select them. */
export const SwitchedFromTheKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole('tab', { name: 'Properties' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('tab', { name: 'Comments' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};
