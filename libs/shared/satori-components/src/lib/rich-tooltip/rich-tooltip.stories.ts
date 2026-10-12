import { ExtensionOutletComponent } from '@nuxeo-satori/platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsRichTooltipComponent } from './rich-tooltip.component';

const meta: Meta<NxsRichTooltipComponent> = {
  title: 'Primitives/Rich tooltip',
  component: NxsRichTooltipComponent,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    heading: 'Versioning',
    content: 'A new version is created each time you check the document in.',
    triggerLabel: 'About versioning',
    icon: 'info',
  },
};

export default meta;

type Story = StoryObj<NxsRichTooltipComponent>;

/** Closed. Activate the button to open it; Escape or moving focus away closes it. */
export const Closed: Story = {};

/** Opened by activating the button, as a user does. Focus stays on the button. */
export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'About versioning' }));
  },
};

export const OtherIcon: Story = {
  args: {
    icon: 'help_outline',
    heading: 'Who can see this?',
    content: 'Everyone with Read permission on the folder.',
    triggerLabel: 'Help: who can see this',
  },
};

/** Rendered by ID, the way a screen resolves `nxs.primitives.richTooltip`. */
export const ByRegisteredId: Story = {
  name: 'By Registered ID',
  decorators: [
    applicationConfig({ providers: [provideTranslateService(), provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  render: (args) => ({
    props: {
      tooltipId: NXS_PRIMITIVE_IDS.richTooltip,
      inputs: {
        heading: args.heading,
        content: args.content,
        triggerLabel: args.triggerLabel,
        icon: args.icon,
      },
    },
    template: `<lib-extension-outlet [componentId]="tooltipId" [componentInputs]="inputs" />`,
  }),
};
