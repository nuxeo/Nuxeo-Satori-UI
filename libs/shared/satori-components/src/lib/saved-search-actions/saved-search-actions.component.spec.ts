import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsSavedSearchActionsComponent } from './saved-search-actions.component';

@Component({
  standalone: true,
  imports: [NxsSavedSearchActionsComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-saved-search-actions
    [savedSearchId]="savedSearchId()"
    [dirty]="dirty()"
    [hasFilters]="hasFilters()"
    (saveAs)="events.push('saveAs')"
    (save)="events.push('save')"
    (rename)="events.push('rename')"
    (share)="events.push('share')"
    (remove)="events.push('remove')"
  />`,
})
class HostComponent {
  readonly savedSearchId = signal('');
  readonly dirty = signal(false);
  readonly hasFilters = signal(false);
  readonly events: string[] = [];
}

const withPermissions = (permissions: unknown): Observable<NuxeoDocument> =>
  of({ contextParameters: { permissions } } as unknown as NuxeoDocument);

describe('NxsSavedSearchActionsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let getDocumentPermissions: ReturnType<typeof vi.fn>;

  const buttons = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent?.trim(),
    );

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function show(state: { id?: string; dirty?: boolean; hasFilters?: boolean }) {
    host.savedSearchId.set(state.id ?? '');
    host.dirty.set(state.dirty ?? false);
    host.hasFilters.set(state.hasFilters ?? false);
    await render();
  }

  beforeEach(async () => {
    getDocumentPermissions = vi.fn(() => withPermissions(['Read', 'WriteProperties']));
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DocumentDetailService, useValue: { getDocumentPermissions } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  describe('what it offers — Web UI’s rules', () => {
    it('offers nothing with no filter and no saved search, and reads no permission', () => {
      expect(buttons()).toEqual([]);
      expect(getDocumentPermissions).not.toHaveBeenCalled();
    });

    it('offers Save as for filters not saved yet', async () => {
      await show({ hasFilters: true, dirty: true });
      expect(buttons()).toEqual(['Save As']);
    });

    it('offers Save as, Save and the menu on a changed saved search the user may change', async () => {
      await show({ id: 'ss-1', dirty: true });
      expect(getDocumentPermissions).toHaveBeenCalledWith('ss-1');
      expect(buttons()).toEqual(['Save As', 'Save', 'Saved search actions']);
    });

    it('offers no Save on an unchanged saved search', async () => {
      await show({ id: 'ss-1', dirty: false });
      expect(buttons()).toEqual(['Save As', 'Saved search actions']);
    });

    it('offers only Save as on a search shared read-only', async () => {
      getDocumentPermissions.mockReturnValue(withPermissions(['Read', 'ReadProperties']));
      await show({ id: 'ss-2', dirty: true });
      expect(buttons()).toEqual(['Save As']);
    });

    it('offers only Save as when the permissions cannot be read', async () => {
      getDocumentPermissions.mockReturnValue(throwError(() => ({ status: 403 })));
      await show({ id: 'ss-2', dirty: true });
      expect(buttons()).toEqual(['Save As']);
    });

    it('offers only Save as when the answer carries no permission list', async () => {
      getDocumentPermissions.mockReturnValue(of({} as NuxeoDocument));
      await show({ id: 'ss-2', dirty: true });
      expect(buttons()).toEqual(['Save As']);
    });

    it('holds the changes back while the permissions are read, and for the next search too', async () => {
      const first = new Subject<NuxeoDocument>();
      getDocumentPermissions.mockReturnValueOnce(first.asObservable());
      await show({ id: 'ss-1', dirty: true });
      expect(buttons()).toEqual(['Save As']);

      first.next({
        contextParameters: { permissions: ['WriteProperties'] },
      } as unknown as NuxeoDocument);
      await render();
      expect(buttons()).toEqual(['Save As', 'Save', 'Saved search actions']);

      // Another search opens: its answer is not in yet, so the first one's does not carry over.
      const second = new Subject<NuxeoDocument>();
      getDocumentPermissions.mockReturnValueOnce(second.asObservable());
      await show({ id: 'ss-2', dirty: true });
      expect(buttons()).toEqual(['Save As']);
    });

    it('treats a blank id as no saved search', async () => {
      await show({ id: '   ', hasFilters: false });
      expect(buttons()).toEqual([]);
      expect(getDocumentPermissions).not.toHaveBeenCalled();
    });
  });

  describe('what it emits', () => {
    it('emits saveAs and save from the buttons', async () => {
      await show({ id: 'ss-1', dirty: true });
      const [saveAs, save] = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
      saveAs.click();
      save.click();
      expect(host.events).toEqual(['saveAs', 'save']);
    });

    it('emits rename, share and remove from the menu', async () => {
      await show({ id: 'ss-1' });
      const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        'button[aria-label="Saved search actions"]',
      );
      for (const expected of ['Rename', 'Share', 'Delete']) {
        trigger?.click();
        await render();
        const item = [...document.querySelectorAll<HTMLButtonElement>('[mat-menu-item]')].find(
          (node) => node.textContent?.includes(expected),
        );
        expect(item, `the menu offers ${expected}`).toBeDefined();
        item?.click();
        await render();
      }
      expect(host.events).toEqual(['rename', 'share', 'remove']);
    });
  });
});
