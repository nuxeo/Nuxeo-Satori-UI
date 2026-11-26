import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent, within } from 'storybook/test';

import type { NxsFieldAppearance } from '../field-appearance';
import { NxsSelectComponent, type NxsSelectGroup, type NxsSelectOption } from './select.component';

const APPEARANCES: readonly NxsFieldAppearance[] = ['outline', 'fill'];

const FILES: readonly NxsSelectGroup[] = [
  {
    label: 'Member',
    options: [
      { value: 'Member/view', label: 'Member: record page' },
      { value: 'Member/edit', label: 'Member: edit form' },
      { value: 'Member/create', label: 'Member: create form, a new file' },
    ],
  },
  {
    label: 'Claim',
    options: [
      { value: 'Claim/view', label: 'Claim: record page' },
      { value: 'Claim/edit', label: 'Claim: edit form, a new file' },
    ],
  },
];

const ORDERS: readonly NxsSelectOption[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

/**
 * A labelled choice from a list: Angular Material's form field round a native select. The line
 * under each story shows the value chosen. The text stands in for what a caller binds through its
 * translate pipe.
 */
const meta: Meta<NxsSelectComponent> = {
  title: 'Fields/Select',
  component: NxsSelectComponent,
  tags: ['autodocs'],
  args: {
    label: 'Layout file',
    value: '',
    options: FILES,
    placeholder: 'Choose a file',
    appearance: 'outline',
    disabled: false,
  },
  argTypes: {
    label: { control: 'text', description: 'The select’s label, already translated. Required.' },
    value: { control: 'text', description: 'The value chosen. Two-way.' },
    options: { control: false, description: 'The choices: each a choice or a group of them.' },
    appearance: { control: 'select', options: APPEARANCES },
  },
  render: (args) => ({
    props: args,
    template: `<nxs-select
  [label]="label"
  [(value)]="value"
  [options]="options"
  [placeholder]="placeholder"
  [appearance]="appearance"
  [disabled]="disabled"
/>
<output class="story-value">{{ value || '—' }}</output>`,
  }),
};

export default meta;

type Story = StoryObj<NxsSelectComponent>;

/** Choices under their type's heading, and a first choice that chooses nothing. */
export const Default: Story = {};

/** Flat choices, one chosen, with no placeholder. */
export const Flat: Story = {
  args: { label: 'Order of contract:end', value: 'asc', options: ORDERS, placeholder: '' },
};

export const Fill: Story = { args: { appearance: 'fill' } };

export const Disabled: Story = { args: { disabled: true, value: 'Member/edit' } };

/** Choosing an option changes the value, which the line under the select shows. */
export const Choosing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByRole('combobox', { name: 'Layout file' });
    await expect(select).toHaveValue('');
    await userEvent.selectOptions(select, 'Member/edit');
    await expect(select).toHaveValue('Member/edit');
    await expect(canvasElement.querySelector('.story-value')).toHaveTextContent('Member/edit');
  },
};
