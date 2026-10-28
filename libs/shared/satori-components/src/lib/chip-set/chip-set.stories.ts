import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { fn } from 'storybook/test';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsChipSetComponent } from './chip-set.component';

/**
 * A row of removable chips: the values a field holds. Pressing a chip's remove button emits it; the
 * host drops the value from its own list.
 */
const meta: Meta<NxsChipSetComponent> = {
  title: 'Chips/Chip set',
  component: NxsChipSetComponent,
  tags: ['autodocs'],
  args: {
    items: [
      { id: 'europe', label: 'Europe', removeLabel: 'Remove Europe' },
      { id: 'africa', label: 'Africa/Kenya', removeLabel: 'Remove Africa/Kenya' },
    ],
    label: 'Coverage',
    removeHandler: null,
    removed: fn(),
  },
  argTypes: {
    items: {
      control: false,
      description: 'The chips, in order: each its id, label and remove button name, translated.',
    },
    label: {
      control: 'text',
      description: "The set's accessible name, or blank for none.",
    },
    removeHandler: {
      control: false,
      description: 'Called when a remove button is pressed, for a host rendering the ID.',
    },
    removed: { control: false, description: 'A chip was removed. Emits the chip.' },
  },
};

export default meta;

type Story = StoryObj<NxsChipSetComponent>;

/** The values a metadata field holds, each removable. */
export const RemovableValues: Story = {};

/** A single value, as a single-select field shows it. */
export const SingleValue: Story = {
  args: {
    items: [{ id: 'contract', label: 'Contract', removeLabel: 'Remove Contract' }],
  },
};

/** A chip that cannot be removed at the moment, such as one the field is locked on. */
export const DisabledChip: Story = {
  args: {
    items: [
      { id: 'europe', label: 'Europe', removeLabel: 'Remove Europe', disabled: true },
      { id: 'africa', label: 'Africa', removeLabel: 'Remove Africa' },
    ],
  },
};

/**
 * Rendered by ID, the way a host resolves `nxs.primitives.chipSet`: whatever is registered under the
 * ID renders here. The outlet binds no outputs, so removal reaches the host through `removeHandler`.
 */
export const ByRegisteredId: Story = {
  name: 'By Registered ID',
  args: { removeHandler: fn() },
  decorators: [
    applicationConfig({ providers: [provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  render: (args) => ({
    props: {
      chipSetId: NXS_PRIMITIVE_IDS.chipSet,
      inputs: {
        items: args.items,
        label: args.label,
        removeHandler: args.removeHandler,
      },
    },
    template: `<lib-extension-outlet [componentId]="chipSetId" [componentInputs]="inputs" />`,
  }),
};
