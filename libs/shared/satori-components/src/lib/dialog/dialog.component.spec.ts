import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  inject,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { NxsButtonComponent } from '../button/button.component';
import { NxsDialogComponent } from './dialog.component';

/** A dialog component as a page writes one: the frame at its root, its own words and buttons. */
@Component({
  standalone: true,
  imports: [NxsDialogComponent, NxsButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<nxs-dialog [heading]="title()">
    <p class="question">{{ data.question }}</p>
    <ng-container nxsDialogActions>
      <nxs-button class="cancel" (press)="ref.close()">Cancel</nxs-button>
      <nxs-button class="run" appearance="filled" (press)="ref.close('done')">Run</nxs-button>
    </ng-container>
  </nxs-dialog>`,
})
class AskingDialog {
  protected readonly data = inject<{ title: string; question: string }>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<AskingDialog, 'done'>>(MatDialogRef);
  readonly title = signal(this.data.title);
}

describe('NxsDialogComponent', () => {
  let dialog: MatDialog;

  const settle = (): Promise<void> => TestBed.inject(ApplicationRef).whenStable();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
    dialog = TestBed.inject(MatDialog);
  });

  afterEach(() => dialog.closeAll());

  async function open(): Promise<{
    ref: MatDialogRef<AskingDialog, 'done'>;
    container: HTMLElement;
  }> {
    const ref = dialog.open<AskingDialog, unknown, 'done'>(AskingDialog, {
      data: { title: 'Send back', question: 'Send round 2 back?' },
    });
    await settle();
    const container = document.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) throw new Error('no dialog opened');
    return { ref, container };
  }

  it('draws the title as a level-two heading that names the dialog', async () => {
    const { container } = await open();
    const title = container.querySelector('.nxs-dialog__title');
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent?.trim()).toBe('Send back');
    expect(title?.classList).toContain('mat-mdc-dialog-title');
    expect(container.getAttribute('role')).toBe('dialog');
    expect(container.getAttribute('aria-labelledby')).toBe(title?.id);
  });

  it('puts what it is given in Material’s content, and what is marked as actions in its actions', async () => {
    const { container } = await open();
    const content = container.querySelector('.nxs-dialog__content');
    expect(content?.classList).toContain('mat-mdc-dialog-content');
    expect(content?.querySelector('.question')?.textContent?.trim()).toBe('Send round 2 back?');
    expect(content?.querySelector('nxs-button')).toBeNull();
    const actions = container.querySelector('.nxs-dialog__actions');
    expect(actions?.classList).toContain('mat-mdc-dialog-actions');
    expect(actions?.classList).toContain('mat-mdc-dialog-actions-align-end');
    expect(
      [...(actions?.querySelectorAll('button') ?? [])].map((button) => button.textContent?.trim()),
    ).toEqual(['Cancel', 'Run']);
  });

  it('adds no box of its own: the title, content and actions are its only children', async () => {
    const { container } = await open();
    const frame = container.querySelector<HTMLElement>('nxs-dialog');
    expect(frame?.classList).toContain('nxs-dialog');
    const parts = ['nxs-dialog__title', 'nxs-dialog__content', 'nxs-dialog__actions'];
    expect(
      [...(frame?.children ?? [])].map((child) =>
        parts.find((part) => child.classList.contains(part)),
      ),
    ).toEqual(parts);
  });

  it('leaves closing to MatDialog: a button closes with what the page gives it', async () => {
    const { ref, container } = await open();
    const closed: unknown[] = [];
    ref.afterClosed().subscribe((result) => closed.push(result));
    container.querySelector<HTMLButtonElement>('.run button')?.click();
    await settle();
    expect(closed).toEqual(['done']);
  });

  it('follows a title that changes', async () => {
    const { ref, container } = await open();
    ref.componentInstance.title.set('Send round 2 back');
    await settle();
    expect(container.querySelector('.nxs-dialog__title')?.textContent?.trim()).toBe(
      'Send round 2 back',
    );
  });
});
