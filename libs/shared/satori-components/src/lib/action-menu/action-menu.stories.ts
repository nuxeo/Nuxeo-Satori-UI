import type { Meta, StoryObj } from '@storybook/angular';
import { fn, userEvent, within } from 'storybook/test';

import { NxsActionMenuComponent, type NxsMenuAction } from './action-menu.component';

/** Browse's header menu for a folder the user does not follow: the packaged `contextMenu` slot. */
const BROWSE_HEADER: readonly NxsMenuAction[] = [
  { id: 'app.contextMenu.share', label: 'Share', icon: 'share' },
  { id: 'app.contextMenu.subscribe', label: 'Notify Me', icon: 'notifications' },
  { id: 'app.contextMenu.export', label: 'Export', icon: 'ios_share' },
];

/**
 * An icon button that opens a menu of actions. The host resolves its slot's descriptors into
 * entries — labels translated, enabled rules evaluated — and runs the one `selected` names; the
 * menu runs nothing itself.
 */
const meta: Meta<NxsActionMenuComponent> = {
  title: 'Actions/Action menu',
  component: NxsActionMenuComponent,
  tags: ['autodocs'],
  args: { actions: BROWSE_HEADER, label: 'More actions', icon: 'more_vert', selected: fn() },
  argTypes: {
    actions: { description: 'The entries, in order, already translated. Required.' },
    label: { control: 'text', description: 'The trigger’s accessible name and tooltip. Required.' },
    icon: { control: 'text', description: 'The trigger’s Material icon.' },
    selected: { control: false, description: 'The entry chosen. Never a disabled one.' },
  },
};

export default meta;

type Story = StoryObj<NxsActionMenuComponent>;

/** Open it and choose an entry: `selected` carries it, with its registered ID. */
export const BrowseHeader: Story = {};

/**
 * Export with an `enabledRule` that says no, as a manifest can give it: shown, but it cannot be
 * chosen, and the arrow keys pass over it.
 */
export const WithADisabledEntry: Story = {
  args: {
    actions: BROWSE_HEADER.map((action) =>
      action.id === 'app.contextMenu.export' ? { ...action, disabled: true } : action,
    ),
  },
};

/**
 * Opened with Enter from the focused trigger, so the first entry has keyboard focus. The arrow keys
 * move between entries, Enter chooses one, and Escape closes the menu and returns focus to the
 * trigger.
 */
export const OpenedFromTheKeyboard: Story = {
  args: WithADisabledEntry.args,
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('button', { name: 'More actions' }).focus();
    await userEvent.keyboard('{Enter}');
  },
};

/** A manifest hid every entry: no trigger renders, rather than a button that opens an empty menu. */
export const EveryEntryHidden: Story = {
  args: { actions: [] },
};
