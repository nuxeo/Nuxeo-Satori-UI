import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { defer, NEVER, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, waitFor, within } from 'storybook/test';

import {
  ADMIN_ACCESS_CHECKS,
  CURRENT_USERNAME,
  DocumentDetailService,
  type NuxeoComment,
  type NuxeoDocument,
  type NuxeoDocumentList,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsCommentsComponent } from './comments.component';

const DOC = 'story-doc';
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

interface Seed {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  readonly parentId?: string;
  readonly hours: number;
  readonly edited?: boolean;
}

const THREAD: readonly Seed[] = [
  {
    id: 'c1',
    author: 'jdoe',
    text: 'Figures for March are in. Can someone check the totals?',
    hours: 30,
  },
  {
    id: 'r1',
    author: 'asmith',
    text: 'Checked — they match the ledger.',
    parentId: 'c1',
    hours: 28,
  },
  { id: 'r2', author: 'jdoe', text: 'Thanks!', parentId: 'c1', hours: 27 },
  {
    id: 'c2',
    author: 'asmith',
    text: 'The cover page still says Q4. I have fixed the title, please review.',
    hours: 5,
    edited: true,
  },
  {
    id: 'c3',
    author: 'mlopez',
    text: `Before this goes to the board: ${'the appendix repeats the regional breakdown, the risk register is a month old and the forecast assumes the old exchange rate. '.repeat(2)}`,
    hours: 1,
  },
];

interface Fixture {
  readonly seeds: readonly Seed[];
  readonly username: string;
  readonly administrator?: boolean;
  /** The HTTP status reading the thread fails with, when set. */
  readonly readFails?: number;
  /** The HTTP status every write fails with, when set. */
  readonly writeFails?: number;
  /** Reads never answer, so the panel stays loading. */
  readonly readsHang?: boolean;
}

/**
 * `DocumentDetailService` over one document's comments held in memory, so the panel reads, adds,
 * edits and deletes as it does against Nuxeo, with nothing sent anywhere.
 */
function inMemoryComments(
  fixture: Fixture,
): Pick<
  DocumentDetailService,
  'getAllComments' | 'createComment' | 'createReply' | 'updateComment' | 'deleteComment'
> {
  let seeds = [...fixture.seeds];
  let next = 1;
  // Nuxeo stamps a new comment's modification date with its creation date; an edit moves it on.
  const dates = (seed: Seed): { created: string; modified: string } => {
    const created = hoursAgo(seed.hours);
    return { created, modified: seed.edited ? hoursAgo(Math.max(seed.hours - 0.5, 0)) : created };
  };
  const asDocument = (seed: Seed): NuxeoDocument => {
    const { created, modified } = dates(seed);
    return {
      uid: seed.id,
      type: 'Comment',
      title: seed.id,
      path: `/comments/${seed.id}`,
      lastModified: modified,
      properties: {
        'comment:author': seed.author,
        'comment:text': seed.text,
        'comment:parentId': seed.parentId ?? DOC,
        'comment:creationDate': created,
        'comment:modificationDate': modified,
      },
    };
  };
  const asComment = (seed: Seed): NuxeoComment => {
    const { created, modified } = dates(seed);
    return {
      id: seed.id,
      parentId: seed.parentId ?? DOC,
      text: seed.text,
      author: seed.author,
      creationDate: created,
      modificationDate: modified,
    };
  };
  const write = <T>(change: () => T): Observable<T> =>
    defer(() =>
      fixture.writeFails
        ? throwError(() => new HttpErrorResponse({ status: fixture.writeFails }))
        : of(change()),
    );
  const add = (text: string, parentId?: string): NuxeoComment => {
    const seed: Seed = { id: `new-${next++}`, author: fixture.username, text, parentId, hours: 0 };
    seeds = [...seeds, seed];
    return asComment(seed);
  };

  return {
    getAllComments: logged('getAllComments', () =>
      defer(() => {
        if (fixture.readsHang) return NEVER;
        if (fixture.readFails) {
          return throwError(() => new HttpErrorResponse({ status: fixture.readFails }));
        }
        const ordered = [...seeds].sort((a, b) => b.hours - a.hours);
        return of({ entries: ordered.map(asDocument) } as unknown as NuxeoDocumentList);
      }),
    ),
    createComment: logged('createComment', (_uid: string, text: string) => write(() => add(text))),
    createReply: logged('createReply', (_uid: string, parentId: string, text: string) =>
      write(() => add(text, parentId)),
    ),
    updateComment: logged('updateComment', (_uid: string, id: string, text: string) =>
      write(() => {
        seeds = seeds.map((s) => (s.id === id ? { ...s, text, edited: true } : s));
        return asComment(seeds.find((s) => s.id === id) as Seed);
      }),
    ),
    deleteComment: logged('deleteComment', (_uid: string, id: string) =>
      write(() => {
        seeds = seeds.filter((s) => s.id !== id && s.parentId !== id);
      }),
    ),
  };
}

/** Logs each call in the Actions panel under `name`, then lets the fake answer it. */
function logged<A extends unknown[], R>(
  name: string,
  method: (...args: A) => R,
): (...args: A) => R {
  return (...args) => {
    action(name)(...args);
    return method(...args);
  };
}

/** A factory, so each render starts from the declared thread rather than the last render's edits. */
const withThread = (fixture: Fixture) =>
  applicationConfig({
    providers: [
      { provide: DocumentDetailService, useFactory: () => inMemoryComments(fixture) },
      { provide: CURRENT_USERNAME, useValue: () => fixture.username },
      {
        provide: ADMIN_ACCESS_CHECKS,
        useValue: {
          isAdministrator: () => fixture.administrator ?? false,
          isPowerUser: () => false,
          hasAdministrationAccess: () => fixture.administrator ?? false,
        },
      },
    ] satisfies Provider[],
  });

/**
 * A document's comments and replies, as Web UI's comment thread shows them: the newest first page,
 * oldest at the top; replies folded behind a count; Edit and Delete for the author and
 * administrators; Ctrl+Enter to submit.
 */
const AS_JDOE: Fixture = { seeds: THREAD, username: 'jdoe' };

const meta: Meta<NxsCommentsComponent> = {
  title: 'Documents/Comments',
  component: NxsCommentsComponent,
  tags: ['autodocs'],
  render: (args) => ({
    props: args,
    template: `
      <div style="width: 360px; padding: 0 16px; background: var(--mat-sys-surface)">
        <nxs-comments
          [documentUid]="documentUid"
          [readOnly]="readOnly"
          [pageSize]="pageSize"
          [maxChars]="maxChars"
          (threadChange)="threadChange($event)"
        />
      </div>
    `,
  }),
  args: {
    documentUid: DOC,
    readOnly: false,
    pageSize: 10,
    maxChars: 256,
  },
  argTypes: {
    documentUid: { control: 'text', description: 'The commented document. Required.' },
    readOnly: {
      control: 'boolean',
      description: 'Shows the thread without the comment box, Reply, Edit or Delete.',
    },
    pageSize: {
      control: { type: 'number', min: 1 },
      description: 'How many of the newest comments, and of each one’s replies, show at first.',
    },
    maxChars: {
      control: { type: 'number', min: 10 },
      description: 'Longer comments are cut short behind "Show all".',
    },
    threadChange: {
      action: 'threadChange',
      description: 'Every loaded comment and reply, after loading and after each change.',
    },
  },
};

export default meta;

type Story = StoryObj<NxsCommentsComponent>;

/**
 * Signed in as `jdoe`: Edit and Delete on jdoe's own comment only. The long comment is cut short,
 * and the first one's two replies wait behind their count.
 */
export const Thread: Story = {
  decorators: [withThread(AS_JDOE)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText(/Figures for March/)).toBeVisible());
    await expect(
      await canvas.findAllByRole('button', { name: /^Actions for the comment by/ }),
    ).toHaveLength(1);
    await expect(await canvas.findByRole('button', { name: /2 replies/ })).toBeVisible();
  },
};

/** An administrator may edit and delete anyone's comment. */
export const AsAdministrator: Story = {
  decorators: [withThread({ seeds: THREAD, username: 'Administrator', administrator: true })],
};

/** Read-only: the thread, without the box, Reply, Edit or Delete. */
export const ReadOnly: Story = {
  decorators: [withThread(AS_JDOE)],
  args: { readOnly: true },
};

/** More comments than one page: the oldest wait behind "View all". */
export const ManyComments: Story = {
  decorators: [withThread(AS_JDOE)],
  args: { pageSize: 2 },
};

/** No comments yet: the empty message and the box. */
export const Empty: Story = {
  decorators: [withThread({ seeds: [], username: 'jdoe' })],
};

/** Reading the thread failed: the message and Retry. */
export const LoadFailed: Story = {
  decorators: [withThread({ ...AS_JDOE, readFails: 500 })],
};

/** Every write is refused, as for a user Nuxeo does not let comment: the toast says so. */
export const WritesRefused: Story = {
  decorators: [withThread({ ...AS_JDOE, writeFails: 403 })],
};

/** The thread is still loading. */
export const Loading: Story = {
  decorators: [withThread({ ...AS_JDOE, readsHang: true })],
};
