import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { ExtensionOutletComponent } from '@nuxeo-satori/platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsTagComponent } from './tag.component';

const COLOURS = ['gray', 'purple', 'blue', 'pink', 'teal', 'yellow', 'green', 'red', 'orange'];

const meta: Meta<NxsTagComponent> = {
  title: 'Primitives/Tag',
  component: NxsTagComponent,
  args: { label: 'File', color: 'gray' },
  argTypes: { color: { control: 'select', options: COLOURS } },
};

export default meta;

type Story = StoryObj<NxsTagComponent>;

export const Default: Story = {};

export const Colours: Story = {
  render: (args) => ({
    props: { ...args, colours: COLOURS },
    template: `
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        @for (colour of colours; track colour) {
          <nxs-tag [label]="colour" [color]="colour" />
        }
      </div>
    `,
  }),
};

/**
 * Rendered by ID, the way a host resolves `nxs.primitives.tag`: whatever is registered under the
 * ID renders here — this Material component, or Satori's once `/components-satori` is provided.
 */
export const ByRegisteredId: Story = {
  decorators: [
    applicationConfig({ providers: [provideTranslateService(), provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  render: (args) => ({
    props: { id: NXS_PRIMITIVE_IDS.tag, inputs: { label: args.label, color: args.color } },
    template: `<lib-extension-outlet [componentId]="id" [componentInputs]="inputs" />`,
  }),
};
