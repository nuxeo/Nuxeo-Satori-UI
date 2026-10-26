import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';
import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsStatusTagComponent } from './status-tag.component';

const STATUSES = [
  'important-loud',
  'important',
  'success',
  'warning',
  'info',
  'neutral',
  'neutral-quiet',
];

const meta: Meta<NxsStatusTagComponent> = {
  title: 'Primitives/Status tag',
  component: NxsStatusTagComponent,
  tags: ['autodocs'],
  args: { label: 'In progress', status: 'info', hideIcon: false },
  argTypes: { status: { control: 'select', options: STATUSES } },
};

export default meta;
type Story = StoryObj<NxsStatusTagComponent>;

export const Default: Story = {};

/** Every status. These examples show fixed markup. */
export const Statuses: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<div style="display: flex; flex-wrap: wrap; gap: 8px">
${STATUSES.map((status) => `  <nxs-status-tag label="${status}" status="${status}" />`).join('\n')}
</div>`,
  }),
};

/** A label longer than the space it has wraps inside the tag; none of it is cut off. */
export const LongLabel: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<div style="inline-size: 160px">
  <nxs-status-tag label="Waiting for the supplier to confirm" status="warning" />
</div>`,
  }),
};

/**
 * Rendered by ID, the way a host resolves `nxs.primitives.statusTag`: whatever is registered under
 * the ID renders here — this Material component, or Satori's once `/components-satori` is provided.
 */
export const ByRegisteredId: Story = {
  name: 'By Registered ID',
  decorators: [
    applicationConfig({ providers: [provideTranslateService(), provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  render: (args) => ({
    props: {
      id: NXS_PRIMITIVE_IDS.statusTag,
      inputs: { label: args.label, status: args.status, hideIcon: args.hideIcon },
    },
    template: `<lib-extension-outlet [componentId]="id" [componentInputs]="inputs" />`,
  }),
};
