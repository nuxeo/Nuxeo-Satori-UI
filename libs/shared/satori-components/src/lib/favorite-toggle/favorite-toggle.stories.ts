import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of, throwError, type Observable } from 'rxjs';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsFavoriteToggleComponent } from './favorite-toggle.component';

/** `addToFavorites` and `removeFromFavorites` both answering with `answer`. */
const favorites = (answer: () => Observable<NuxeoDocument>): Provider => ({
  provide: DocumentDetailService,
  useValue: { addToFavorites: answer, removeFromFavorites: answer },
});

/**
 * The star that adds a document to the user's favorites or removes it, as Web UI's
 * `nuxeo-favorites-toggle-button` does. It runs `Document.AddToFavorites` /
 * `RemoveFromFavorites` and reports the outcome on `changed` or `failed`; the host says what to the
 * user. These stories answer from memory instead of Nuxeo.
 */
const meta: Meta<NxsFavoriteToggleComponent> = {
  title: 'Actions/Favorite toggle',
  component: NxsFavoriteToggleComponent,
  args: { documentId: 'claims-2026', favorite: false, disabled: false },
  argTypes: {
    documentId: { control: false, description: 'The document to add or remove. Required.' },
    favorite: { control: 'boolean', description: 'Whether it is a favorite now. Two-way.' },
    disabled: { control: 'boolean', description: 'Shown but not pressable.' },
    changed: { control: false, description: 'The server confirmed; carries the new state.' },
    failed: { control: false, description: 'The server refused; carries the error.' },
  },
  decorators: [applicationConfig({ providers: [favorites(() => of({} as NuxeoDocument))] })],
};

export default meta;

type Story = StoryObj<NxsFavoriteToggleComponent>;

/** Press it: the star fills and `aria-pressed` turns true once the server confirms. */
export const NotAFavorite: Story = {};

export const AFavorite: Story = { args: { favorite: true } };

/** A slow server: the star stays focusable and ignores presses until it answers (`aria-busy`). */
export const SlowServer: Story = {
  decorators: [
    applicationConfig({
      providers: [favorites(() => of({} as NuxeoDocument).pipe(delay(1500)))],
    }),
  ],
};

/** The server refuses: the state is unchanged and `failed` carries the error. */
export const Refused: Story = {
  decorators: [
    applicationConfig({ providers: [favorites(() => throwError(() => ({ status: 403 })))] }),
  ],
};

export const Disabled: Story = { args: { disabled: true } };
