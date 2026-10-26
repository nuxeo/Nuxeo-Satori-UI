import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Directionality } from '@angular/cdk/bidi';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  BrowseService,
  cumulativeNuxeoPathPrefixes,
  isBrowsableNavNode,
  isRepositoryRootPath,
  normalizeNuxeoPath,
  nuxeoPathsEqualFlexible,
  nuxeoPathSegments,
  topLevelNuxeoFolderPath,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { NxsErrorStateComponent } from '../error-state/error-state.component';
import { nxsErrorStatus, type NxsErrorStatus } from '../error-state/error-status';
import { NxsSpinnerComponent } from '../spinner/spinner.component';

/** A folder in the tree. Mutable: the tree redraws on `revision`, not on a new object. */
interface TreeNode {
  readonly key: string;
  readonly doc: NuxeoDocument;
  readonly root: boolean;
  readonly parent: TreeNode | null;
  children: TreeNode[];
  loaded: boolean;
  loading: boolean;
  expanded: boolean;
  /** False once Nuxeo says the folder holds no folder; true until then, so a branch is never hidden. */
  expandable: boolean;
  /** Why its folders could not be loaded, shown as a row under it until a retry succeeds. */
  error: NxsErrorStatus | null;
}

/** One row of the tree as drawn, in reading order. */
interface TreeRow {
  readonly kind: 'node' | 'error';
  readonly key: string;
  readonly node: TreeNode;
  readonly level: number;
  readonly setSize: number;
  readonly position: number;
}

/**
 * The folder tree of the repository, as the browse drawer shows it: domains at the root, the open
 * domain's branch inside one, expanded down to the folder on screen, which is marked as the
 * current page.
 *
 * It reads the repository itself through `BrowseService`, with the application's credentials:
 * a level's folders through `getNavTreeChildren` (the `tree_children` page provider Nuxeo Web UI's
 * tree uses), and in one query per level which of them hold a folder, so a leaf has no expand
 * arrow, as in Web UI. Choosing a folder emits it; the host navigates.
 *
 * A failure is never silent: the tree's own failure is an error state chosen by status, and a
 * folder whose children fail gets a row saying so, which retries, and an announcement.
 *
 * Keyboard, as the ARIA tree pattern: one row in the Tab sequence, Up and Down between rows, Right
 * to expand or step into, Left to collapse or step out, Home and End, Enter to open a folder and
 * Space to expand or collapse it.
 */
@Component({
  selector: 'nxs-document-tree',
  standalone: true,
  templateUrl: './document-tree.component.html',
  styleUrl: './document-tree.component.scss',
  imports: [
    MatIconModule,
    NgTemplateOutlet,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-document-tree' },
})
export class NxsDocumentTreeComponent {
  /** The Nuxeo path of the folder on screen: the tree expands down to it and marks it. */
  readonly currentPath = input('/');
  /** The tree's accessible name, already translated, such as "Folders". */
  readonly label = input.required<string>();

  /** A folder was chosen. The repository root arrives as a document whose path is `/`. */
  readonly navigate = output<NuxeoDocument>();

  private readonly browse = inject(BrowseService);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly direction = inject(Directionality, { optional: true });

  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadError = signal<NxsErrorStatus>(500);
  /** The row in the Tab sequence, by key; the current folder's until the user moves. */
  protected readonly focusKey = signal<string | null>(null);
  private readonly revision = signal(0);
  private root: TreeNode | null = null;
  private loadGeneration = 0;
  private syncGeneration = 0;

  /** At the repository root, the root with its domains; inside a domain, that domain's branch. */
  protected readonly topNodes = computed<readonly TreeNode[]>(() => {
    this.revision();
    const root = this.root;
    if (!root) return [];
    const path = normalizeNuxeoPath(this.currentPath());
    if (isRepositoryRootPath(path)) return [root];
    const domainPath = topLevelNuxeoFolderPath(path);
    const domain = domainPath ? nodeAt(root.children, domainPath) : undefined;
    return domain ? [domain] : [root];
  });

  protected readonly showRootBack = computed(
    () => this.status() === 'ready' && this.topNodes()[0]?.root === false,
  );

  /** Every visible row, in reading order, which is what the arrow keys walk. */
  protected readonly rows = computed<readonly TreeRow[]>(() => {
    const rows: TreeRow[] = [];
    const walk = (nodes: readonly TreeNode[], level: number) => {
      nodes.forEach((node, index) => {
        rows.push({
          kind: 'node',
          key: node.key,
          node,
          level,
          setSize: nodes.length,
          position: index + 1,
        });
        if (!node.expanded) return;
        if (node.error) {
          rows.push({
            kind: 'error',
            key: `${node.key}#error`,
            node,
            level: level + 1,
            setSize: 1,
            position: 1,
          });
        } else {
          walk(node.children, level + 1);
        }
      });
    };
    walk(this.topNodes(), 1);
    return rows;
  });

  /** The deepest visible folder on the current path: the folder itself, or its nearest shown ancestor. */
  protected readonly currentKey = computed<string | null>(() => {
    this.revision();
    const path = normalizeNuxeoPath(this.currentPath());
    const target = nuxeoPathSegments(path);
    let best: TreeNode | null = null;
    // Deeper wins; at the same depth a folder whose path matches exactly wins over one that
    // matches only ignoring case and spacing, so of `Folder` and `folder` the right one is marked.
    let bestRank = -1;
    for (const row of this.rows()) {
      if (row.kind !== 'node') continue;
      const node = row.node;
      if (node.root) {
        if (bestRank < 0) {
          best = node;
          bestRank = 0;
        }
        continue;
      }
      const own = normalizeNuxeoPath(node.doc.path ?? '');
      const segments = nuxeoPathSegments(own);
      const onPath =
        segments.length <= target.length && segments.every((segment, i) => segment === target[i]);
      if (!onPath) continue;
      const exact = path === own || path.startsWith(`${own}/`);
      const rank = segments.length * 2 + (exact ? 1 : 0);
      if (rank > bestRank) {
        best = node;
        bestRank = rank;
      }
    }
    return best?.key ?? null;
  });

  private readonly rowsByKey = computed(() => new Map(this.rows().map((row) => [row.key, row])));

  protected rowFor(key: string): TreeRow | undefined {
    return this.rowsByKey().get(key);
  }

  protected readonly tabStop = computed(() => {
    const keys = new Set(this.rows().map((row) => row.key));
    const focus = this.focusKey();
    if (focus && keys.has(focus)) return focus;
    return this.currentKey() ?? this.rows()[0]?.key ?? null;
  });

  constructor() {
    this.load();
    effect(() => {
      const path = this.currentPath();
      untracked(() => this.syncTo(path));
    });
  }

  /** Reads the tree again from the repository, as after a folder is created, moved or deleted. */
  reload(): void {
    this.root = null;
    this.focusKey.set(null);
    this.bump();
    this.load();
  }

  protected nodeLabel(node: TreeNode): string {
    return node.root
      ? this.translate.instant('satori-components.document-tree.root')
      : node.doc.title;
  }

  /** A click on a row's arrow expands or collapses it; anywhere else on the row opens it. */
  protected onItemClick(event: MouseEvent, row: TreeRow): void {
    event.stopPropagation();
    this.focusKey.set(row.key);
    if (row.kind === 'error') {
      this.retry(row.node);
      return;
    }
    const onArrow = (event.target as Element | null)?.closest('.nxs-document-tree__arrow');
    if (onArrow) this.toggle(row.node);
    else this.open(row.node);
  }

  protected onKeydown(event: KeyboardEvent, row: TreeRow): void {
    if (event.target !== event.currentTarget) return;
    const rows = this.rows();
    const at = rows.findIndex((candidate) => candidate.key === row.key);
    const rtl = this.direction?.value === 'rtl';
    const inward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const outward = rtl ? 'ArrowRight' : 'ArrowLeft';
    const node = row.node;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focus(rows[Math.min(at + 1, rows.length - 1)]);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.focus(rows[Math.max(at - 1, 0)]);
        return;
      case 'Home':
        event.preventDefault();
        this.focus(rows[0]);
        return;
      case 'End':
        event.preventDefault();
        this.focus(rows[rows.length - 1]);
        return;
      case 'Enter':
        event.preventDefault();
        if (row.kind === 'error') this.retry(node);
        else this.open(node);
        return;
      case ' ':
        event.preventDefault();
        if (row.kind === 'error') this.retry(node);
        else this.toggle(node);
        return;
    }
    if (event.key === inward) {
      event.preventDefault();
      if (row.kind === 'error') return;
      if (!node.expanded && node.expandable) this.toggle(node);
      else if (node.expanded) this.focus(rows[at + 1]?.level > row.level ? rows[at + 1] : row);
    } else if (event.key === outward) {
      event.preventDefault();
      if (row.kind === 'node' && node.expanded) {
        node.expanded = false;
        this.bump();
        return;
      }
      const parentKey = row.kind === 'error' ? node.key : node.parent?.key;
      const parent = rows.find((candidate) => candidate.key === parentKey);
      if (parent) this.focus(parent);
    }
  }

  private focus(row: TreeRow | undefined): void {
    if (!row) return;
    this.focusKey.set(row.key);
    queueMicrotask(() =>
      [...this.host.nativeElement.querySelectorAll<HTMLElement>('[data-row-key]')]
        .find((element) => element.dataset['rowKey'] === row.key)
        ?.focus(),
    );
  }

  protected openRoot(): void {
    if (this.root) this.open(this.root);
  }

  private open(node: TreeNode): void {
    if (node.root) {
      // Web UI's shortcut: a repository with one domain opens that domain, not an empty root.
      const only = node.children.length === 1 ? node.children[0] : null;
      this.navigate.emit(only ? only.doc : { ...node.doc, path: '/' });
      return;
    }
    this.navigate.emit(node.doc);
  }

  private toggle(node: TreeNode): void {
    if (node.loading) return;
    if (node.expanded) {
      node.expanded = false;
      this.bump();
      return;
    }
    if (node.loaded && !node.error) {
      node.expanded = node.children.length > 0;
      this.bump();
      return;
    }
    this.loadChildren(node)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        node.expanded = node.error !== null || node.children.length > 0;
        this.bump();
      });
  }

  private retry(node: TreeNode): void {
    node.error = null;
    node.loaded = false;
    node.expanded = false;
    this.focusKey.set(node.key);
    this.toggle(node);
  }

  private load(): void {
    const generation = ++this.loadGeneration;
    this.status.set('loading');
    this.browse
      .getNavTreeBootstrap()
      .pipe(
        switchMap(({ root, entries }) => {
          const node = this.node(root, null, true);
          node.children = this.toNodes(entries, node);
          node.loaded = true;
          node.expanded = true;
          return this.probe(node.children).pipe(map(() => node));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (root) => {
          if (generation !== this.loadGeneration) return;
          this.root = root;
          this.status.set('ready');
          this.bump();
          this.syncTo(this.currentPath());
        },
        error: (error: unknown) => {
          if (generation !== this.loadGeneration) return;
          const status = nxsErrorStatus(error);
          this.loadError.set(status);
          this.status.set('error');
          this.announce(status, null);
        },
      });
  }

  /** Expands every folder on `path`, loading the ones not loaded yet, and folds the rest away. */
  private syncTo(path: string): void {
    const root = this.root;
    if (!root) return;
    const generation = ++this.syncGeneration;
    const prefixes = cumulativeNuxeoPathPrefixes(normalizeNuxeoPath(path));
    root.expanded = true;
    const step = (nodes: readonly TreeNode[], index: number): void => {
      if (generation !== this.syncGeneration) return;
      const next = index < prefixes.length ? nodeAt(nodes, prefixes[index]) : undefined;
      for (const node of nodes) {
        if (node !== next) collapse(node);
      }
      if (!next) {
        this.bump();
        return;
      }
      if (next.loaded) {
        next.expanded = next.error !== null || next.children.length > 0;
        step(next.children, index + 1);
        return;
      }
      next.loading = true;
      this.bump();
      this.loadChildren(next)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (generation !== this.syncGeneration) return;
          next.expanded = next.error !== null || next.children.length > 0;
          step(next.children, index + 1);
        });
    };
    step(root.children, 0);
  }

  /** Loads a folder's folders and which of them hold one; a failure is recorded, not thrown. */
  private loadChildren(node: TreeNode): Observable<void> {
    node.loading = true;
    node.error = null;
    this.bump();
    return this.browse.getNavTreeChildren(node.doc).pipe(
      switchMap((list) => {
        const children = this.toNodes(list.entries ?? [], node);
        return this.probe(children).pipe(map(() => children));
      }),
      map((children) => {
        node.children = children;
        node.loaded = true;
        node.loading = false;
        node.expandable = children.length > 0;
      }),
      catchError((error: unknown) => {
        const status = nxsErrorStatus(error);
        node.loading = false;
        node.loaded = false;
        node.error = status;
        this.announce(status, node);
        return of(undefined);
      }),
    );
  }

  /** One query for a whole level: which of these folders hold a folder. Unknown keeps the arrow. */
  private probe(nodes: readonly TreeNode[]): Observable<void> {
    if (nodes.length === 0) return of(undefined);
    return this.browse.getFolderIdsWithSubfolders(nodes.map((node) => node.doc.uid)).pipe(
      map((withFolders) => {
        if (!withFolders) return;
        for (const node of nodes) node.expandable = withFolders.has(node.doc.uid);
      }),
      catchError(() => of(undefined)),
    );
  }

  private toNodes(entries: readonly NuxeoDocument[], parent: TreeNode): TreeNode[] {
    return entries
      .filter((doc) => isBrowsableNavNode(doc))
      .map((doc) => this.node(doc, parent, false));
  }

  private node(doc: NuxeoDocument, parent: TreeNode | null, root: boolean): TreeNode {
    return {
      key: root ? 'root' : doc.uid,
      doc,
      root,
      parent,
      children: [],
      loaded: false,
      loading: false,
      expanded: false,
      expandable: true,
      error: null,
    };
  }

  private announce(status: NxsErrorStatus, node: TreeNode | null): void {
    const name = node ? this.nodeLabel(node) : '';
    const key = node
      ? status === 403
        ? 'satori-components.document-tree.children-forbidden'
        : 'satori-components.document-tree.children-failed'
      : 'satori-components.document-tree.load-failed';
    void this.announcer.announce(this.translate.instant(key, { name }), 'assertive');
  }

  private bump(): void {
    this.revision.update((value) => value + 1);
  }
}

function collapse(node: TreeNode): void {
  node.expanded = false;
  for (const child of node.children) collapse(child);
}

/**
 * The folder at `path` among siblings: the one whose path is exactly `path`, else one that differs
 * only in case or spacing, since the path in the address may not match Nuxeo's casing.
 */
function nodeAt(nodes: readonly TreeNode[], path: string): TreeNode | undefined {
  const exact = normalizeNuxeoPath(path);
  return (
    nodes.find((node) => normalizeNuxeoPath(node.doc.path ?? '') === exact) ??
    nodes.find((node) => nuxeoPathsEqualFlexible(node.doc.path ?? '', path))
  );
}
