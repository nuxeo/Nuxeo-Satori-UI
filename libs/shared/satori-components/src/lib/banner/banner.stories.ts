import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { fn } from 'storybook/test';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsBannerComponent } from './banner.component';

/**
 * A notice within content: a message and the actions that answer it. The tone picks the icon and
 * colours; the announcement says how a screen reader hears it.
 */
const meta: Meta<NxsBannerComponent> = {
  title: 'Notices/Banner',
  component: NxsBannerComponent,
  tags: ['autodocs'],
  args: {
    message: 'You are viewing a trashed document.',
    tone: 'info',
    announce: 'none',
    actions: [],
  },
  argTypes: {
    message: { control: 'text', description: 'The message, already translated.' },
    tone: {
      control: 'select',
      options: ['info', 'warning', 'error'],
      description: 'What kind of notice it is: the icon and colours follow from it.',
    },
    announce: {
      control: 'select',
      options: ['none', 'status', 'alert'],
      description:
        'How a screen reader hears it: alert interrupts, status waits for a pause, none reads in place.',
    },
    actions: {
      control: false,
      description: 'The buttons offered after the message, in order.',
    },
  },
};

export default meta;

type Story = StoryObj<NxsBannerComponent>;

/** A trashed document: Restore is the recommended action, Delete permanently the destructive one. */
export const TrashedDocument: Story = {
  args: {
    actions: [
      { label: 'Restore', icon: 'restore_from_trash', emphasis: 'outlined', press: fn() },
      {
        label: 'Delete permanently',
        icon: 'delete_forever',
        emphasis: 'outlined',
        danger: true,
        press: fn(),
      },
    ],
  },
};

/** A version other than the latest: go to the latest, or restore this one. */
export const OlderVersion: Story = {
  args: {
    message: "You're viewing the 0.1 version.",
    actions: [
      { label: 'Go to latest', emphasis: 'text', press: fn() },
      { label: 'Restore 0.1', icon: 'restore', emphasis: 'filled', press: fn() },
    ],
  },
};

/** A warning that appears as the reader works, and is announced when it appears. */
export const Warning: Story = {
  args: {
    message: 'Documents imported here will be placed in a restricted folder.',
    tone: 'warning',
    announce: 'status',
  },
};

/** A failure the reader is told about at once: the notice is an alert, and the content still shows. */
export const ErrorAlert: Story = {
  args: {
    message: 'The AI search could not run. Results below are not ranked by AI.',
    tone: 'error',
    announce: 'alert',
  },
};

/**
 * Rendered by ID, the way a host resolves `nxs.primitives.banner`: whatever is registered under the
 * ID renders here, from its inputs alone.
 */
export const ByRegisteredId: Story = {
  name: 'By Registered ID',
  args: {
    actions: [{ label: 'Go to latest', emphasis: 'text', press: fn() }],
  },
  decorators: [
    applicationConfig({ providers: [provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  render: (args) => ({
    props: {
      bannerId: NXS_PRIMITIVE_IDS.banner,
      inputs: {
        message: "You're viewing the 0.1 version.",
        tone: args.tone,
        announce: args.announce,
        actions: args.actions,
      },
    },
    template: `<lib-extension-outlet [componentId]="bannerId" [componentInputs]="inputs" />`,
  }),
};
