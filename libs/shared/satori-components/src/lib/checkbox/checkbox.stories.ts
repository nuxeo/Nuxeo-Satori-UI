import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NxsCheckboxComponent } from './checkbox.component';

/**
 * A tick box whose owner holds its state: it shows `checked`, and a click or Space asks for the
 * other state on `checkedChange`. These stories set nothing in reply, so the box asks and stays as
 * it is, which is what a refused save looks like; the `Owned` story ticks it once asked.
 */
const meta: Meta<NxsCheckboxComponent> = {
  title: 'Inputs/Checkbox',
  component: NxsCheckboxComponent,
  tags: ['autodocs'],
  args: { checked: false, disabled: false, describedBy: null, checkedChange: fn() },
  argTypes: {
    checked: { control: 'boolean', description: 'Whether it shows ticked.' },
    disabled: {
      control: 'boolean',
      description: 'Asks for nothing for now; stays focusable and says it is unavailable.',
    },
    describedBy: { control: false, description: 'The id of an element that describes it.' },
    checkedChange: { control: false, description: 'The state the person asks for.' },
  },
  render: (args) => ({
    props: args,
    template: `<nxs-checkbox [checked]="checked" [disabled]="disabled" [describedBy]="describedBy"
  (checkedChange)="checkedChange($event)">Medical records received</nxs-checkbox>`,
  }),
};

export default meta;

type Story = StoryObj<NxsCheckboxComponent>;

/** Not ticked. Click it: it asks for `true` and, with no owner here, stays as it is. */
export const Unticked: Story = {};

export const Ticked: Story = { args: { checked: true } };

/** While its change is saved: focusable, announced as unavailable, asking for nothing. */
export const Disabled: Story = { args: { checked: true, disabled: true } };

/** Its owner sets `checked` to what it is asked for, as once a save succeeds. */
export const Owned: Story = {
  render: (args) => ({
    props: { ...args, ticked: false },
    template: `<nxs-checkbox [checked]="ticked" describedBy="owned-meta"
  (checkedChange)="ticked = $event; checkedChange($event)">Decision letter sent</nxs-checkbox>
<p id="owned-meta" style="margin: 4px 0 0 40px">Sent by Sam Patel on November 26, 2026</p>`,
  }),
};

export const KeyboardContract: Story = {
  play: async ({ args, canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Medical records received' });
    box.focus();
    await userEvent.keyboard(' ');
    await expect(args.checkedChange).toHaveBeenLastCalledWith(true);
    // Its owner said nothing, so it shows what it showed.
    await expect(box).not.toBeChecked();
    await expect(box).toHaveFocus();
  },
};
