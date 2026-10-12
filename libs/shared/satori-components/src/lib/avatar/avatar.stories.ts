import { ExtensionOutletComponent } from '@nuxeo-satori/platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsAvatarComponent } from './avatar.component';

const COLOURS = ['purple', 'blue', 'pink', 'teal', 'yellow', 'green', 'red', 'orange'];
const SIZES = ['24', '28', '36', '64', '80', '128'];

const meta: Meta<NxsAvatarComponent> = {
  title: 'Primitives/Avatar',
  component: NxsAvatarComponent,
  tags: ['autodocs'],
  args: { initials: 'NK', color: 'teal', size: '64', label: 'Narasimha Koppula' },
  argTypes: {
    color: { control: 'select', options: COLOURS },
    size: { control: 'select', options: SIZES },
  },
};

export default meta;

type Story = StoryObj<NxsAvatarComponent>;

export const Default: Story = {};

/** The six sizes, each with the type size that fits it. These examples show fixed markup. */
export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<div style="display: flex; align-items: center; gap: 12px">
${SIZES.map((size) => `  <nxs-avatar initials="NK" size="${size}" label="Narasimha Koppula" />`).join('\n')}
</div>`,
  }),
};

/** Every colour. In this implementation each one is a container colour of the Material theme. */
export const Colours: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<div style="display: flex; gap: 8px">
${COLOURS.map((colour) => `  <nxs-avatar initials="NK" color="${colour}" label="Narasimha Koppula" />`).join('\n')}
</div>`,
  }),
};

/** Beside the visible name the label is left blank, so the name is not announced twice. */
export const BesideAName: Story = {
  name: 'Beside a Name',
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<div style="display: flex; align-items: center; gap: 8px">
  <nxs-avatar initials="NK" color="purple" />
  <span>Narasimha Koppula</span>
</div>`,
  }),
};

/**
 * Rendered by ID, the way a screen resolves `nxs.primitives.avatar`: whatever is registered under
 * the ID renders here — this component, or Satori's once `/components-satori` is provided.
 */
export const ByRegisteredId: Story = {
  name: 'By Registered ID',
  decorators: [
    applicationConfig({ providers: [provideTranslateService(), provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  render: (args) => ({
    props: {
      avatarId: NXS_PRIMITIVE_IDS.avatar,
      inputs: { initials: args.initials, color: args.color, size: args.size, label: args.label },
    },
    template: `<lib-extension-outlet [componentId]="avatarId" [componentInputs]="inputs" />`,
  }),
};
