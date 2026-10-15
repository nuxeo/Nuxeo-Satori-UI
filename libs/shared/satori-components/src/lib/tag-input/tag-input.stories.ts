import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of } from 'rxjs';
import { expect, userEvent, within } from 'storybook/test';

import { TagService } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsTagInputComponent } from './tag-input.component';

const KNOWN = ['contract', 'claims', 'confidential', 'invoice', 'urgent'];

/** Tag suggestions from memory, after 150 ms. */
const tags: Provider = {
  provide: TagService,
  useValue: {
    suggestTags: (term: string) =>
      of(KNOWN.filter((tag) => tag.includes(term.toLowerCase()))).pipe(delay(150)),
  },
};

/**
 * A field of tags: existing ones suggested as the user types, as Web UI's `nuxeo-tag-suggestion`
 * does, and new ones added with Enter, a comma or the "Add" entry. These stories suggest from five
 * tags held in memory: contract, claims, confidential, invoice and urgent.
 */
const meta: Meta<NxsTagInputComponent> = {
  title: 'Pickers/Tag input',
  component: NxsTagInputComponent,
  tags: ['autodocs'],
  args: { label: 'Tags', allowNew: true, hint: '', required: false, disabled: false, value: [] },
  argTypes: {
    label: { control: 'text', description: 'The field’s label, already translated. Required.' },
    allowNew: { control: 'boolean', description: 'Allow a tag no document has yet.' },
    hint: { control: 'text', description: 'Help under the field, already translated.' },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    value: { control: false, description: 'The tags, in the order they were added. Two-way.' },
  },
  decorators: [applicationConfig({ providers: [tags] })],
  render: (args) => ({
    props: args,
    template: `<nxs-tag-input
  [label]="label"
  [allowNew]="allowNew"
  [hint]="hint"
  [required]="required"
  [disabled]="disabled"
  [(value)]="value"
/>
<output class="story-value">{{ value.join(', ') || '—' }}</output>`,
  }),
};

export default meta;

type Story = StoryObj<NxsTagInputComponent>;

/** Type `con`: contract and confidential are suggested, and the typed text can be added. */
export const Default: Story = {};

/**
 * A suggestion chosen, then a new tag typed and added from its "Add" entry. Enter and a comma add
 * one too; the spec covers those, since a synthetic key event here carries no `keyCode`.
 */
export const AddingTags: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('combobox', { name: 'Tags' });
    await userEvent.type(field, 'conf');
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'confidential' }),
    );
    await userEvent.type(field, 'renewal');
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'Add “renewal”' }),
    );
    await expect(canvasElement.querySelector('output')).toHaveTextContent('confidential, renewal');
  },
};

export const WithTags: Story = { args: { value: ['contract', 'urgent'] } };

/** Only tags a document already has: no "Add" entry, and Enter adds nothing new. */
export const ExistingTagsOnly: Story = { args: { allowNew: false } };

export const Disabled: Story = { args: { disabled: true, value: ['contract'] } };
