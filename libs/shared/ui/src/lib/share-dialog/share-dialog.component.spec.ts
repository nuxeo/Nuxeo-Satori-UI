import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { vi } from 'vitest';

import { NxsToastService } from '@nuxeo/satori-platform/components';

import { ShareDialogComponent, type ShareDialogData } from './share-dialog.component';

const URL_TO_SHARE = 'https://nuxeo.example/ui/#/doc/doc-1';

/** Browse, the record page and collections open this dialog to hand out a document's link. */
describe('ShareDialogComponent', () => {
  let fixture: ComponentFixture<ShareDialogComponent>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let writeText: ReturnType<typeof vi.fn>;
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  /** Sets what `navigator.clipboard` is, as a secure or insecure context would. */
  const clipboardIs = (value: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

  beforeEach(async () => {
    toast = { show: vi.fn(), error: vi.fn() };
    writeText = vi.fn().mockResolvedValue(undefined);
    clipboardIs({ writeText });
    // The component lists the toast service in its own providers; this replaces it there too.
    TestBed.overrideProvider(NxsToastService, { useValue: toast });

    await TestBed.configureTestingModule({
      imports: [ShareDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: { title: 'Q3 report', url: URL_TO_SHARE } satisfies ShareDialogData,
        },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShareDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  const copyButton = (): HTMLButtonElement => fixture.nativeElement.querySelector('.copy-btn');
  const flushPromises = () => new Promise((resolve) => setTimeout(resolve));

  it('names the document and shows its link, read-only, to select or copy', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.share-link-input');

    expect(fixture.nativeElement.querySelector('h2').textContent.trim()).toBe('Share the Document');
    expect(fixture.nativeElement.querySelector('.share-subtitle').textContent.trim()).toBe(
      'Internal access link to Q3 report.',
    );
    expect(input.value).toBe(URL_TO_SHARE);
    expect(input.readOnly).toBe(true);
  });

  it('names its controls for a screen reader', () => {
    expect(
      fixture.nativeElement.querySelector('.share-link-input').getAttribute('aria-label'),
    ).toBeTruthy();
    expect(copyButton().getAttribute('aria-label')).toBeTruthy();
  });

  it('copies the link to the clipboard and says so', async () => {
    copyButton().click();
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(URL_TO_SHARE);
    expect(toast.show).toHaveBeenCalledWith('Link copied to clipboard');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says the copy failed when the browser refuses it', async () => {
    writeText.mockRejectedValue(new DOMException('Document is not focused', 'NotAllowedError'));

    copyButton().click();
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith('Failed to copy link');
    expect(toast.show).not.toHaveBeenCalled();
  });
});
