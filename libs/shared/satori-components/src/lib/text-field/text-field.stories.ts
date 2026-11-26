import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { NxsFieldAppearance } from '../field-appearance';
import { NxsTextFieldComponent } from './text-field.component';

const APPEARANCES: readonly NxsFieldAppearance[] = ['outline', 'fill'];

/**
 * A labelled text field: Angular Material's form field round a native input, or a textarea. The line
 * under each story shows the value the field holds. The text stands in for what a caller binds
 * through its translate pipe.
 */
const meta: Meta<NxsTextFieldComponent> = {
  title: 'Fields/Text field',
  component: NxsTextFieldComponent,
  tags: ['autodocs'],
  args: {
    label: 'Card ID',
    value: 'member',
    placeholder: '',
    multiline: false,
    rows: 2,
    suggestions: [],
    autocomplete: '',
    appearance: 'outline',
    disabled: false,
    valueCommit: fn(),
  },
  argTypes: {
    label: { control: 'text', description: 'The field’s label, already translated. Required.' },
    value: { control: 'text', description: 'The text. Two-way: it changes as each key is typed.' },
    appearance: { control: 'select', options: APPEARANCES },
    rows: { control: { type: 'number', min: 1, max: 12 } },
  },
  render: (args) => ({
    props: args,
    template: `<nxs-text-field
  [label]="label"
  [(value)]="value"
  [placeholder]="placeholder"
  [multiline]="multiline"
  [rows]="rows"
  [suggestions]="suggestions"
  [autocomplete]="autocomplete"
  [appearance]="appearance"
  [disabled]="disabled"
  (valueCommit)="valueCommit($event)"
/>
<output class="story-value">{{ value }}</output>`,
  }),
};

export default meta;

type Story = StoryObj<NxsTextFieldComponent>;

export const Default: Story = {};

/** A rule, written as JSON: a textarea, with a placeholder and the code font a host sets. */
export const Multiline: Story = {
  args: {
    label: 'Shown while',
    value: '',
    multiline: true,
    rows: 3,
    placeholder: 'app.rules.canWrite, or a rule as JSON',
  },
  render: (args) => ({
    props: args,
    template: `<nxs-text-field
  style="--nxs-text-field-font-family: monospace"
  [label]="label"
  [(value)]="value"
  [placeholder]="placeholder"
  [multiline]="multiline"
  [rows]="rows"
  (valueCommit)="valueCommit($event)"
/>`,
  }),
};

/** Values the browser offers to complete from, as a native datalist. */
export const WithSuggestions: Story = {
  args: {
    label: 'Queue ID',
    value: '',
    suggestions: ['up-for-renewal', 'terminated'],
    autocomplete: 'off',
  },
};

export const Fill: Story = { args: { appearance: 'fill' } };

export const Disabled: Story = { args: { disabled: true } };

/** Typing changes the value; leaving the field commits it, once. */
export const KeyboardContract: Story = {
  args: { value: '' },
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Card ID' });
    await userEvent.click(field);
    await userEvent.keyboard('claims');
    await expect(field).toHaveValue('claims');
    await expect(args.valueCommit).not.toHaveBeenCalled();
    await userEvent.tab();
    await expect(args.valueCommit).toHaveBeenCalledTimes(1);
    await expect(args.valueCommit).toHaveBeenLastCalledWith('claims');
  },
};
