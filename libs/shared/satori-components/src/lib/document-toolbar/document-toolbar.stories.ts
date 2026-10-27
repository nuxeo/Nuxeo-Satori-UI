import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { NxsDocumentToolbarComponent, type NxsToolbarAction } from './document-toolbar.component';

/** The packaged `toolbar` slot for a File the user can edit, locked by someone else. */
const FILE_TOOLBAR: readonly NxsToolbarAction[] = [
  { id: 'app.toolbar.edit', label: 'Edit', icon: 'pencil' },
  { id: 'app.toolbar.addToCollection', label: 'Add to collection', icon: 'add_list' },
  {
    id: 'app.toolbar.unlock',
    label: 'Unlock',
    icon: 'lock',
    tooltip: 'Locked by Jane Doe on May 3, 2026',
    active: true,
  },
  { id: 'app.toolbar.addToFavorites', label: 'Add to Favorites', icon: 'star' },
  { id: 'app.toolbar.share', label: 'Share', icon: 'share' },
  { id: 'app.toolbar.delete', label: 'Delete', icon: 'trash' },
  { id: 'app.toolbar.publish', label: 'Publish document', icon: 'publish', overflow: true },
  { id: 'app.toolbar.subscribe', label: 'Notify Me', icon: 'bell', overflow: true },
  {
    id: 'app.toolbar.addToClipboard',
    label: 'Add to Clipboard',
    icon: 'content_paste',
    overflow: true,
  },
  { id: 'app.toolbar.export', label: 'Export', icon: 'import_export', overflow: true },
  { id: 'app.toolbar.startProcess', label: 'Start Process', icon: 'processes', overflow: true },
];

/**
 * The action row of a document page. The host resolves its `toolbar` slot into entries — labels
 * translated, rules and enabled rules evaluated, tooltips chosen — and runs the one `selected`
 * names; the toolbar runs nothing itself.
 */
const meta: Meta<NxsDocumentToolbarComponent> = {
  title: 'Documents/Document toolbar',
  component: NxsDocumentToolbarComponent,
  tags: ['autodocs'],
  args: { actions: FILE_TOOLBAR, label: '', moreLabel: '', actionHandler: fn(), selected: fn() },
  argTypes: {
    actions: {
      description:
        'Every entry in display order, already translated; `overflow` puts one behind the menu.',
    },
    label: {
      control: 'text',
      description: 'The group’s accessible name. Blank falls back to “Document actions”.',
    },
    moreLabel: {
      control: 'text',
      description: 'The menu button’s name and tooltip. Blank falls back to “More actions”.',
    },
    actionHandler: {
      control: false,
      description:
        'Called with the entry the user ran, as `selected` emits it. What a host rendering the ID through an outlet passes.',
    },
    selected: { control: false, description: 'The entry the user ran. Never a disabled one.' },
  },
};

export default meta;

type Story = StoryObj<NxsDocumentToolbarComponent>;

/** Six inline actions and five behind "More actions"; the padlock is drawn as on. */
export const FileLockedByAnotherUser: Story = {};

/** A user with Read only: the edit actions' enabled rules say no, so they stay visible and inert. */
export const ReadOnlyUser: Story = {
  args: {
    actions: FILE_TOOLBAR.map((action) =>
      ['app.toolbar.edit', 'app.toolbar.unlock', 'app.toolbar.delete'].includes(action.id)
        ? { ...action, disabled: true, active: false }
        : action,
    ),
  },
};

/** Opened with Enter from the focused menu button, so the first overflow entry has focus. */
export const MoreActionsOpen: Story = {
  // Leaves the menu open: the with-and-without-Satori capture screenshots this story.
  play: async ({ args, canvasElement }) => {
    (await within(canvasElement).findByRole('button', { name: 'More actions' })).focus();
    await userEvent.keyboard('{Enter}');
    const menu = within(await within(canvasElement.ownerDocument.body).findByRole('menu'));
    await waitFor(() =>
      expect(menu.getByRole('menuitem', { name: 'Publish document' })).toHaveFocus(),
    );
    await expect(args.selected).not.toHaveBeenCalled();
  },
};

/** Nothing overflows: no menu button renders, rather than one that opens an empty menu. */
export const NothingOverflows: Story = {
  args: { actions: FILE_TOOLBAR.filter((action) => !action.overflow) },
};
