import { inject, provideAppInitializer } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { action } from 'storybook/actions';

import { NxsToastService, provideNxsToast } from './toast.service';

/**
 * The toast is opened through `NxsToastService`, never placed in a template, so each story's button
 * calls the service. The decorator captures the service its story's application created.
 */
function withToast(): {
  readonly decorator: ReturnType<typeof applicationConfig>;
  readonly toast: () => NxsToastService | undefined;
} {
  let service: NxsToastService | undefined;
  return {
    decorator: applicationConfig({
      providers: [
        provideNxsToast(),
        provideAppInitializer(() => {
          service = inject(NxsToastService);
        }),
      ],
    }),
    toast: () => service,
  };
}

/** It names no component: the toast's content is internal, and its API is the service. */
const meta: Meta = {
  title: 'States/Toast',
  decorators: [moduleMetadata({ imports: [MatButtonModule] })],
};

export default meta;

const message = withToast();

/** Something happened. Announced politely; closes after four seconds, or on Dismiss or Escape. */
export const Message: StoryObj = {
  decorators: [message.decorator],
  parameters: {
    docs: { source: { language: 'typescript', code: `this.toast.show('Document saved');` } },
  },
  render: () => ({
    props: { save: () => message.toast()?.show('Document saved') },
    template: `<button mat-flat-button type="button" (click)="save()">Save</button>`,
  }),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
  },
};

const failure = withToast();

/** Something the user asked for did not happen. Announced assertively, with a Retry button. */
export const ErrorWithRetry: StoryObj = {
  name: 'Error with Retry',
  decorators: [failure.decorator],
  parameters: {
    docs: {
      source: {
        language: 'typescript',
        code: `this.toast.error('The document could not be saved.', { retry: () => this.save() });`,
      },
    },
  },
  render: () => ({
    props: {
      save: () =>
        failure.toast()?.error('The document could not be saved.', { retry: action('retry') }),
    },
    template: `<button mat-flat-button type="button" (click)="save()">Save</button>`,
  }),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
  },
};

const undoable = withToast();

/** A toast with an action stays until it is dismissed, so a keyboard user has time to reach it. */
export const WithAnAction: StoryObj = {
  name: 'With an Action',
  decorators: [undoable.decorator],
  parameters: {
    docs: {
      source: {
        language: 'typescript',
        code: `this.toast.show('Moved to trash', { action: { label: 'Undo', run: () => this.restore() } });`,
      },
    },
  },
  render: () => ({
    props: {
      remove: () =>
        undoable
          .toast()
          ?.show('Moved to trash', { action: { label: 'Undo', run: action('undo') } }),
    },
    template: `<button mat-stroked-button type="button" (click)="remove()">Move to trash</button>`,
  }),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Move to trash' }));
  },
};
