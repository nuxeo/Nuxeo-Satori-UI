import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { NxsButtonType } from '../button/button.component';
import { NxsIconButtonComponent } from './icon-button.component';

const TYPES: readonly NxsButtonType[] = ['button', 'submit', 'reset'];

/**
 * A button that is only an icon, Angular Material's icon button, as a native `<button>`. Its label
 * is its accessible name; the text below stands in for what a caller binds through its translate
 * pipe.
 */
const meta: Meta<NxsIconButtonComponent> = {
  title: 'Actions/Icon button',
  component: NxsIconButtonComponent,
  tags: ['autodocs'],
  args: {
    icon: 'arrow_up',
    label: 'Move member:phone up',
    type: 'button',
    disabled: false,
    press: fn(),
  },
  argTypes: {
    type: { control: 'select', options: TYPES },
    icon: { control: 'text', description: 'The icon, by its ligature. Required.' },
    label: { control: 'text', description: 'What it does: its accessible name. Required.' },
  },
};

export default meta;

type Story = StoryObj<NxsIconButtonComponent>;

export const Default: Story = {};

/** A row of them, each named by what it does and the field it does it to. */
export const ARow: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<span style="display: flex">
  <nxs-icon-button icon="arrow_up" [label]="'Move member:phone up'" [disabled]="true" />
  <nxs-icon-button icon="arrow_down" [label]="'Move member:phone down'" />
  <nxs-icon-button icon="view_off" [label]="'Hide member:phone'" />
</span>`,
  }),
};

export const Disabled: Story = { args: { disabled: true } };

/** Enter and Space press it, and it keeps the focus; disabled, it is skipped by Tab. */
export const KeyboardContract: Story = {
  render: (args) => ({
    props: args,
    template: `<span style="display: flex">
  <nxs-icon-button icon="arrow_up" [label]="'Move member:phone up'" (press)="press()" />
  <nxs-icon-button icon="arrow_down" [label]="'Move member:phone down'" [disabled]="true" (press)="press()" />
  <nxs-icon-button icon="view_off" [label]="'Hide member:phone'" />
</span>`,
  }),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const up = canvas.getByRole('button', { name: 'Move member:phone up' });
    up.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await expect(args.press).toHaveBeenCalledTimes(2);
    await expect(up).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Hide member:phone' })).toHaveFocus();
    await expect(canvas.getByRole('button', { name: 'Move member:phone down' })).toBeDisabled();
  },
};
