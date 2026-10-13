import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { defer, delay, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { TagService } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsTagEditorComponent } from './tag-editor.component';

/** Tags already in the repository, which the suggestions come from. */
const REPOSITORY = ['contract', 'contoso', 'control-plan', 'invoice', 'q3report', 'quarterly'];

interface Fixture {
  readonly tags: readonly string[];
  /** The HTTP status every tag change fails with, when set. */
  readonly writeFails?: number;
  /** How long each change takes, in milliseconds. */
  readonly latency?: number;
}

/**
 * `TagService` over one document's tags held in memory. Labels are normalised the way Nuxeo does —
 * lower case, no spaces — so a typed "Q3 Report" comes back as `q3report`.
 */
function inMemoryTags(fixture: Fixture): Pick<TagService, 'addTag' | 'removeTag' | 'suggestTags'> {
  let tags = [...fixture.tags];
  const write = (change: () => void): Observable<string[]> =>
    defer(() => {
      if (fixture.writeFails) {
        return throwError(() => new HttpErrorResponse({ status: fixture.writeFails }));
      }
      change();
      return of([...tags]);
    }).pipe(delay(fixture.latency ?? 300));
  return {
    addTag: logged('addTag', (_uid: string, label: string) =>
      write(() => {
        const stored = label.toLowerCase().replace(/\s+/g, '');
        if (!tags.includes(stored)) tags = [...tags, stored];
      }),
    ),
    removeTag: logged('removeTag', (_uid: string, label: string) =>
      write(() => (tags = tags.filter((tag) => tag !== label))),
    ),
    suggestTags: logged('suggestTags', (term: string) =>
      of(REPOSITORY.filter((tag) => tag.includes(term.toLowerCase()))),
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

/** A factory, so each render starts from the declared tags rather than the last render's edits. */
const withTags = (fixture: Fixture) =>
  applicationConfig({
    providers: [
      { provide: TagService, useFactory: () => inMemoryTags(fixture) },
    ] satisfies Provider[],
  });

const TAGGED: Fixture = { tags: ['contract', 'invoice'] };

/**
 * A document's tags, as the document page's tag field shows them: chips with a remove button, a box
 * that suggests existing tags and offers the typed text as a new one, and every change saved at
 * once.
 */
const meta: Meta<NxsTagEditorComponent> = {
  title: 'Documents/Tag editor',
  component: NxsTagEditorComponent,
  tags: ['autodocs'],
  render: (args) => ({
    props: args,
    template: `
      <div style="width: 320px; padding: 16px; background: var(--mat-sys-surface)">
        <nxs-tag-editor
          [documentUid]="documentUid"
          [tags]="tags"
          [readOnly]="readOnly"
          (tagsChange)="tagsChange($event)"
        />
      </div>
    `,
  }),
  args: {
    documentUid: 'story-doc',
    tags: TAGGED.tags,
    readOnly: false,
  },
  argTypes: {
    documentUid: { control: 'text', description: 'The document to tag. Required.' },
    tags: {
      control: 'object',
      description: 'The document’s tags as loaded — the labels of `nxtag:tags`.',
    },
    readOnly: {
      control: 'boolean',
      description: 'Shows the tags only. Use `canTagDocument(doc)` to decide, as Web UI does.',
    },
    tagsChange: {
      action: 'tagsChange',
      description: 'The document’s tags after each saved change, as Nuxeo stored them.',
    },
  },
};

export default meta;

type Story = StoryObj<NxsTagEditorComponent>;

/** Two tags, each removable. Type "con" for suggestions; "Q3 Report" is stored as `q3report`. */
export const Editable: Story = {
  decorators: [withTags(TAGGED)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Remove tag contract' })).toBeVisible();
    const box = canvas.getByRole('combobox', { name: 'Add tags to this document' });
    await userEvent.type(box, 'Q3 Report{Enter}');
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Remove tag q3report' })).toBeVisible(),
    );
  },
};

/** Read-only, as for a reader, a version or a proxy: the tags without the box or remove buttons. */
export const ReadOnly: Story = {
  decorators: [withTags(TAGGED)],
  args: { readOnly: true },
};

/** No tags yet. */
export const Empty: Story = {
  decorators: [withTags({ tags: [] })],
  args: { tags: [] },
};

/** No tags, read-only: a dash, read out as "No tags". */
export const EmptyReadOnly: Story = {
  decorators: [withTags({ tags: [] })],
  args: { tags: [], readOnly: true },
};

/** Changes take three seconds, so the pending chip and its progress indicator stay visible. */
export const Saving: Story = {
  decorators: [withTags({ ...TAGGED, latency: 3000 })],
};

/** Every change is refused with 403: the chip goes back and the toast says why. */
export const ChangesRefused: Story = {
  decorators: [withTags({ ...TAGGED, writeFails: 403 })],
};
