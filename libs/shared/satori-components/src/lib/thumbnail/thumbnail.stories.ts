import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError, type Observable } from 'rxjs';

import { DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsThumbnailComponent } from './thumbnail.component';
import { provideNxsThumbnailCache } from './thumbnail-cache';

/** A thumbnail rendition, drawn rather than fetched, so the story needs no server. */
const PICTURE = new Blob(
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">
      <rect width="160" height="120" fill="#5c6bc0"/>
      <circle cx="118" cy="34" r="14" fill="#ffd54f"/>
      <path d="M0 120 L54 58 L92 98 L116 76 L160 120 Z" fill="#283593"/>
    </svg>`,
  ],
  { type: 'image/svg+xml' },
);

/** `fetchThumbnail` answering every document with `answer`. */
const thumbnails = (answer: () => Observable<Blob>): Provider => ({
  provide: DocumentDetailService,
  useValue: { fetchThumbnail: answer },
});

/**
 * A document's `thumbnail` rendition, fetched through the authenticated client and shown from a
 * blob URL the component creates and revokes. The type icon inside it shows until the image
 * arrives, and stays when there is none. These stories answer from memory instead of Nuxeo.
 */
const meta: Meta<NxsThumbnailComponent> = {
  title: 'Primitives/Thumbnail',
  component: NxsThumbnailComponent,
  tags: ['autodocs'],
  args: { documentId: 'claims-photo', alt: '' },
  argTypes: {
    documentId: { control: false, description: 'The document whose thumbnail to show. Required.' },
    alt: {
      control: 'text',
      description: 'The text alternative, already translated. Blank makes it decorative.',
    },
  },
  render: (args) => ({
    props: args,
    template: `
      <nxs-thumbnail
        style="width: 160px; height: 120px; object-fit: cover; border-radius: 8px"
        [documentId]="documentId"
        [alt]="alt"
      >
        <span aria-hidden="true" style="font-size: 48px">🖼</span>
      </nxs-thumbnail>
    `,
  }),
};

export default meta;

type Story = StoryObj<NxsThumbnailComponent>;

/** The rendition arrived: the image fills the host, which the caller sizes. */
export const Loaded: Story = {
  decorators: [applicationConfig({ providers: [thumbnails(() => of(PICTURE))] })],
};

/** No rendition, or the request failed: the projected icon stays, laid out as without the wrapper. */
export const NoThumbnail: Story = {
  decorators: [
    applicationConfig({
      providers: [thumbnails(() => throwError(() => ({ status: 404 })))],
    }),
  ],
};

/**
 * A page listing many lists `provideNxsThumbnailCache()`: thumbnails of one document share one
 * request and one URL, and at most four requests run at once.
 */
export const UnderAPageCache: Story = {
  decorators: [
    applicationConfig({ providers: [thumbnails(() => of(PICTURE)), provideNxsThumbnailCache()] }),
  ],
  render: (args) => ({
    props: { ...args, ids: ['a', 'b', 'c', 'a', 'b', 'c'] },
    template: `
      <div style="display: flex; flex-wrap: wrap; gap: 8px; max-width: 304px">
        @for (id of ids; track $index) {
          <nxs-thumbnail
            style="width: 96px; height: 72px; object-fit: cover"
            [documentId]="id"
            [alt]="alt"
          />
        }
      </div>
    `,
  }),
};
