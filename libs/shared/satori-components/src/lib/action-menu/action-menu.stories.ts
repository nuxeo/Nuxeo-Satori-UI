import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test';

import { NxsActionMenuComponent, type NxsMenuAction } from './action-menu.component';

/** Browse's header menu for a folder the user does not follow: the packaged `contextMenu` slot. */
const BROWSE_HEADER: readonly NxsMenuAction[] = [
  { id: 'app.contextMenu.share', label: 'Share', icon: 'share' },
  { id: 'app.contextMenu.subscribe', label: 'Notify Me', icon: 'bell' },
  { id: 'app.contextMenu.export', label: 'Export', icon: 'import_export' },
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
    label: {
      control: 'text',
      description:
        'The trigger’s accessible name and tooltip. Required; blank falls back to “More actions”.',
    },
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
  // Leaves the menu open: the with-and-without-Satori capture screenshots this story.
  play: async ({ args, canvasElement }) => {
    within(canvasElement).getByRole('button', { name: 'More actions' }).focus();
    await userEvent.keyboard('{Enter}');
    // The menu opens in the overlay container, outside the story's canvas.
    const menu = within(await within(canvasElement.ownerDocument.body).findByRole('menu'));
    await waitFor(() => expect(menu.getByRole('menuitem', { name: 'Share' })).toHaveFocus());
    await expect(menu.getByRole('menuitem', { name: 'Export' })).toBeDisabled();
    await expect(args.selected).not.toHaveBeenCalled();
  },
};

/** A manifest hid every entry: no trigger renders, rather than a button that opens an empty menu. */
export const EveryEntryHidden: Story = {
  args: { actions: [] },
};

/** Selection skips disabled entries; dismissing restores the keyboard's starting point. */
export const KeyboardContract: Story = {
  args: WithADisabledEntry.args,
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'More actions' });
    const body = within(canvasElement.ownerDocument.body);
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const share = await body.findByRole('menuitem', { name: 'Share' });
    await waitFor(() => expect(share).toHaveFocus());
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(share, { key: 'ArrowDown', keyCode: 40 });
    const notify = body.getByRole('menuitem', { name: 'Notify Me' });
    await waitFor(() => expect(notify).toHaveFocus());
    fireEvent.keyDown(notify, { key: 'ArrowDown', keyCode: 40 });
    await waitFor(() => expect(share).toHaveFocus());
    fireEvent.keyDown(share, { key: 'ArrowUp', keyCode: 38 });
    await waitFor(() => expect(notify).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(args.selected).toHaveBeenCalledWith(BROWSE_HEADER[1]));
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument());
    await userEvent.keyboard('{Enter}');
    const reopened = await body.findByRole('menuitem', { name: 'Share' });
    await waitFor(() => expect(reopened).toHaveFocus());
    fireEvent.keyDown(reopened, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    await expect(args.selected).toHaveBeenCalledTimes(1);
  },
};
