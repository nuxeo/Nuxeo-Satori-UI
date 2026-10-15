import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { fn } from 'storybook/test';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsErrorStateComponent } from './error-state.component';
import { nxsErrorStatus } from './error-status';

/**
 * What a listing, a page or a set of results shows when it failed to load: one of four variants,
 * chosen by the HTTP status the failure stands for. The headings below are the ones the core screens
 * pass; the explanation under each comes from the variant, in the application's catalogue.
 */
const meta: Meta<NxsErrorStateComponent> = {
  title: 'States/Error state',
  component: NxsErrorStateComponent,
  tags: ['autodocs'],
  args: {
    status: 500,
    heading: 'Failed to load folder contents.',
    headingLevel: 2,
    retryable: false,
    retryHandler: null,
    retry: fn(),
  },
  argTypes: {
    status: {
      control: 'select',
      options: [401, 403, 404, 500],
      description:
        'The variant: 401, 403, 404, or 500 for anything else. Map with nxsErrorStatus().',
    },
    heading: {
      control: 'text',
      description: 'What failed, already translated. Blank shows the variant’s own.',
    },
    headingLevel: { control: 'select', options: [1, 2, 3, 4, 5, 6] },
    retryable: { control: 'boolean', description: 'Offer Retry. Shown for a 500 only.' },
    retryHandler: {
      control: false,
      description:
        'Called when Retry is pressed, for a host rendering the ID, which binds no outputs.',
    },
    retry: { control: false, description: 'Retry was pressed.' },
  },
};

export default meta;

type Story = StoryObj<NxsErrorStateComponent>;

/** A folder listing the server failed to answer (HTTP 500). Press Retry: `retry` is emitted. */
export const ServerErrorWithRetry: Story = {
  args: { retryable: true },
};

/**
 * The request never reached the server (status 0). `nxsErrorStatus` maps it to the 500 variant, so
 * the user is told to try again, not that they lack access.
 */
export const NetworkFailure: Story = {
  args: {
    status: nxsErrorStatus({ status: 0 }),
    heading: 'Failed to load search results.',
    retryable: true,
  },
};

/**
 * The user may not open this folder (HTTP 403). `retryable` is set, as browse sets it, and Retry is
 * still not shown: asking again gets the same answer.
 */
export const Forbidden: Story = {
  args: { status: 403, retryable: true },
};

/** A missing document replaces the whole page: the heading is the page's `<h1>`, with Go back projected. */
export const NotFoundAsThePageHeading: Story = {
  parameters: { controls: { disable: true } },
  decorators: [moduleMetadata({ imports: [MatButtonModule, MatIconModule] })],
  render: () => ({
    template: `<nxs-error-state [status]="404" heading="Failed to load document." [headingLevel]="1">
  <button mat-stroked-button type="button">
    <mat-icon aria-hidden="true">arrow_back</mat-icon>
    Go Back
  </button>
</nxs-error-state>`,
  }),
};

/** With no heading of the screen's own, the variant's heading shows. */
export const SessionEnded: Story = {
  args: { status: 401, heading: '' },
};

/**
 * Rendered by ID, the way a host resolves `nxs.primitives.errorState`: whatever is registered under
 * the ID renders here. The outlet binds no outputs, so Retry reaches the host through `retryHandler`.
 */
export const ByRegisteredId: Story = {
  name: 'By Registered ID',
  args: { retryable: true, retryHandler: fn() },
  decorators: [
    applicationConfig({ providers: [provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  render: (args) => ({
    props: {
      errorStateId: NXS_PRIMITIVE_IDS.errorState,
      inputs: {
        status: args.status,
        heading: args.heading,
        headingLevel: args.headingLevel,
        retryable: args.retryable,
        retryHandler: args.retryHandler,
      },
    },
    template: `<lib-extension-outlet [componentId]="errorStateId" [componentInputs]="inputs" />`,
  }),
};
