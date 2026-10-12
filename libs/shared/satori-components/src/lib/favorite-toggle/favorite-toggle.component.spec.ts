import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsFavoriteToggleComponent } from './favorite-toggle.component';
import { NXS_FAVORITES_CHANGED_EVENT, nxsToggleFavorite } from './toggle-favorite';

/** Hosted, so the two-way `favorite` binding and the click's propagation are both observable. */
@Component({
  standalone: true,
  imports: [NxsFavoriteToggleComponent],
  template: `
    <div class="probe-row">
      <nxs-favorite-toggle
        [documentId]="documentId()"
        [(favorite)]="favorite"
        [disabled]="disabled()"
        (changed)="changes.push($event)"
        (failed)="failures.push($event)"
      />
    </div>
  `,
})
class HostComponent {
  readonly documentId = signal('doc-1');
  readonly favorite = signal(false);
  readonly disabled = signal(false);
  readonly changes: boolean[] = [];
  readonly failures: unknown[] = [];
}

describe('NxsFavoriteToggleComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let addToFavorites: ReturnType<typeof vi.fn>;
  let removeFromFavorites: ReturnType<typeof vi.fn>;
  let windowEvents: number;
  const countEvent = () => (windowEvents += 1);

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function button(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  }

  function icon(): string {
    return button().querySelector('mat-icon')?.textContent?.trim() ?? '';
  }

  beforeEach(async () => {
    addToFavorites = vi.fn((): Observable<NuxeoDocument> => of({} as NuxeoDocument));
    removeFromFavorites = vi.fn((): Observable<NuxeoDocument> => of({} as NuxeoDocument));
    windowEvents = 0;
    window.addEventListener(NXS_FAVORITES_CHANGED_EVENT, countEvent);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DocumentDetailService, useValue: { addToFavorites, removeFromFavorites } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => {
    window.removeEventListener(NXS_FAVORITES_CHANGED_EVENT, countEvent);
  });

  it('is a toggle button with a constant name and its state in aria-pressed', async () => {
    expect(button().getAttribute('type')).toBe('button');
    expect(button().getAttribute('aria-label')).toBe('Favorite');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(icon()).toBe('star_border');
    expect(button().querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');

    host.favorite.set(true);
    await render();

    expect(button().getAttribute('aria-label')).toBe('Favorite');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(icon()).toBe('star');
    expect(button().classList.contains('nxs-favorite-toggle__button--on')).toBe(true);
  });

  it('adds a document that is not a favorite, then reports and binds the new state', async () => {
    button().click();
    await render();

    expect(addToFavorites).toHaveBeenCalledWith('doc-1');
    expect(removeFromFavorites).not.toHaveBeenCalled();
    expect(host.favorite()).toBe(true);
    expect(host.changes).toEqual([true]);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(windowEvents).toBe(1);
  });

  it('removes a document that is a favorite', async () => {
    host.favorite.set(true);
    await render();

    button().click();
    await render();

    expect(removeFromFavorites).toHaveBeenCalledWith('doc-1');
    expect(addToFavorites).not.toHaveBeenCalled();
    expect(host.favorite()).toBe(false);
    expect(host.changes).toEqual([false]);
  });

  it('keeps the state and reports the error when the server refuses', async () => {
    const error = { status: 403 };
    addToFavorites.mockReturnValue(throwError(() => error));

    button().click();
    await render();

    expect(host.favorite()).toBe(false);
    expect(host.changes).toEqual([]);
    expect(host.failures).toEqual([error]);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().hasAttribute('aria-busy')).toBe(false);
    expect(windowEvents).toBe(0);
  });

  it('ignores presses while a request is in flight, and stays focusable', async () => {
    const pending = new Subject<NuxeoDocument>();
    addToFavorites.mockReturnValue(pending.asObservable());

    button().click();
    await render();
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().disabled).toBe(false);

    button().click();
    expect(addToFavorites).toHaveBeenCalledTimes(1);

    pending.next({} as NuxeoDocument);
    pending.complete();
    await render();
    expect(button().hasAttribute('aria-busy')).toBe(false);
    expect(host.favorite()).toBe(true);
  });

  it('ignores the answer for a document it is no longer bound to, and frees the new one', async () => {
    const pending = new Subject<NuxeoDocument>();
    addToFavorites.mockReturnValueOnce(pending.asObservable());
    button().click();
    await render();

    host.documentId.set('doc-2');
    await render();
    expect(button().hasAttribute('aria-busy')).toBe(false);
    button().click();
    await render();
    expect(addToFavorites).toHaveBeenLastCalledWith('doc-2');
    expect(host.changes).toEqual([true]);

    pending.next({} as NuxeoDocument);
    pending.complete();
    await render();

    expect(host.changes).toEqual([true]);
    expect(host.favorite()).toBe(true);
    // The server still confirmed doc-1, so the shell hears of both.
    expect(windowEvents).toBe(2);
  });

  it('reports a failure only for the document it is bound to', async () => {
    const pending = new Subject<NuxeoDocument>();
    addToFavorites.mockReturnValueOnce(pending.asObservable());
    button().click();
    await render();
    host.documentId.set('doc-2');
    await render();

    pending.error({ status: 500 });
    await render();

    expect(host.failures).toEqual([]);
    expect(host.favorite()).toBe(false);
  });

  it('does nothing while disabled', async () => {
    host.disabled.set(true);
    await render();

    expect(button().disabled).toBe(true);
    fixture.debugElement
      .query((el) => el.name === 'nxs-favorite-toggle')
      .componentInstance.toggle();

    expect(addToFavorites).not.toHaveBeenCalled();
  });

  it('does nothing without a document', async () => {
    host.documentId.set('');
    await render();

    button().click();

    expect(addToFavorites).not.toHaveBeenCalled();
    expect(removeFromFavorites).not.toHaveBeenCalled();
  });

  it('does not let a press reach the row it sits in', async () => {
    const rowClick = vi.fn();
    fixture.nativeElement.querySelector('.probe-row').addEventListener('click', rowClick);

    button().click();
    await render();

    expect(rowClick).not.toHaveBeenCalled();
    expect(addToFavorites).toHaveBeenCalledTimes(1);
  });

  it('offers what a press will do as its tooltip', async () => {
    const toggle = fixture.debugElement.query((el) => el.name === 'button');
    const tooltip = toggle.injector.get(MatTooltip);
    expect(tooltip.message).toBe('Add to favorites');

    host.favorite.set(true);
    await render();
    expect(tooltip.message).toBe('Remove from favorites');
  });
});

describe('nxsToggleFavorite', () => {
  const documents = {
    addToFavorites: vi.fn(() => of({} as NuxeoDocument)),
    removeFromFavorites: vi.fn(() => of({} as NuxeoDocument)),
  };

  it('adds when the document is not a favorite and emits true', () => {
    const states: boolean[] = [];
    nxsToggleFavorite(documents, 'doc-1', false).subscribe((state) => states.push(state));

    expect(documents.addToFavorites).toHaveBeenCalledWith('doc-1');
    expect(states).toEqual([true]);
  });

  it('removes when it is and emits false', () => {
    const states: boolean[] = [];
    nxsToggleFavorite(documents, 'doc-1', true).subscribe((state) => states.push(state));

    expect(documents.removeFromFavorites).toHaveBeenCalledWith('doc-1');
    expect(states).toEqual([false]);
  });

  it('tells the shell only when the server confirms', () => {
    let events = 0;
    const listener = () => (events += 1);
    window.addEventListener(NXS_FAVORITES_CHANGED_EVENT, listener);

    nxsToggleFavorite(documents, 'doc-1', false).subscribe();
    expect(events).toBe(1);

    const failing = {
      ...documents,
      addToFavorites: vi.fn(() => throwError(() => new Error('500'))),
    };
    nxsToggleFavorite(failing, 'doc-1', false).subscribe({ error: () => undefined });
    expect(events).toBe(1);

    window.removeEventListener(NXS_FAVORITES_CHANGED_EVENT, listener);
  });
});
