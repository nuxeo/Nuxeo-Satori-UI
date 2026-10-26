import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADMIN_ACCESS_CHECKS,
  CURRENT_USERNAME,
  DocumentDetailService,
  type NuxeoComment,
  type NuxeoDocument,
  type NuxeoDocumentList,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsToastService } from '../toast/toast.service';
import { NxsCommentExtraDirective } from './comment-extra.directive';
import { NxsCommentsComponent } from './comments.component';

const DOC = 'doc-1';

const entry = (
  uid: string,
  author: string,
  text: string,
  parentId = DOC,
  extra: Record<string, unknown> = {},
): NuxeoDocument => ({
  uid,
  type: 'Comment',
  title: uid,
  path: `/comments/${uid}`,
  lastModified: '2026-10-01T00:00:00.000Z',
  properties: {
    'comment:author': author,
    'comment:text': text,
    'comment:parentId': parentId,
    'comment:creationDate': '2026-10-01T09:00:00.000Z',
    'dc:modified': '2026-10-01T09:00:01.000Z',
    ...extra,
  },
});

const list = (...entries: NuxeoDocument[]): NuxeoDocumentList =>
  ({ entries, totalSize: entries.length }) as unknown as NuxeoDocumentList;

const THREAD = list(
  entry('c1', 'jdoe', 'First comment'),
  entry('c2', 'asmith', 'Second comment'),
  entry('r1', 'asmith', 'A reply', 'c1'),
  entry('r2', 'jdoe', 'Another reply', 'c1'),
  entry('rr', 'asmith', 'A reply to a reply', 'r1'),
  entry('orphan', 'asmith', 'Parent not loaded', 'missing'),
);

const created = (id: string, text: string, parentId = DOC): NuxeoComment => ({
  id,
  parentId,
  text,
  author: 'jdoe',
  creationDate: '2026-10-02T09:00:00.000Z',
});

const httpError = (status: number) => new HttpErrorResponse({ status });

@Component({
  standalone: true,
  imports: [NxsCommentsComponent, NxsCommentExtraDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-comments
      [documentUid]="uid()"
      [readOnly]="readOnly()"
      [pageSize]="pageSize()"
      [maxChars]="maxChars()"
      (threadChange)="thread = $event"
    >
      <ng-template nxsCommentExtra let-comment>
        <span class="extra">extra:{{ comment.id }}</span>
      </ng-template>
    </nxs-comments>
  `,
})
class HostComponent {
  readonly uid = signal(DOC);
  readonly readOnly = signal(false);
  readonly pageSize = signal(10);
  readonly maxChars = signal(256);
  thread: readonly NuxeoComment[] = [];
}

describe('NxsCommentsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let username: string | null;
  let administrator: boolean;
  let documents: {
    getAllComments: ReturnType<typeof vi.fn<(uid: string) => Observable<NuxeoDocumentList>>>;
    createComment: ReturnType<typeof vi.fn>;
    createReply: ReturnType<typeof vi.fn>;
    updateComment: ReturnType<typeof vi.fn>;
    deleteComment: ReturnType<typeof vi.fn>;
  };
  let toastError: ReturnType<typeof vi.spyOn>;

  const el = (): HTMLElement => fixture.nativeElement;
  const all = (selector: string): HTMLElement[] => [
    ...el().querySelectorAll<HTMLElement>(selector),
  ];
  const texts = (selector: string): string[] =>
    all(selector).map((n) => n.textContent?.trim() ?? '');
  const button = (label: string, root: ParentNode = el()): HTMLButtonElement | undefined =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
    );
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const type = async (textarea: HTMLTextAreaElement, value: string): Promise<void> => {
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    await settle();
  };
  const ctrlEnter = async (target: HTMLElement): Promise<void> => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    await settle();
  };
  const commentBox = (): HTMLTextAreaElement =>
    el().querySelector<HTMLTextAreaElement>('textarea[id$="-new"]') as HTMLTextAreaElement;
  const menuFor = async (text: string): Promise<HTMLElement[]> => {
    const item = all('.nxs-comments__comment').find((li) =>
      li.querySelector('.nxs-comments__text')?.textContent?.includes(text),
    );
    item?.querySelector<HTMLButtonElement>('.nxs-comments__menu')?.click();
    await settle();
    return [...document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button')];
  };

  async function mount(thread: NuxeoDocumentList = THREAD): Promise<void> {
    documents.getAllComments.mockReturnValue(of(thread));
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await settle();
  }

  beforeEach(async () => {
    username = 'jdoe';
    administrator = false;
    documents = {
      getAllComments: vi.fn(),
      createComment: vi.fn(),
      createReply: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
    };
    toastError = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DocumentDetailService, useValue: documents },
        { provide: CURRENT_USERNAME, useValue: () => username },
        {
          provide: ADMIN_ACCESS_CHECKS,
          useValue: {
            isAdministrator: () => administrator,
            isPowerUser: () => false,
            hasAdministrationAccess: () => false,
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    vi.restoreAllMocks();
  });

  describe('reading', () => {
    it('lists top-level comments in order with their replies folded behind a count', async () => {
      await mount();
      expect(documents.getAllComments).toHaveBeenCalledWith(DOC);
      expect(
        texts('.nxs-comments__comment:not(.nxs-comments__comment--reply) > .nxs-comments__text'),
      ).toEqual(['First comment', 'Second comment']);
      expect(all('.nxs-comments__comment--reply')).toHaveLength(0);
      const summary = el().querySelector<HTMLButtonElement>('.nxs-comments__summary');
      expect(summary?.textContent).toContain('3 replies');
      expect(summary?.textContent).toContain('Last reply');
      expect(summary?.getAttribute('aria-expanded')).toBe('false');

      summary?.click();
      await settle();
      // A reply to a reply hangs from its top-level comment; one whose parent is unknown is left out.
      expect(texts('.nxs-comments__comment--reply .nxs-comments__text')).toEqual([
        'A reply',
        'Another reply',
        'A reply to a reply',
      ]);
      expect(el().textContent).not.toContain('Parent not loaded');
      expect(el().querySelector('.nxs-comments__summary')).toBeNull();
    });

    it('hands every loaded comment and reply to the host', async () => {
      await mount();
      expect(host.thread.map((c) => c.id)).toEqual(['c1', 'c2', 'r1', 'r2', 'rr']);
      expect(host.thread.find((c) => c.id === 'rr')?.parentId).toBe('r1');
    });

    it('says "1 reply" for exactly one', async () => {
      await mount(list(entry('c1', 'jdoe', 'Only'), entry('r1', 'jdoe', 'Reply', 'c1')));
      expect(el().querySelector('.nxs-comments__summary')?.textContent).toContain('1 reply');
    });

    it('shows the newest comments first page and the rest behind "View all"', async () => {
      const many = Array.from({ length: 4 }, (_, i) => entry(`c${i}`, 'jdoe', `Comment ${i}`));
      documents.getAllComments.mockReturnValue(of(list(...many)));
      fixture = TestBed.createComponent(HostComponent);
      host = fixture.componentInstance;
      host.pageSize.set(2);
      await settle();
      expect(texts('.nxs-comments__text')).toEqual(['Comment 2', 'Comment 3']);
      button('View all 4 comments')?.click();
      await settle();
      expect(texts('.nxs-comments__text')).toEqual([
        'Comment 0',
        'Comment 1',
        'Comment 2',
        'Comment 3',
      ]);
      expect(button('View all 4 comments')).toBeUndefined();
    });

    it('pages a long reply list the same way', async () => {
      const replies = Array.from({ length: 3 }, (_, i) =>
        entry(`r${i}`, 'jdoe', `Reply ${i}`, 'c1'),
      );
      documents.getAllComments.mockReturnValue(of(list(entry('c1', 'jdoe', 'Root'), ...replies)));
      fixture = TestBed.createComponent(HostComponent);
      host = fixture.componentInstance;
      host.pageSize.set(2);
      await settle();
      el().querySelector<HTMLButtonElement>('.nxs-comments__summary')?.click();
      await settle();
      expect(texts('.nxs-comments__comment--reply .nxs-comments__text')).toEqual([
        'Reply 1',
        'Reply 2',
      ]);
      button('View all 3 replies')?.click();
      await settle();
      expect(texts('.nxs-comments__comment--reply .nxs-comments__text')).toHaveLength(3);
    });

    it('marks a comment edited only when it changed after it was made', async () => {
      await mount(
        list(
          // What Nuxeo 2025 returns for a comment never edited: both dates the same.
          entry('c1', 'jdoe', 'Untouched', DOC, {
            'comment:modificationDate': '2026-10-01T09:00:00.000Z',
          }),
          entry('c2', 'jdoe', 'Changed', DOC, {
            'comment:modificationDate': '2026-10-01T10:00:00.000Z',
          }),
        ),
      );
      const times = texts('.nxs-comments__time');
      expect(times[0]).not.toContain('(edited)');
      expect(times[1]).toContain('(edited)');
    });

    it('cuts a long comment short behind "Show all"', async () => {
      const long = 'x'.repeat(30);
      documents.getAllComments.mockReturnValue(of(list(entry('c1', 'jdoe', long))));
      fixture = TestBed.createComponent(HostComponent);
      host = fixture.componentInstance;
      host.maxChars.set(10);
      await settle();
      expect(el().querySelector('.nxs-comments__text')?.textContent).toContain(`${'x'.repeat(9)}…`);
      button('Show all')?.click();
      await settle();
      expect(el().querySelector('.nxs-comments__text')?.textContent?.trim()).toBe(long);
    });

    it('says when there are no comments', async () => {
      await mount(list());
      expect(el().textContent).toContain('No comments yet');
    });

    it('renders the projected template under each comment and reply', async () => {
      await mount();
      expect(texts('.extra')).toEqual(['extra:c1', 'extra:c2']);
      el().querySelector<HTMLButtonElement>('.nxs-comments__summary')?.click();
      await settle();
      expect(texts('.extra')).toContain('extra:r1');
    });

    it('offers Retry when the comments cannot be read', async () => {
      documents.getAllComments.mockReturnValue(throwError(() => httpError(500)));
      fixture = TestBed.createComponent(HostComponent);
      host = fixture.componentInstance;
      await settle();
      expect(el().querySelector('[role="alert"]')?.textContent).toContain(
        'The comments could not be loaded.',
      );
      documents.getAllComments.mockReturnValue(of(THREAD));
      button('Retry')?.click();
      await settle();
      expect(documents.getAllComments).toHaveBeenCalledTimes(2);
      expect(texts('.nxs-comments__text')).toContain('First comment');
    });

    it('loads the new document’s thread and drops what was typed for the old one', async () => {
      await mount();
      await type(commentBox(), 'Draft');
      documents.getAllComments.mockReturnValue(
        of(list(entry('o1', 'jdoe', 'Other document', 'doc-2'))),
      );
      host.uid.set('doc-2');
      await settle();
      expect(documents.getAllComments).toHaveBeenLastCalledWith('doc-2');
      expect(texts('.nxs-comments__text')).toEqual(['Other document']);
      expect(commentBox().value).toBe('');
    });

    it('drops a thread that arrives after it moved to another document', async () => {
      const late = new Subject<NuxeoDocumentList>();
      documents.getAllComments.mockImplementation((uid: string) =>
        uid === DOC ? late : of(list(entry('o1', 'jdoe', 'Other document', 'doc-2'))),
      );
      fixture = TestBed.createComponent(HostComponent);
      host = fixture.componentInstance;
      await settle();
      host.uid.set('doc-2');
      await settle();
      late.next(THREAD);
      await settle();
      expect(texts('.nxs-comments__text')).toEqual(['Other document']);
      expect(host.thread.map((c) => c.id)).toEqual(['o1']);
    });
  });

  describe('who may change what', () => {
    it('offers Edit and Delete on the user’s own comments only', async () => {
      await mount();
      const menus = all('.nxs-comments__menu');
      expect(menus).toHaveLength(1);
      expect(menus[0].getAttribute('aria-label')).toBe('Actions for the comment by jdoe');
      // Each item's text starts with its icon's ligature.
      const items = (await menuFor('First comment')).map((b) => b.textContent?.trim() ?? '');
      expect(items).toHaveLength(2);
      expect(items[0]).toMatch(/Edit$/);
      expect(items[1]).toMatch(/Delete$/);
    });

    it('offers them on everyone’s comments to an administrator', async () => {
      username = 'Administrator';
      administrator = true;
      await mount();
      expect(all('.nxs-comments__menu')).toHaveLength(2);
    });

    it('offers nothing to change, and no box, when read-only', async () => {
      await mount();
      host.readOnly.set(true);
      await settle();
      expect(all('.nxs-comments__menu')).toHaveLength(0);
      expect(all('.nxs-comments__reply')).toHaveLength(0);
      expect(el().querySelector('textarea')).toBeNull();
      // The thread itself still reads.
      expect(texts('.nxs-comments__text')).toContain('First comment');
    });

    it('offers Reply on top-level comments only', async () => {
      await mount();
      expect(all('.nxs-comments__reply').map((b) => b.getAttribute('aria-label'))).toEqual([
        'Reply to jdoe',
        'Reply to asmith',
      ]);
      el().querySelector<HTMLButtonElement>('.nxs-comments__summary')?.click();
      await settle();
      expect(all('.nxs-comments__comment--reply .nxs-comments__reply')).toHaveLength(0);
    });
  });

  describe('writing', () => {
    it('adds a comment at the end with Ctrl+Enter and empties the box', async () => {
      await mount();
      documents.createComment.mockReturnValue(of(created('c3', 'Third comment')));
      expect(button('Add comment')).toBeUndefined();
      await type(commentBox(), '  Third comment  ');
      expect(button('Add comment')).toBeDefined();
      await ctrlEnter(commentBox());
      expect(documents.createComment).toHaveBeenCalledWith(DOC, 'Third comment');
      expect(texts('.nxs-comments__text').at(-1)).toBe('Third comment');
      expect(commentBox().value).toBe('');
      expect(host.thread.map((c) => c.id)).toContain('c3');
    });

    it('does not send a blank comment, and Clear empties the box', async () => {
      await mount();
      await type(commentBox(), '   ');
      await ctrlEnter(commentBox());
      expect(documents.createComment).not.toHaveBeenCalled();
      await type(commentBox(), 'Never mind');
      button('Clear')?.click();
      await settle();
      expect(commentBox().value).toBe('');
    });

    it('opens the replies from Reply, focuses the reply box and adds the reply under its comment', async () => {
      await mount();
      documents.createReply.mockReturnValue(of(created('r9', 'New reply', 'wrong-parent')));
      all('.nxs-comments__reply')[1].click();
      await settle();
      const box = el().querySelector<HTMLTextAreaElement>('textarea[id*="-reply-c2"]');
      expect(box).not.toBeNull();
      expect(document.activeElement).toBe(box);
      await type(box as HTMLTextAreaElement, 'New reply');
      button('Add reply')?.click();
      await settle();
      expect(documents.createReply).toHaveBeenCalledWith(DOC, 'c2', 'New reply');
      expect(texts('.nxs-comments__comment--reply .nxs-comments__text')).toEqual(['New reply']);
      expect(host.thread.find((c) => c.id === 'r9')?.parentId).toBe('c2');
      expect(box?.value).toBe('');
    });

    it('edits a comment in place and marks it edited', async () => {
      await mount();
      documents.updateComment.mockReturnValue(
        of({ ...created('c1', 'First, revised'), modificationDate: '2026-10-03T00:00:00.000Z' }),
      );
      (await menuFor('First comment'))[0].click();
      await settle();
      const box = el().querySelector<HTMLTextAreaElement>('textarea[id$="-edit-c1"]');
      expect(box?.value).toBe('First comment');
      expect(document.activeElement).toBe(box);
      await type(box as HTMLTextAreaElement, 'First, revised');
      await ctrlEnter(box as HTMLTextAreaElement);
      expect(documents.updateComment).toHaveBeenCalledWith(DOC, 'c1', 'First, revised');
      expect(texts('.nxs-comments__text')[0]).toBe('First, revised');
      expect(texts('.nxs-comments__time')[0]).toContain('(edited)');
      expect(el().querySelector('textarea[id$="-edit-c1"]')).toBeNull();
    });

    it('edits a reply in place', async () => {
      await mount();
      documents.updateComment.mockReturnValue(of(created('r2', 'Reply, revised', 'c1')));
      el().querySelector<HTMLButtonElement>('.nxs-comments__summary')?.click();
      await settle();
      (await menuFor('Another reply'))[0].click();
      await settle();
      const box = el().querySelector<HTMLTextAreaElement>(
        'textarea[id$="-edit-r2"]',
      ) as HTMLTextAreaElement;
      await type(box, 'Reply, revised');
      button('Save')?.click();
      await settle();
      expect(documents.updateComment).toHaveBeenCalledWith(DOC, 'r2', 'Reply, revised');
      expect(texts('.nxs-comments__comment--reply .nxs-comments__text')).toContain(
        'Reply, revised',
      );
    });

    it('leaves an edit without a request when the text is unchanged, or on Escape', async () => {
      await mount();
      (await menuFor('First comment'))[0].click();
      await settle();
      const box = el().querySelector<HTMLTextAreaElement>(
        'textarea[id$="-edit-c1"]',
      ) as HTMLTextAreaElement;
      await ctrlEnter(box);
      expect(documents.updateComment).not.toHaveBeenCalled();
      expect(el().querySelector('textarea[id$="-edit-c1"]')).toBeNull();

      (await menuFor('First comment'))[0].click();
      await settle();
      const again = el().querySelector<HTMLTextAreaElement>(
        'textarea[id$="-edit-c1"]',
      ) as HTMLTextAreaElement;
      await type(again, 'Changed my mind');
      again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(el().querySelector('textarea[id$="-edit-c1"]')).toBeNull();
      expect(texts('.nxs-comments__text')[0]).toBe('First comment');
    });
  });

  describe('deleting', () => {
    const dialogText = (): string =>
      document.querySelector('.mat-mdc-dialog-container')?.textContent ?? '';
    const dialogButton = (label: string): HTMLButtonElement | undefined =>
      button(label, document.querySelector('.mat-mdc-dialog-container') ?? document);

    it('asks first, says the replies go too, then removes the comment and its replies', async () => {
      await mount();
      documents.deleteComment.mockReturnValue(of(undefined));
      (await menuFor('First comment'))[1].click();
      await settle();
      expect(dialogText()).toContain('Delete comment');
      expect(dialogText()).toContain('All replies to this comment will also be deleted.');
      expect(document.querySelector('.mat-mdc-dialog-container')?.getAttribute('role')).toBe(
        'alertdialog',
      );
      dialogButton('Delete')?.click();
      await settle();
      expect(documents.deleteComment).toHaveBeenCalledWith(DOC, 'c1');
      expect(texts('.nxs-comments__text')).toEqual(['Second comment']);
      expect(el().querySelector('.nxs-comments__summary')).toBeNull();
      expect(host.thread.map((c) => c.id)).toEqual(['c2']);
      expect(document.activeElement?.classList).toContain('nxs-comments__list');
    });

    it('sends nothing when the confirmation is cancelled', async () => {
      await mount();
      (await menuFor('First comment'))[1].click();
      await settle();
      dialogButton('Cancel')?.click();
      await settle();
      expect(documents.deleteComment).not.toHaveBeenCalled();
      expect(texts('.nxs-comments__text')).toContain('First comment');
      // The dialog was opened after the menu handed focus back, so Cancel returns it there.
      expect(document.activeElement).toBe(el().querySelector('.nxs-comments__menu'));
    });

    it('deletes a reply after asking about the reply', async () => {
      await mount();
      documents.deleteComment.mockReturnValue(of(undefined));
      el().querySelector<HTMLButtonElement>('.nxs-comments__summary')?.click();
      await settle();
      (await menuFor('Another reply'))[1].click();
      await settle();
      expect(dialogText()).toContain('Delete reply');
      expect(dialogText()).toContain('Are you sure you want to delete this reply?');
      dialogButton('Delete')?.click();
      await settle();
      expect(documents.deleteComment).toHaveBeenCalledWith(DOC, 'r2');
      expect(texts('.nxs-comments__comment--reply .nxs-comments__text')).toEqual([
        'A reply',
        'A reply to a reply',
      ]);
    });

    it('does not mention replies for a comment without any', async () => {
      await mount(list(entry('c1', 'jdoe', 'Alone')));
      (await menuFor('Alone'))[1].click();
      await settle();
      expect(dialogText()).toContain('Are you sure you want to delete this comment?');
      expect(dialogText()).not.toContain('All replies');
    });
  });

  describe('failures', () => {
    it('says a refused comment was refused, not that it failed', async () => {
      await mount();
      documents.createComment.mockReturnValue(throwError(() => httpError(403)));
      await type(commentBox(), 'Not allowed');
      await ctrlEnter(commentBox());
      expect(toastError).toHaveBeenCalledWith(
        'You do not have permission to comment on this document.',
      );
      expect(commentBox().value).toBe('Not allowed');
    });

    it('reloads the thread when the comment being edited is gone', async () => {
      await mount();
      documents.updateComment.mockReturnValue(throwError(() => httpError(404)));
      (await menuFor('First comment'))[0].click();
      await settle();
      const box = el().querySelector<HTMLTextAreaElement>(
        'textarea[id$="-edit-c1"]',
      ) as HTMLTextAreaElement;
      await type(box, 'Too late');
      await ctrlEnter(box);
      expect(toastError).toHaveBeenCalledWith(
        'This comment is no longer available. The comments have been reloaded.',
      );
      expect(documents.getAllComments).toHaveBeenCalledTimes(2);
    });

    it('names the comment replied to when a reply’s parent is gone', async () => {
      await mount();
      documents.createReply.mockReturnValue(throwError(() => httpError(404)));
      all('.nxs-comments__reply')[0].click();
      await settle();
      const box = el().querySelector<HTMLTextAreaElement>(
        'textarea[id*="-reply-c1"]',
      ) as HTMLTextAreaElement;
      await type(box, 'Hello?');
      await ctrlEnter(box);
      expect(toastError).toHaveBeenCalledWith(
        'This comment is no longer available. The comments have been reloaded.',
      );
    });

    it('reports any other failure as one, keeping the comment on screen', async () => {
      await mount();
      documents.deleteComment.mockReturnValue(throwError(() => httpError(500)));
      (await menuFor('First comment'))[1].click();
      await settle();
      button('Delete', document.querySelector('.mat-mdc-dialog-container') ?? document)?.click();
      await settle();
      expect(toastError).toHaveBeenCalledWith('The comment could not be deleted.');
      expect(texts('.nxs-comments__text')).toContain('First comment');
    });

    it('does not reload on a 404 for a new top-level comment', async () => {
      await mount();
      documents.createComment.mockReturnValue(throwError(() => httpError(404)));
      await type(commentBox(), 'Orphan');
      await ctrlEnter(commentBox());
      expect(toastError).toHaveBeenCalledWith('The comment could not be added.');
      expect(documents.getAllComments).toHaveBeenCalledTimes(1);
    });

    it('sends one request while one is in flight', async () => {
      await mount();
      const pending = new Subject<NuxeoComment>();
      documents.createComment.mockReturnValue(pending);
      await type(commentBox(), 'Once');
      await ctrlEnter(commentBox());
      await ctrlEnter(commentBox());
      expect(documents.createComment).toHaveBeenCalledTimes(1);
      expect(button('Add comment')?.disabled).toBe(true);
      pending.next(created('c3', 'Once'));
      pending.complete();
      await settle();
      expect(texts('.nxs-comments__text').at(-1)).toBe('Once');
    });
  });
});
