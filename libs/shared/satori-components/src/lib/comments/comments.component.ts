import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  numberAttribute,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import {
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ADMIN_ACCESS_CHECKS,
  avatarColor,
  CURRENT_USERNAME,
  DocumentDetailService,
  formatRelativeTime,
  type NuxeoComment,
  type NuxeoDocument,
  type NuxeoDocumentList,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  catchError,
  finalize,
  map,
  merge,
  of,
  Subject,
  switchMap,
  tap,
  type Observable,
} from 'rxjs';

import { NxsAvatarComponent } from '../avatar/avatar.component';
import { nxsInitial } from '../properties-panel/property-text';
import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { provideNxsToast, NxsToastService } from '../toast/toast.service';
import { NxsCommentExtraDirective } from './comment-extra.directive';

/** A comment as the panel shows it: the top-level comments in order, each with its replies. */
interface NxsThread {
  readonly comments: readonly NuxeoComment[];
  readonly replies: Readonly<Record<string, readonly NuxeoComment[]>>;
}

type NxsCommentAction = 'add' | 'edit' | 'delete';

interface NxsDeleteDialogData {
  readonly reply: boolean;
  readonly replies: number;
}

const text = (properties: Record<string, unknown>, key: string): string => {
  const value = properties[key];
  return typeof value === 'string' ? value : '';
};

/** A `Comment` document as a comment, as the `@comment` endpoint would return it. */
const toComment = (entry: NuxeoDocument, documentUid: string): NuxeoComment => {
  const properties = entry.properties ?? {};
  const modified = text(properties, 'comment:modificationDate');
  return {
    id: entry.uid,
    parentId: text(properties, 'comment:parentId') || documentUid,
    text: text(properties, 'comment:text'),
    author: text(properties, 'comment:author'),
    creationDate: text(properties, 'comment:creationDate') || text(properties, 'dc:created'),
    ...(modified ? { modificationDate: modified } : {}),
  };
};

/**
 * Splits a document's comments into top-level comments and their replies. A reply to a reply,
 * which Web UI never writes but the API accepts, is listed under the top-level comment it hangs
 * from; one whose parent is not in the list is left out rather than shown out of place.
 */
const toThread = (list: NuxeoDocumentList, documentUid: string): NxsThread => {
  const all = (list.entries ?? []).map((entry) => toComment(entry, documentUid));
  const byId = new Map(all.map((comment) => [comment.id, comment]));
  const replies: Record<string, NuxeoComment[]> = {};
  for (const comment of all) {
    if (comment.parentId === documentUid) continue;
    let root = byId.get(comment.parentId);
    const seen = new Set<string>([comment.id]);
    while (root && root.parentId !== documentUid && !seen.has(root.id)) {
      seen.add(root.id);
      root = byId.get(root.parentId);
    }
    if (!root || root.parentId !== documentUid) continue;
    (replies[root.id] ??= []).push(comment);
  }
  return { comments: all.filter((comment) => comment.parentId === documentUid), replies };
};

let nextId = 0;

/**
 * A document's comments and their replies — Web UI's `nuxeo-document-comment-thread`.
 *
 * It reads and writes the thread itself through `DocumentDetailService`. As in Web UI:
 *
 * - The newest `pageSize` comments show, oldest first, under a "View all" button for the rest.
 * - Anyone who can read the document is offered the comment box; Nuxeo decides whether the comment
 *   is accepted. `readOnly` takes the box and the actions away.
 * - Edit and Delete are offered to the comment's author and to administrators only. Delete asks
 *   first, and says so when the replies go with it.
 * - Only a top-level comment takes replies. Its replies stay folded behind a count until opened.
 * - Ctrl+Enter submits; a comment longer than `maxChars` is cut short behind "Show all".
 *
 * `threadChange` hands the loaded comments and replies to the host, and a projected
 * `[nxsCommentExtra]` template renders under each one.
 */
@Component({
  selector: 'nxs-comments',
  standalone: true,
  templateUrl: './comments.component.html',
  styleUrl: './comments.component.scss',
  imports: [
    CdkTextareaAutosize,
    NgTemplateOutlet,
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    TranslatePipe,
    NxsAvatarComponent,
    NxsSpinnerComponent,
  ],
  providers: [provideNxsToast()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-comments' },
})
export class NxsCommentsComponent {
  private readonly documents = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);
  private readonly dialog = inject(MatDialog);
  private readonly username = inject(CURRENT_USERNAME);
  private readonly admin = inject(ADMIN_ACCESS_CHECKS);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The commented document. Changing it loads that document's thread. */
  readonly documentUid = input.required<string>();
  /** Shows the thread without the comment box, Reply, Edit or Delete. */
  readonly readOnly = input(false);
  /** How many of the newest comments, and of each comment's newest replies, show at first. */
  readonly pageSize = input(10, { transform: numberAttribute });
  /** Longer comments are cut short behind "Show all". */
  readonly maxChars = input(256, { transform: numberAttribute });

  /** Every loaded comment and reply, after the thread loads and after each change to it. */
  readonly threadChange = output<readonly NuxeoComment[]>();

  protected readonly extra = contentChild(NxsCommentExtraDirective);
  private readonly deleteDialog =
    viewChild.required<TemplateRef<NxsDeleteDialogData>>('deleteConfirmation');

  protected readonly id = `nxs-comments-${nextId++}`;
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly saving = signal(false);
  protected readonly comments = signal<readonly NuxeoComment[]>([]);
  protected readonly replies = signal<Readonly<Record<string, readonly NuxeoComment[]>>>({});
  protected readonly allShown = signal(false);
  protected readonly opened = signal<ReadonlySet<string>>(new Set());
  protected readonly allRepliesShown = signal<ReadonlySet<string>>(new Set());
  protected readonly fullText = signal<ReadonlySet<string>>(new Set());
  protected readonly editing = signal<string | null>(null);
  protected readonly editText = signal('');
  protected readonly newText = signal('');
  protected readonly replyTexts = signal<Readonly<Record<string, string>>>({});

  protected readonly shown = computed(() =>
    this.allShown() ? this.comments() : this.comments().slice(-this.pageSize()),
  );
  protected readonly hiddenCount = computed(() => this.comments().length - this.shown().length);

  private readonly reloads = new Subject<void>();
  private menuChoice: {
    readonly action: 'edit' | 'delete';
    readonly comment: NuxeoComment;
    readonly parent: NuxeoComment | null;
  } | null = null;

  constructor() {
    toObservable(this.documentUid)
      .pipe(
        tap(() => this.reset()),
        switchMap((uid) =>
          merge(of(undefined), this.reloads).pipe(switchMap(() => this.fetch(uid))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((thread) => {
        this.loading.set(false);
        if (!thread) {
          this.failed.set(true);
          return;
        }
        this.comments.set(thread.comments);
        this.replies.set(thread.replies);
        this.changed();
      });
  }

  /** Loads the thread again, keeping what is being typed. */
  reload(): void {
    this.reloads.next();
  }

  protected repliesOf(id: string): readonly NuxeoComment[] {
    return this.replies()[id] ?? [];
  }

  protected shownReplies(id: string): readonly NuxeoComment[] {
    const replies = this.repliesOf(id);
    return this.allRepliesShown().has(id) ? replies : replies.slice(-this.pageSize());
  }

  protected lastReply(id: string): string {
    const replies = this.repliesOf(id);
    return replies.length ? this.when(replies[replies.length - 1].creationDate) : '';
  }

  /** Web UI's rule: the author, by username, or an administrator. */
  protected canModify(comment: NuxeoComment): boolean {
    if (this.readOnly()) return false;
    const user = this.username();
    return (!!user && comment.author === user) || this.admin.isAdministrator();
  }

  protected initial(author: string): string {
    return nxsInitial(author);
  }

  protected color(author: string): ReturnType<typeof avatarColor> {
    return avatarColor(author);
  }

  protected when(date: string | undefined): string {
    return date ? formatRelativeTime(date, this.translate.currentLang() ?? 'en') : '';
  }

  /**
   * Nuxeo 2025 stamps `comment:modificationDate` with the creation date when a comment is made, so
   * Web UI's "set at all" test would mark every comment edited; a later date is an edit.
   */
  protected edited(comment: NuxeoComment): boolean {
    return !!comment.modificationDate && comment.modificationDate !== comment.creationDate;
  }

  protected truncated(comment: NuxeoComment): boolean {
    return !this.fullText().has(comment.id) && comment.text.length > this.maxChars();
  }

  protected shortText(comment: NuxeoComment): string {
    return `${comment.text.slice(0, this.maxChars() - 1)}…`;
  }

  protected showFullText(comment: NuxeoComment): void {
    this.fullText.update((ids) => new Set(ids).add(comment.id));
  }

  protected showAllReplies(id: string): void {
    this.allRepliesShown.update((ids) => new Set(ids).add(id));
  }

  protected textOf(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected setReplyText(id: string, value: string): void {
    this.replyTexts.update((texts) => ({ ...texts, [id]: value }));
  }

  protected replyText(id: string): string {
    return this.replyTexts()[id] ?? '';
  }

  /** Opens a comment's replies; from Reply, also puts the cursor in the reply box. */
  protected openReplies(id: string, focusBox = false): void {
    this.opened.update((ids) => new Set(ids).add(id));
    if (focusBox) this.focus(`${this.id}-reply-${id}`);
  }

  protected submitComment(): void {
    const value = this.newText().trim();
    if (!value || this.saving()) return;
    const uid = this.documentUid();
    this.save(this.documents.createComment(uid, value), 'add', false, (comment) => {
      this.comments.update((list) => [...list, { ...comment, parentId: uid }]);
      this.newText.set('');
    });
  }

  protected submitReply(parent: NuxeoComment): void {
    const value = this.replyText(parent.id).trim();
    if (!value || this.saving()) return;
    this.save(
      this.documents.createReply(this.documentUid(), parent.id, value),
      'add',
      true,
      (reply) => {
        this.replies.update((map) => ({
          ...map,
          [parent.id]: [...(map[parent.id] ?? []), { ...reply, parentId: parent.id }],
        }));
        this.setReplyText(parent.id, '');
      },
    );
  }

  protected choose(
    action: 'edit' | 'delete',
    comment: NuxeoComment,
    parent: NuxeoComment | null,
  ): void {
    this.menuChoice = { action, comment, parent };
  }

  /**
   * Runs the chosen item once the menu has closed and handed focus back to its button — otherwise
   * that hand-back takes the cursor out of the edit box, and the delete dialog, opened from an item
   * that no longer exists, has nowhere to return focus on Cancel.
   */
  protected menuClosed(): void {
    const choice = this.menuChoice;
    this.menuChoice = null;
    if (choice?.action === 'edit') this.startEdit(choice.comment);
    else if (choice) this.confirmDelete(choice.comment, choice.parent);
  }

  private startEdit(comment: NuxeoComment): void {
    this.editing.set(comment.id);
    this.editText.set(comment.text);
    this.focus(`${this.id}-edit-${comment.id}`);
  }

  protected cancelEdit(): void {
    this.editing.set(null);
    this.editText.set('');
  }

  protected saveEdit(comment: NuxeoComment, parent: NuxeoComment | null): void {
    const value = this.editText().trim();
    if (!value || this.saving()) return;
    if (value === comment.text) {
      this.cancelEdit();
      return;
    }
    this.save(
      this.documents.updateComment(this.documentUid(), comment.id, value),
      'edit',
      parent !== null,
      (updated) => {
        const merged: NuxeoComment = { ...comment, ...updated, parentId: comment.parentId };
        if (parent) {
          this.replies.update((map) => ({
            ...map,
            [parent.id]: (map[parent.id] ?? []).map((r) => (r.id === comment.id ? merged : r)),
          }));
        } else {
          this.comments.update((list) => list.map((c) => (c.id === comment.id ? merged : c)));
        }
        this.cancelEdit();
      },
    );
  }

  private confirmDelete(comment: NuxeoComment, parent: NuxeoComment | null): void {
    const data: NxsDeleteDialogData = {
      reply: parent !== null,
      replies: parent ? 0 : this.repliesOf(comment.id).length,
    };
    this.dialog
      .open(this.deleteDialog(), { data, role: 'alertdialog', width: '400px', maxWidth: '95vw' })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed === true) this.remove(comment, parent);
      });
  }

  private remove(comment: NuxeoComment, parent: NuxeoComment | null): void {
    this.save(
      this.documents.deleteComment(this.documentUid(), comment.id),
      'delete',
      parent !== null,
      () => {
        if (parent) {
          this.replies.update((map) => ({
            ...map,
            [parent.id]: (map[parent.id] ?? []).filter((r) => r.id !== comment.id),
          }));
        } else {
          this.comments.update((list) => list.filter((c) => c.id !== comment.id));
          this.replies.update((map) => {
            const { [comment.id]: _removed, ...rest } = map;
            return rest;
          });
        }
        // The comment's menu button went with it; the list keeps the focus inside the panel.
        this.focus(`${this.id}-list`);
      },
    );
  }

  private save<T>(
    request: Observable<T>,
    action: NxsCommentAction,
    reply: boolean,
    done: (result: T) => void,
  ): void {
    this.saving.set(true);
    request
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          done(result);
          this.changed();
        },
        error: (failure: unknown) => this.failedTo(action, reply, failure),
      });
  }

  /**
   * A refusal reads as one, and a comment someone else removed reloads the thread — Web UI says
   * "may not be available anymore" and leaves the stale entry on screen.
   */
  private failedTo(action: NxsCommentAction, reply: boolean, failure: unknown): void {
    const status = failure instanceof HttpErrorResponse ? failure.status : 0;
    const noun = reply ? 'reply' : 'comment';
    if (status === 403 || status === 401) {
      this.toast.error(
        this.translate.instant(`satori-components.comments.error.forbidden-${action}`),
      );
    } else if (status === 404 && (action !== 'add' || reply)) {
      // A 404 on a new top-level comment is the document itself, which this thread cannot fix;
      // on a new reply it is the comment replied to.
      const gone = action === 'add' ? 'comment' : noun;
      this.toast.error(
        this.translate.instant(`satori-components.comments.error.not-found-${gone}`),
      );
      this.reload();
    } else {
      this.toast.error(
        this.translate.instant(`satori-components.comments.error.${action}-${noun}`),
      );
    }
  }

  private fetch(uid: string): Observable<NxsThread | null> {
    this.loading.set(true);
    this.failed.set(false);
    return this.documents.getAllComments(uid).pipe(
      map((list) => toThread(list, uid)),
      catchError(() => of(null)),
    );
  }

  private reset(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.comments.set([]);
    this.replies.set({});
    this.allShown.set(false);
    this.opened.set(new Set());
    this.allRepliesShown.set(new Set());
    this.fullText.set(new Set());
    this.cancelEdit();
    this.newText.set('');
    this.replyTexts.set({});
  }

  private changed(): void {
    this.threadChange.emit([...this.comments(), ...Object.values(this.replies()).flat()]);
  }

  private focus(elementId: string): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`[id="${elementId}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}
