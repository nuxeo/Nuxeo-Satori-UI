import { LOCALE_ID } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent, within } from 'storybook/test';

import { NxsDateInputComponent } from './date-input.component';

/** The date as `yyyy-mm-dd`, for the line under each story. */
const iso = (date: Date | null): string =>
  date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : '—';

/**
 * A date field, typed or chosen from the calendar. A typed date is read in the order the locale
 * writes dates. The stories run in American English unless they say otherwise; the line under each
 * shows the date the field holds, as `yyyy-mm-dd`.
 */
const meta: Meta<NxsDateInputComponent> = {
  title: 'Pickers/Date input',
  component: NxsDateInputComponent,
  tags: ['autodocs'],
  args: {
    label: 'Expires',
    min: null,
    max: null,
    hint: '',
    required: false,
    disabled: false,
    value: null,
  },
  argTypes: {
    label: { control: 'text', description: 'The field’s label, already translated. Required.' },
    min: { control: 'date', description: 'The earliest date allowed, or null.' },
    max: { control: 'date', description: 'The latest date allowed, or null.' },
    hint: { control: 'text', description: 'Help under the field, already translated.' },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    value: { control: false, description: 'The date, at local midnight, or null. Two-way.' },
  },
  render: (args) => ({
    props: {
      ...args,
      // Storybook's date control gives a timestamp; the inputs take a Date.
      min: args.min === null ? null : new Date(args.min),
      max: args.max === null ? null : new Date(args.max),
      iso,
    },
    template: `<nxs-date-input
  [label]="label"
  [min]="min"
  [max]="max"
  [hint]="hint"
  [required]="required"
  [disabled]="disabled"
  [(value)]="value"
/>
<output class="story-value">{{ iso(value) }}</output>`,
  }),
};

export default meta;

type Story = StoryObj<NxsDateInputComponent>;

export const Default: Story = {};

/** `03/04/2026` typed in American English is 4 March. */
export const TypedInAmericanEnglish: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(
      within(canvasElement).getByRole('textbox', { name: 'Expires' }),
      '03/04/2026',
    );
    await expect(canvasElement.querySelector('output')).toHaveTextContent('2026-03-04');
  },
};

/** The same text typed in French is 3 April. */
export const TypedInFrench: Story = {
  decorators: [applicationConfig({ providers: [{ provide: LOCALE_ID, useValue: 'fr' }] })],
  play: async ({ canvasElement }) => {
    await userEvent.type(
      within(canvasElement).getByRole('textbox', { name: 'Expires' }),
      '03/04/2026',
    );
    await expect(canvasElement.querySelector('output')).toHaveTextContent('2026-04-03');
  },
};

/** Text that is not a date: once the field is left, the error gives an example in the locale's format. */
export const NotADate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Expires' }), '02/31/2026');
    await userEvent.tab();
    await expect(await canvas.findByText(/Enter a date like 12\/31\/\d{4}/)).toBeVisible();
  },
};

export const WithAValue: Story = { args: { value: new Date(2026, 11, 31) } };

export const Disabled: Story = { args: { disabled: true, value: new Date(2026, 3, 3) } };
