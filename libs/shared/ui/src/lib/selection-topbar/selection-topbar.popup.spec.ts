import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { of, throwError, type Observable } from 'rxjs';

import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import { ExtensionRuleContextService } from '@nuxeo-satori/platform/extensions';
import { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';

import { SelectionTopbarComponent } from './selection-topbar.component';

/**
 * The "Display selection" popup: open/close and its focus contract.
 *
 * Kept in its own file rather than added to `selection-topbar.component.spec.ts`, which is a
 * focused proof about the `bulk-actions` slot and reconfigures TestBed inside its own helper.
 *
 * These tests deliberately render the real template. The popup panel only exists inside
 * `@if (selectionPopupOpen())`, and the whole behaviour under test is that focus moves *to* that
 * panel and back again — an overridden `<div></div>` template would leave `selectionPopupPanel`
 * permanently `undefined` and every focus assertion would pass without exercising anything.
 */

type SelectedItem = { id: string; name: string; preview: string | null };

/** Fills every field of the input's element type; no cast, so a shape change breaks this. */
function item(overrides: Partial<SelectedItem> = {}): SelectedItem {
  return { id: 'doc-1', name: 'Report.pdf', preview: null, ...overrides };
}

/** `queueMicrotask` is what the component defers focus with, so a microtask flush is enough. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SelectionTopbarComponent — selection popup', () => {
  let fixture: ComponentFixture<SelectionTopbarComponent>;
  let component: SelectionTopbarComponent;

  // No `extensions` registered on purpose: `bulkActions()` resolves to an empty slot, so the
  // action row renders nothing and cannot interfere with the focus assertions below.
  const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });
  /**
   * The popup's `nxs-thumbnail`s fetch through this. An empty rendition by default, which shows the
   * placeholder and mints nothing; the preview test answers doc-1 with an image.
   */
  const fetchThumbnail = vi.fn((_id: string): Observable<Blob> => of(new Blob([])));

  async function render(items: SelectedItem[] = []): Promise<void> {
    manifest.set({ extensionLayers: [] });
    await TestBed.configureTestingModule({
      imports: [SelectionTopbarComponent, NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AppConfigService, useValue: { manifest } },
        { provide: DocumentDetailService, useValue: { fetchThumbnail } },
      ],
    }).compileComponents();

    TestBed.inject(ExtensionRuleContextService).selectionCount.set(items.length);

    fixture = TestBed.createComponent(SelectionTopbarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('selectedCount', items.length);
    fixture.componentRef.setInput('selectedItems', items);

    // Attached to the document because `document.activeElement` and `HTMLElement.focus()` only
    // behave in jsdom for elements that are actually in the document.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query<T extends HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  afterEach(() => {
    fixture?.nativeElement?.remove();
  });

  it('is closed initially, with no popup in the DOM', async () => {
    await render([item()]);

    expect(component.selectionPopupOpen()).toBe(false);
    expect(query('.selection-popup')).toBeNull();
    expect(query('.selection-popup-backdrop')).toBeNull();
  });

  it('opens from the "Display selection" button as a labelled modal dialog', async () => {
    await render([item(), item({ id: 'doc-2', name: 'Notes.txt' })]);

    const trigger = query<HTMLButtonElement>('.topbar-left .clear-btn');
    expect(trigger?.textContent?.trim()).toBe('Display selection');

    trigger?.click();
    fixture.detectChanges();
    await flushMicrotasks();

    expect(component.selectionPopupOpen()).toBe(true);
    const panel = query<HTMLElement>('.selection-popup');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    expect(panel?.getAttribute('tabindex')).toBe('-1');
    // Named by its own heading, so the dialog announces as "Selected Items" rather than unnamed.
    expect(panel?.getAttribute('aria-labelledby')).toBe('selection-popup-title');
    expect(fixture.nativeElement.querySelector('#selection-popup-title')?.textContent?.trim()).toBe(
      'Selected Items',
    );
  });

  /**
   * DEFECT — `openSelectionPopup()` (selection-topbar.component.ts:73-79) never actually moves
   * focus when the popup is opened the way a user opens it.
   *
   * `selectionPopupOpen.set(true)` then `queueMicrotask(() => panel.focus())`, but the panel only
   * exists after change detection has rendered the `@if`, and change detection does not run
   * inside the click's own microtask checkpoint. Probed directly: the deferred callback runs
   * while `selectionPopupPanel` is still `undefined`, the optional chain swallows it, and focus
   * stays on the trigger. Under the app's zone.js setup (apps/nuxeo-ui/src/main.ts) the ordering
   * is the same — Zone drains its microtask queue at the end of the click task, before
   * `onMicrotaskEmpty` triggers `tick()`.
   *
   * So a keyboard user activates "Display selection", an `aria-modal="true"` dialog appears, and
   * their focus is left outside it: WCAG 2.4.3 / 2.1.2. The close path is unaffected, because the
   * element it focuses (`lastFocusedElement`) already exists — see the two tests below.
   *
   * Not fixed here: this task adds tests only, and the fix is a source change (`afterNextRender`,
   * or `viewChild()` with an `effect`). Asserted as the behaviour that actually ships so the fix
   * turns this test red on purpose rather than passing silently either way.
   */
  it('does NOT move focus into the panel when opened by a real click (known defect)', async () => {
    await render([item()]);

    const trigger = query<HTMLButtonElement>('.topbar-left .clear-btn');
    trigger?.focus();
    expect(document.activeElement).toBe(trigger);

    trigger?.click();
    fixture.detectChanges();
    await flushMicrotasks();

    const panel = query<HTMLElement>('.selection-popup');
    expect(panel).not.toBeNull();
    expect(document.activeElement).not.toBe(panel);
    expect(document.activeElement).toBe(trigger);
  });

  it('focuses the panel when it is already rendered at the microtask checkpoint', async () => {
    await render([item()]);

    // Opened, rendered, and only then allowed to reach the deferred callback. This is the path
    // the code was written for; it is reached by a programmatic open, not by a user click.
    component.openSelectionPopup();
    fixture.detectChanges();
    await flushMicrotasks();

    const panel = query<HTMLElement>('.selection-popup');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
  });

  it('renders one row per selected item, drawing each preview itself, by document id', async () => {
    // jsdom implements neither, so they are installed for this test and removed after it.
    const createObjectURL = vi.fn(() => 'blob:popup-1');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    fetchThumbnail.mockImplementation((id: string) =>
      id === 'doc-2' ? throwError(() => new Error('404')) : of(new Blob(['png'])),
    );
    await render([
      // A preview a caller has since revoked: the popup must not bind it.
      item({ id: 'doc-1', name: 'Report.pdf', preview: 'blob:revoked-elsewhere' }),
      item({ id: 'doc-2', name: 'Notes.txt', preview: null }),
    ]);

    component.openSelectionPopup();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await flushMicrotasks();

    const rows = [...fixture.nativeElement.querySelectorAll('.selection-item')] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row) => row.querySelector('.selection-item-name')?.textContent?.trim()),
    ).toEqual(['Report.pdf', 'Notes.txt']);
    expect(fetchThumbnail).toHaveBeenCalledWith('doc-1');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(
      rows[0].querySelector('nxs-thumbnail.selection-item-preview img')?.getAttribute('src'),
    ).toBe('blob:popup-1');
    // The placeholder branch, asserted as a positive: the element is present and is the
    // placeholder, rather than merely "no img".
    expect(rows[1].querySelector('img')).toBeNull();
    expect(rows[1].querySelector('.selection-item-preview--placeholder')).not.toBeNull();
    fixture.destroy();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
    fetchThumbnail.mockImplementation(() => of(new Blob([])));
  });

  it('restores focus to the element that opened it when closed from the close button', async () => {
    await render([item()]);

    const trigger = query<HTMLButtonElement>('.topbar-left .clear-btn');
    trigger?.focus();
    expect(document.activeElement).toBe(trigger);

    trigger?.click();
    fixture.detectChanges();
    await flushMicrotasks();
    expect(component.selectionPopupOpen()).toBe(true);

    query<HTMLButtonElement>('.selection-popup-close')?.click();
    fixture.detectChanges();
    await flushMicrotasks();

    expect(component.selectionPopupOpen()).toBe(false);
    expect(query('.selection-popup')).toBeNull();
    // Returning focus to the trigger is the other half of the WCAG 2.4.3 focus-order contract;
    // without it focus resets to <body> and a keyboard user restarts from the top of the page.
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the backdrop is activated', async () => {
    await render([item()]);

    component.openSelectionPopup();
    fixture.detectChanges();
    await flushMicrotasks();

    const backdrop = query<HTMLButtonElement>('.selection-popup-backdrop');
    expect(backdrop).not.toBeNull();
    // A real <button> with an accessible name, not a bare div, so it is reachable and announced.
    expect(backdrop?.getAttribute('aria-label')).toBe('Close selected items popup');

    backdrop?.click();
    fixture.detectChanges();
    await flushMicrotasks();

    expect(component.selectionPopupOpen()).toBe(false);
  });

  it('closes on Escape while open', async () => {
    await render([item()]);

    const trigger = query<HTMLButtonElement>('.topbar-left .clear-btn');
    trigger?.focus();
    component.openSelectionPopup();
    fixture.detectChanges();
    await flushMicrotasks();

    component.onEscape();
    fixture.detectChanges();
    await flushMicrotasks();

    expect(component.selectionPopupOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does nothing on Escape while closed, and does not steal focus', async () => {
    await render([item()]);

    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    component.onEscape();
    fixture.detectChanges();
    await flushMicrotasks();

    // The guard in `onEscape` matters: without it, an Escape pressed anywhere else on the page
    // would run `closeSelectionPopup()` and yank focus to a stale `lastFocusedElement`.
    expect(component.selectionPopupOpen()).toBe(false);
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('forgets the previously focused element after one close, so a later close cannot move focus', async () => {
    await render([item()]);

    const trigger = query<HTMLButtonElement>('.topbar-left .clear-btn');
    trigger?.focus();
    component.openSelectionPopup();
    fixture.detectChanges();
    await flushMicrotasks();

    component.closeSelectionPopup();
    await flushMicrotasks();
    expect(document.activeElement).toBe(trigger);

    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    // `closeSelectionPopup` nulls `lastFocusedElement` before deferring the focus call. A second
    // close with no intervening open must therefore be inert rather than re-focusing the trigger
    // and dragging the user back to a control they have since navigated away from.
    component.closeSelectionPopup();
    await flushMicrotasks();

    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('opens without throwing when the panel has not been rendered yet', async () => {
    await render([item()]);

    // Same ordering as the defect above, minus the click: `selectionPopupPanel` is `undefined` at
    // the microtask checkpoint. The optional chain has to absorb that — an exception here would
    // surface as an unhandled rejection inside a microtask, which Vitest reports as "this might
    // cause false positive tests" while every assertion still passes.
    component.openSelectionPopup();
    await flushMicrotasks();

    expect(component.selectionPopupOpen()).toBe(true);
  });

  it('emits cleared from the Clear button without opening the popup', async () => {
    await render([item()]);

    const emitted: unknown[] = [];
    component.cleared.subscribe((value) => emitted.push(value));

    const clear = [...fixture.nativeElement.querySelectorAll('.topbar-left .clear-btn')].find(
      (button) => (button as HTMLElement).textContent?.trim() === 'Clear',
    ) as HTMLButtonElement | undefined;
    expect(clear).toBeDefined();

    clear?.click();
    fixture.detectChanges();

    expect(emitted).toHaveLength(1);
    expect(component.selectionPopupOpen()).toBe(false);
  });

  it('announces the selected count in the label', async () => {
    await render([item(), item({ id: 'doc-2' }), item({ id: 'doc-3' })]);

    expect(query('.selected-label')?.textContent?.trim()).toBe('All 3 items selected');
  });

  it('resolves no bulk actions when nothing is registered in the slot', async () => {
    await render([item()]);

    // Guards the focus tests above: they assume the action row is empty, and would be measuring
    // something else entirely if the slot had picked up packaged actions by default.
    expect(component.bulkActions()).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('.topbar-actions button')).toHaveLength(0);
  });
});
