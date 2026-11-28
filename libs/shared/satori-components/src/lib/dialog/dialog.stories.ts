import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import { dialogPreview } from '../../../.storybook/dialog-preview';
import { NxsButtonComponent } from '../button/button.component';

import { NxsDialogComponent } from './dialog.component';

/** A record action's confirmation, as the layout engine's action dialog asks it. */
const ASKING = `
  <p style="margin: 0">Send round 2 of the review of logo-final.png back to its author?</p>
  <ng-container nxsDialogActions>
    <nxs-button (press)="cancel()">Cancel</nxs-button>
    <nxs-button appearance="filled" (press)="run()">Send back</nxs-button>
  </ng-container>
`;

/**
 * The frame of a dialog `MatDialog` opens — title, content and actions — shown as `MatDialog`
 * opens it. A page puts it at the root of its own dialog component; the words below stand in for
 * what that component binds through its translate pipe.
 */
const meta: Meta<NxsDialogComponent & { cancel: () => void; run: () => void }> = {
  title: 'Dialogs/Dialog',
  component: NxsDialogComponent,
  tags: ['autodocs'],
  decorators: [moduleMetadata({ imports: [NxsButtonComponent] })],
  parameters: {
    layout: 'fullscreen',
    docs: {
      source: {
        language: 'html',
        code: `<nxs-dialog [heading]="data.title">
  <p>{{ data.question }}</p>
  <ng-container nxsDialogActions>
    <nxs-button (press)="cancel()">{{ 'acme.cancel' | translate }}</nxs-button>
    <nxs-button appearance="filled" (press)="run()">{{ data.title }}</nxs-button>
  </ng-container>
</nxs-dialog>`,
      },
    },
  },
  args: { heading: 'Send back', cancel: fn(), run: fn() },
  argTypes: {
    heading: { control: 'text', description: 'The dialog’s title, already translated. Required.' },
    cancel: { control: false, table: { disable: true } },
    run: { control: false, table: { disable: true } },
  },
  render: dialogPreview(
    'nxs-dialog',
    { width: '560px', maxWidth: '95vw' },
    { attributes: '[heading]="heading"', content: ASKING },
  ),
};

export default meta;

type Story = StoryObj<NxsDialogComponent & { cancel: () => void; run: () => void }>;

/** A question and its two answers: Tab goes from Cancel to the action, and Enter runs it. */
export const Asking: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 2, name: 'Send back' })).toBeVisible();
    canvas.getByRole('button', { name: 'Cancel' }).focus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Send back' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.run).toHaveBeenCalledTimes(1);
    await expect(args.cancel).not.toHaveBeenCalled();
  },
};
