import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import {
  NxsButtonComponent,
  type NxsButtonAppearance,
  type NxsButtonType,
} from './button.component';

const APPEARANCES: readonly NxsButtonAppearance[] = ['text', 'outlined', 'filled'];
const TYPES: readonly NxsButtonType[] = ['button', 'submit', 'reset'];

/**
 * A button with text, Angular Material's, as a native `<button>`. Its text is the content; the text
 * below stands in for what a caller binds through its translate pipe.
 */
const meta: Meta<NxsButtonComponent> = {
  title: 'Actions/Button',
  component: NxsButtonComponent,
  tags: ['autodocs'],
  args: {
    appearance: 'outlined',
    icon: '',
    label: '',
    type: 'button',
    disabled: false,
    disabledInteractive: false,
    ariaPressed: null,
    describedBy: null,
    controlId: '',
    press: fn(),
  },
  argTypes: {
    appearance: { control: 'select', options: APPEARANCES },
    type: { control: 'select', options: TYPES },
    icon: { control: 'text', description: 'An icon before the text, by its ligature.' },
    label: {
      control: 'text',
      description: 'The accessible name, where the text alone does not say enough.',
    },
    ariaPressed: { control: 'select', options: [null, true, false] },
  },
  render: (args) => ({
    props: args,
    template: `<nxs-button
  [appearance]="appearance"
  [icon]="icon"
  [label]="label"
  [type]="type"
  [disabled]="disabled"
  [disabledInteractive]="disabledInteractive"
  [ariaPressed]="ariaPressed"
  [describedBy]="describedBy"
  [controlId]="controlId"
  (press)="press()"
>Open</nxs-button>`,
  }),
};

export default meta;

type Story = StoryObj<NxsButtonComponent>;

export const Default: Story = {};

/** `filled` for the one action a region recommends, `outlined` beside it, `text` the quietest. */
export const Appearances: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center">
  <nxs-button appearance="filled" icon="download">Download view.layout.json</nxs-button>
  <nxs-button appearance="outlined">Undo every change</nxs-button>
  <nxs-button appearance="text">Show</nxs-button>
</div>`,
  }),
};

/** Its text is "Show", and its name says which field it shows. */
export const NamedApart: Story = {
  args: { appearance: 'text', label: 'Show member:phone again' },
  render: (args) => ({
    props: args,
    template: `<nxs-button [appearance]="appearance" [label]="label" (press)="press()">Show</nxs-button>`,
  }),
};

export const Disabled: Story = { args: { disabled: true } };

/**
 * Disabled while its action is saved, and still in the tab order: announced as unavailable, so
 * the keyboard's focus stays on it, and it does not press.
 */
export const DisabledInteractive: Story = {
  args: { disabled: true, disabledInteractive: true },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Open' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Enter}');
    await expect(args.press).not.toHaveBeenCalled();
  },
};

/** A row of toggles, one pressed: the view a picture shows, say. */
export const Toggles: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<div role="group" aria-label="Views" style="display: flex; gap: 8px">
  <nxs-button appearance="outlined" [ariaPressed]="true">Original</nxs-button>
  <nxs-button appearance="outlined" [ariaPressed]="false">Medium</nxs-button>
  <nxs-button appearance="outlined" [ariaPressed]="false">FullHD</nxs-button>
</div>`,
  }),
};

/**
 * Enter and Space press it, and it keeps the focus; disabled, it is skipped by Tab and does not
 * press.
 */
export const KeyboardContract: Story = {
  render: (args) => ({
    props: args,
    template: `<div style="display: flex; gap: 8px">
  <nxs-button appearance="outlined" (press)="press()">Open</nxs-button>
  <nxs-button appearance="outlined" [disabled]="true" (press)="press()">Add</nxs-button>
  <nxs-button appearance="filled">Download</nxs-button>
</div>`,
  }),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const open = canvas.getByRole('button', { name: 'Open' });
    open.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await expect(args.press).toHaveBeenCalledTimes(2);
    await expect(open).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Download' })).toHaveFocus();
    await expect(canvas.getByRole('button', { name: 'Add' })).toBeDisabled();
    await expect(args.press).toHaveBeenCalledTimes(2);
  },
};
