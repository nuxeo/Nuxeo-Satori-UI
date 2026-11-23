import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { vi } from 'vitest';

import {
  FollowTransitionDialogComponent,
  type FollowTransitionDialogData,
} from './follow-transition-dialog.component';

const APPROVE = { name: 'approve', destinationState: 'approved' };
const OBSOLETE = { name: 'obsolete', destinationState: 'obsolete' };

/**
 * The dialog drawn with the real English catalogue, so every assertion reads what a user reads.
 * `MatDialogRef` is a stub so the value the dialog closes with can be observed: closing with the
 * wrong transition, or with one the user did not confirm, is the defect that matters here.
 */
describe('FollowTransitionDialogComponent', () => {
  let fixture: ComponentFixture<FollowTransitionDialogComponent>;
  const dialogRef = {
    close: vi.fn((_result?: unknown): void => undefined),
    addPanelClass: vi.fn((_classes: string | string[]): void => undefined),
    removePanelClass: vi.fn((_classes: string | string[]): void => undefined),
  };

  async function open(data: Partial<FollowTransitionDialogData> = {}): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), FollowTransitionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            documentTitle: 'Claim 7',
            state: 'project',
            transitions: [APPROVE, OBSOLETE],
            ...data,
          } satisfies FollowTransitionDialogData,
        },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FollowTransitionDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const text = (element: Element | null | undefined): string =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function choices(host: HTMLElement): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>('button[data-transition]')];
  }

  function button(host: HTMLElement, label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => text(candidate) === label,
    );
    if (!found) throw new Error(`no "${label}" button`);
    return found;
  }

  beforeEach(() => vi.clearAllMocks());

  it('offers a button per transition, each naming where it leads, under the current state', async () => {
    const host = await open();

    expect(text(host.querySelector('[mat-dialog-title]'))).toBe('Change state');
    expect(text(host.querySelector('.lib-follow-transition__state'))).toBe(
      'Current state: Project',
    );
    expect(choices(host).map((choice) => choice.dataset['transition'])).toEqual([
      'approve',
      'obsolete',
    ]);
    expect(choices(host).map(text)).toEqual([
      'Approve Moves to Approved',
      'Mark as obsolete Moves to Obsolete',
    ]);
  });

  it('asks before following: choosing a transition shows what it does, and closes with nothing yet', async () => {
    const host = await open();

    choices(host)[0].click();
    await settle();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(text(host.querySelector('[mat-dialog-title]'))).toBe('Approve');
    expect(text(host.querySelector('.lib-follow-transition__question'))).toBe(
      '“Claim 7” moves from Project to Approved.',
    );
    expect(choices(host)).toEqual([]);
  });

  it('closes with the transition the user confirmed', async () => {
    const host = await open();

    choices(host)[1].click();
    await settle();
    button(host, 'Mark as obsolete').click();

    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(dialogRef.close).toHaveBeenCalledWith(OBSOLETE);
  });

  it('goes back to the choice without closing, and then confirms the other transition', async () => {
    const host = await open();

    choices(host)[0].click();
    await settle();
    button(host, 'Back').click();
    await settle();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(choices(host)).toHaveLength(2);
    // Focus returns to the transition the user had picked, not to the page.
    expect(document.activeElement).toBe(choices(host)[0]);

    choices(host)[1].click();
    await settle();
    expect(document.activeElement).toBe(button(host, 'Mark as obsolete'));
    button(host, 'Mark as obsolete').click();
    expect(dialogRef.close).toHaveBeenCalledWith(OBSOLETE);
  });

  it('opens on the confirmation when there is one transition, with no Back', async () => {
    const host = await open({ transitions: [APPROVE] });

    expect(choices(host)).toEqual([]);
    expect(text(host.querySelector('.lib-follow-transition__question'))).toBe(
      '“Claim 7” moves from Project to Approved.',
    );
    expect(() => button(host, 'Back')).toThrow();
    expect(button(host, 'Cancel')).toBeTruthy();
  });

  it('cancels with nothing, from either step', async () => {
    const host = await open();

    // `mat-dialog-close` with no value closes with undefined; the stub records the call.
    button(host, 'Cancel').click();
    expect(dialogRef.close.mock.calls.every(([result]) => result === undefined)).toBe(true);

    choices(host)[0].click();
    await settle();
    button(host, 'Cancel').click();
    expect(dialogRef.close.mock.calls.every(([result]) => result === undefined)).toBe(true);
  });

  it('labels a transition and states the catalogue does not know by their names, written out', async () => {
    const host = await open({
      state: 'pendingReview',
      transitions: [{ name: 'sendBack', destinationState: 'needs_info' }],
    });

    expect(text(host.querySelector('[mat-dialog-title]'))).toBe('Send back');
    expect(text(host.querySelector('.lib-follow-transition__question'))).toBe(
      '“Claim 7” moves from Pending review to Needs info.',
    );
  });

  it('says what it can when the server named no destination, or the document has no state', async () => {
    const noDestination = await open({
      transitions: [{ name: 'approve', destinationState: null }],
    });
    expect(text(noDestination.querySelector('.lib-follow-transition__question'))).toBe(
      '“Claim 7” follows “Approve”.',
    );
    TestBed.resetTestingModule();

    const noState = await open({ state: null, transitions: [APPROVE, OBSOLETE] });
    expect(noState.querySelector('.lib-follow-transition__state')).toBeNull();
    choices(noState)[0].click();
    await settle();
    expect(text(noState.querySelector('.lib-follow-transition__question'))).toBe(
      '“Claim 7” moves to Approved.',
    );
  });

  it('draws no destination line for a transition the server could not place', async () => {
    const host = await open({
      transitions: [APPROVE, { name: 'archive', destinationState: null }],
    });

    expect(choices(host).map(text)).toEqual(['Approve Moves to Approved', 'Archive']);
  });

  it('shows a document title as text, never as markup', async () => {
    const host = await open({
      documentTitle: '<img src=x onerror=alert(1)>',
      transitions: [APPROVE],
    });

    expect(host.querySelector('img')).toBeNull();
    expect(text(host.querySelector('.lib-follow-transition__question'))).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });
});
