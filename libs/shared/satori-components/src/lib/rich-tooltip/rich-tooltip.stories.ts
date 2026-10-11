import type { Meta, StoryObj } from '@storybook/angular';

import { NxsRichTooltipComponent } from './rich-tooltip.component';

const meta: Meta<NxsRichTooltipComponent> = {
  title: 'Primitives/Rich tooltip',
  component: NxsRichTooltipComponent,
  parameters: { layout: 'padded' },
  args: {
    heading: 'Versioning',
    content: 'A new version is created each time you check the document in.',
    triggerLabel: 'About versioning',
    icon: 'info',
  },
  argTypes: {
    triggerLabel: { description: 'The trigger button’s accessible name; it shows only an icon.' },
  },
};

export default meta;

type Story = StoryObj<NxsRichTooltipComponent>;

/** Closed. Activate the button to open it; Escape or moving focus away closes it. */
export const Closed: Story = {};

export const OtherIcon: Story = { args: { icon: 'help_outline', triggerLabel: 'Help' } };
