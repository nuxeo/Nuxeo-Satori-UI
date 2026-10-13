import { inject, provideAppInitializer } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { action } from 'storybook/actions';
import { expect, fn, waitFor, within } from 'storybook/test';

import { NxsToastService, provideNxsToast } from './toast.service';

/** The snack bar opens in the overlay container, outside the story's canvas. */
const page = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);

/**
 * The toast showing `text`, once the snack bar has moved it into its live region — it renders the
 * toast hidden from assistive technology first, and moves it a moment later to announce it.
 */
async function announced(canvasElement: HTMLElement, text: string): Promise<HTMLElement> {
  const message = await page(canvasElement).findByText(text);
  await waitFor(() => expect(message.closest('[aria-live]')).not.toBeNull());
  return message;
}

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
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    const message = await announced(canvasElement, 'Document saved');
    await expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    await expect(page(canvasElement).getByRole('button', { name: 'Dismiss' })).toBeVisible();
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
  // Leaves the toast open: the with-and-without-Satori capture screenshots this story.
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    const message = await announced(canvasElement, 'The document could not be saved.');
    await expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
    const toast = page(canvasElement);
    await expect(toast.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  },
};

const undoable = withToast();

/** A toast with an action stays until it is dismissed, so a keyboard user has time to reach it. */
export const WithAnAction: StoryObj<{ readonly undo: () => void }> = {
  name: 'With an Action',
  args: { undo: fn() },
  // Storybook's Angular renderer passes `render` only the args whose argType has a control or an
  // action, and a meta naming no component infers neither.
  argTypes: { undo: { action: 'undo' } },
  decorators: [undoable.decorator],
  parameters: {
    docs: {
      source: {
        language: 'typescript',
        code: `this.toast.show('Moved to trash', { action: { label: 'Undo', run: () => this.restore() } });`,
      },
    },
  },
  render: ({ undo }) => ({
    props: {
      remove: () =>
        undoable.toast()?.show('Moved to trash', { action: { label: 'Undo', run: undo } }),
    },
    template: `<button mat-stroked-button type="button" (click)="remove()">Move to trash</button>`,
  }),
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Move to trash' }));
    await announced(canvasElement, 'Moved to trash');
    const toast = page(canvasElement);
    await userEvent.click(toast.getByRole('button', { name: 'Undo' }));
    await expect(args.undo).toHaveBeenCalledOnce();
    await waitFor(() => expect(toast.queryByText('Moved to trash')).toBeNull());
  },
};
