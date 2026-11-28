import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { DocumentDetailService } from './document-detail.service';
import type { NuxeoDocument } from '../models/document.model';

type SelectionPreview = string | null;

@Injectable({ providedIn: 'root' })
export class SelectionService {
  private readonly documentDetailService = inject(DocumentDetailService);
  private readonly selectionCleared = new Subject<void>();
  /** Cancels pending selection work synchronously from every shared Clear entry point. */
  readonly cleared$ = this.selectionCleared.asObservable();

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly selectedLabels = signal<Map<string, string>>(new Map());
  readonly selectedPreviews = signal<Map<string, SelectionPreview>>(new Map());
  readonly selectedTypes = signal<Map<string, string>>(new Map());
  /** When true, the app shell topbar shows only count + Clear (e.g. note image picker). */
  readonly clearOnlyMode = signal(false);

  readonly selectedCount = () => this.selectedIds().size;
  readonly selectedItems = () =>
    [...this.selectedIds()].map((id) => ({
      id,
      name: this.selectedLabels().get(id) ?? id,
      preview: this.selectedPreviews().get(id) ?? null,
      type: this.selectedTypes().get(id),
    }));

  toggle(id: string, label?: string, preview?: SelectionPreview, type?: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

    this.selectedLabels.update((current) => {
      const next = new Map(current);
      if (this.selectedIds().has(id)) {
        next.set(id, label?.trim() || next.get(id) || id);
      } else {
        next.delete(id);
      }
      return next;
    });

    this.selectedPreviews.update((current) => {
      const next = new Map(current);
      if (this.selectedIds().has(id)) {
        next.set(id, preview ?? next.get(id) ?? null);
      } else {
        next.delete(id);
      }
      return next;
    });

    this.selectedTypes.update((current) => {
      const next = new Map(current);
      if (this.selectedIds().has(id)) {
        if (type) next.set(id, type);
        else next.delete(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  selectAll(
    ids: string[],
    labels?: Record<string, string>,
    previews?: Record<string, SelectionPreview>,
    types?: Record<string, string>,
  ): void {
    this.selectedIds.set(new Set(ids));
    this.selectedLabels.update((current) => {
      const next = new Map<string, string>();
      ids.forEach((id) => {
        next.set(id, labels?.[id]?.trim() || current.get(id) || id);
      });
      return next;
    });

    this.selectedPreviews.update((current) => {
      const next = new Map<string, SelectionPreview>();
      ids.forEach((id) => {
        next.set(id, previews?.[id] ?? current.get(id) ?? null);
      });
      return next;
    });

    this.selectedTypes.update((current) => {
      const next = new Map<string, string>();
      ids.forEach((id) => {
        const docType = types?.[id] ?? current.get(id);
        if (docType) next.set(id, docType);
      });
      return next;
    });
  }

  /**
   * Forgets the retained preview URLs, keeping the selection itself intact.
   *
   * Callers hand `toggle`/`selectAll` an object URL they own, and this service keeps the string —
   * so when the owner revokes that URL, this copy becomes a dangling reference and the selection
   * topbar renders `<img [src]>` against a revoked `blob:`, i.e. a broken image beside a still-selected
   * item. Selection is global and survives a new search, so the two lifetimes genuinely differ.
   *
   * Fixing the object-URL leak is what exposed this: before, nothing was ever revoked, so the stale
   * copy stayed loadable by accident. Owners now call this immediately before revoking a batch, which
   * degrades the popup to its placeholder rather than showing a broken image.
   *
   * This is the conservative half of the fix. The complete one is for this service to own preview
   * lifetime — hold the blobs, or refetch on demand — so a selection keeps its thumbnails across a
   * search. That is a design change to a shared service and is deliberately not bundled here.
   */
  forgetPreviews(): void {
    this.selectedPreviews.update((current) => {
      const next = new Map<string, SelectionPreview>();
      for (const id of current.keys()) next.set(id, null);
      return next;
    });
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  isAllSelected(ids: string[]): boolean {
    return ids.length > 0 && ids.every((id) => this.selectedIds().has(id));
  }

  isIndeterminate(ids: string[]): boolean {
    return ids.some((id) => this.selectedIds().has(id)) && !this.isAllSelected(ids);
  }

  clear(): void {
    this.selectionCleared.next();
    this.selectedIds.set(new Set());
    this.selectedLabels.set(new Map());
    this.selectedPreviews.set(new Map());
    this.selectedTypes.set(new Map());
  }

  /** Clears selection and exits clear-only topbar mode (logout, session reset). */
  resetUiState(): void {
    this.clear();
    this.clearOnlyMode.set(false);
  }

  setClearOnlyMode(enabled: boolean): void {
    this.clearOnlyMode.set(enabled);
  }

  deleteSelected(): Observable<NuxeoDocument[]> {
    const ids = [...this.selectedIds()];
    return this.documentDetailService.trashDocuments(ids).pipe(finalize(() => this.clear()));
  }
}
