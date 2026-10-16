import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, waitFor } from 'storybook/test';

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

/** Closed. Rest the pointer on the button, Tab to it, or click or tap it to open it. */
export const Closed: Story = {};

/** Opened by clicking the button, as a touch user taps it. Focus stays on the button. */
export const Open: Story = {
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'About versioning' });
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = canvasElement.ownerDocument.getElementById(
      trigger.getAttribute('aria-controls') ?? '',
    );
    await expect(panel).toHaveTextContent(args.heading);
    await expect(panel).toHaveTextContent(args.content);
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveFocus();
  },
};

/** Opened by resting the pointer on the button, as Satori's opens. */
export const OpensOnHover: Story = {
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'About versioning' });
    await userEvent.hover(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    const panel = canvasElement.ownerDocument.getElementById(
      trigger.getAttribute('aria-controls') ?? '',
    );
    await expect(panel).toHaveTextContent(args.content);
    await expect(panel).toBeVisible();
  },
};

/** Opened by reaching the button with Tab, as Satori's opens. Focus stays on the button. */
export const OpensOnFocus: Story = {
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'About versioning' });
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    const panel = canvasElement.ownerDocument.getElementById(
      trigger.getAttribute('aria-controls') ?? '',
    );
    await expect(panel).toHaveTextContent(args.content);
    await expect(trigger).toHaveFocus();
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
