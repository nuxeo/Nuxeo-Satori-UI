import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsUploadQueue, type NxsUploadItem } from './upload-queue';
import { NxsUploadQueueComponent } from './upload-queue.component';

@Component({
  standalone: true,
  imports: [NxsUploadQueueComponent],
  template: `<nxs-upload-queue
    label="Files to upload"
    [items]="items()"
    (remove)="removed.push($event)"
    (retry)="retried.push($event)"
  />`,
})
class HostComponent {
  readonly items = signal<readonly NxsUploadItem[]>([]);
  readonly removed: string[] = [];
  readonly retried: string[] = [];
}

describe('NxsUploadQueueComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let queue: NxsUploadQueue;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rows = (): HTMLElement[] => [...el().querySelectorAll<HTMLElement>('li')];
  const status = (i: number) =>
    rows()[i].querySelector('.nxs-upload-queue__status')?.textContent?.trim();

  async function show(): Promise<void> {
    host.items.set(queue.items());
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    queue = new NxsUploadQueue();
    queue.stage([new File(['x'.repeat(2048)], 'scan.pdf'), new File(['y'], 'note.txt')]);
    await show();
  });

  it('takes keyboard focus only while the list scrolls, so a run without buttons can be scrolled', async () => {
    const list = () => el().querySelector('ul') as HTMLElement;
    const measure = (scrollHeight: number) => {
      Object.defineProperty(list(), 'scrollHeight', { configurable: true, value: scrollHeight });
      Object.defineProperty(list(), 'clientHeight', { configurable: true, value: 280 });
    };
    expect(list().hasAttribute('tabindex')).toBe(false);

    measure(600);
    queue.start();
    await show();
    await fixture.whenStable();
    expect(rows().some((row) => row.querySelector('button'))).toBe(false);
    expect(list().getAttribute('tabindex')).toBe('0');

    measure(280);
    queue.progress({ percent: 50, fileIndex: 0, fileCount: 2 });
    await show();
    await fixture.whenStable();
    expect(list().hasAttribute('tabindex')).toBe(false);
  });

  it('renders nothing for an empty queue', async () => {
    queue.clear();
    await show();
    expect(el().querySelector('ul')).toBeNull();
  });

  it('lists the chosen files with their size, in a named list, and no summary yet', () => {
    expect(el().querySelector('ul')?.getAttribute('aria-label')).toBe('Files to upload');
    expect(
      rows().map((row) => row.querySelector('.nxs-upload-queue__name')?.textContent?.trim()),
    ).toEqual(['scan.pdf', 'note.txt']);
    expect(status(0)).toBe('2.0 KB');
    expect(status(1)).toBe('1 B');
    expect(el().querySelector('.nxs-upload-queue__summary')).toBeNull();
  });

  it('shows each file’s progress with a named bar, and a polite summary', async () => {
    queue.start();
    queue.progress({ percent: 25, fileIndex: 0, fileCount: 2 });
    await show();
    expect(status(0)).toBe('Uploading, 50%');
    expect(status(1)).toBe('Waiting');
    expect(rows()[0].querySelector('mat-progress-bar')?.getAttribute('aria-label')).toBe(
      'Uploading scan.pdf',
    );
    expect(rows()[1].querySelector('mat-progress-bar')).toBeNull();
    const summary = el().querySelector('.nxs-upload-queue__summary');
    expect(summary?.getAttribute('aria-live')).toBe('polite');
    expect(summary?.textContent?.trim()).toBe('0 of 2 uploaded');
    // Nothing that is uploading can be removed.
    expect(el().querySelector('.nxs-upload-queue__remove')).toBeNull();
  });

  it('says why a file failed, and offers Retry and Remove named for it', async () => {
    queue.start();
    queue.progress({ percent: 50, fileIndex: 0, fileCount: 2 });
    queue.progress({ percent: 60, fileIndex: 1, fileCount: 2 });
    queue.fail({ status: 403 });
    await show();
    expect(status(0)).toBe('Uploaded');
    expect(status(1)).toBe('You do not have permission to add documents here');
    expect(
      el().querySelector('.nxs-upload-queue__summary')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('1 of 2 uploaded 1 could not be uploaded');

    const retry = rows()[1].querySelector('.nxs-upload-queue__retry') as HTMLButtonElement;
    expect(retry.getAttribute('aria-label')).toBe('Retry note.txt');
    retry.click();
    (rows()[1].querySelector('.nxs-upload-queue__remove') as HTMLButtonElement).click();
    expect(host.retried).toEqual([queue.items()[1].id]);
    expect(host.removed).toEqual([queue.items()[1].id]);
  });

  it.each([
    [404, 'The folder no longer exists'],
    [500, 'Could not be uploaded'],
  ])('reads a %i as its own reason', async (statusCode, message) => {
    queue.start();
    queue.fail({ status: statusCode });
    await show();
    expect(status(0)).toBe(message);
  });
});
