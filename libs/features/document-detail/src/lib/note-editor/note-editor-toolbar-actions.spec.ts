import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { TranslateService } from '@ngx-translate/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { NoteEditorComponent } from './note-editor';
import { NOTE_QUILL_TOOLBAR_CONTROLS } from './note-quill-toolbar';
import { NoteImagePickerDialogComponent } from './note-image-picker-dialog';

const mockQuill = vi.hoisted(() => {
  const instance = {
    getSelection: vi.fn(() => ({ index: 5, length: 0 })),
    getBounds: vi.fn(() => ({ left: 120, top: 80, width: 0, height: 18, bottom: 98 })),
    getLength: vi.fn(() => 12),
    insertEmbed: vi.fn(),
    focus: vi.fn(),
    on: vi.fn(),
    clipboard: {
      dangerouslyPasteHTML: vi.fn(),
      convert: vi.fn(() => ({ ops: [] })),
    },
    setContents: vi.fn(),
    getSemanticHTML: vi.fn(() => '<p>Hello</p>'),
    deleteText: vi.fn(),
    setSelection: vi.fn(),
    enable: vi.fn(),
    getModule: vi.fn(() => ({ container: { style: { display: '' } } })),
  };

  // A `function`, not an arrow: the component calls `new Quill(...)`, and since Vitest 4 a
  // mock called with `new` constructs its implementation, which an arrow function cannot be.
  const QuillCtor = vi.fn(function (
    _editor: HTMLElement,
    options?: {
      modules?: {
        toolbar?: {
          container?: HTMLElement;
          handlers?: Record<string, (value?: string | number | boolean) => void>;
        };
      };
    },
  ) {
    const toolbar = options?.modules?.toolbar?.container;
    const handlers = options?.modules?.toolbar?.handlers ?? {};
    if (toolbar) {
      for (const [format, handler] of Object.entries(handlers)) {
        toolbar.querySelectorAll(`.ql-${format}`).forEach((button) => {
          button.addEventListener('click', (event) => {
            event.preventDefault();
            handler();
          });
        });
      }
    }
    return instance;
  });
  Object.assign(QuillCtor, { sources: { SILENT: 'silent', USER: 'user' } });
  return { instance, QuillCtor };
});

vi.mock('quill', () => ({
  default: mockQuill.QuillCtor,
}));

describe('NoteEditorComponent toolbar actions (NXSAT-193)', () => {
  let fixture: ComponentFixture<NoteEditorComponent>;
  let component: NoteEditorComponent;
  let dialogOpen: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dialogOpen = vi.fn(() => ({
      afterClosed: () => of(undefined),
    }));

    await TestBed.configureTestingModule({
      imports: [
        testTranslateModule(),
        testTranslateModule(),
        NoteEditorComponent,
        NoopAnimationsModule,
        HttpClientTestingModule,
      ],
      providers: [provideZonelessChangeDetection()],
    })
      .overrideProvider(MatDialog, {
        useValue: {
          open: dialogOpen,
          openDialogs: [],
          closeAll: vi.fn(),
          getDialogById: vi.fn(),
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(NoteEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('content', '<p>Hello note</p>');
    fixture.componentRef.setInput('mimeType', 'text/html');
    fixture.componentRef.setInput('readOnly', false);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('exposes accessible labels for every toolbar control', () => {
    for (const control of NOTE_QUILL_TOOLBAR_CONTROLS) {
      const el = fixture.nativeElement.querySelector(control.selector);
      expect(el, control.selector).toBeTruthy();
      const label =
        el.getAttribute('aria-label') ??
        el.getAttribute('title') ??
        (el instanceof HTMLSelectElement ? el.getAttribute('aria-label') : null);
      expect(label, control.selector).toBe(
        TestBed.inject(TranslateService).instant(control.labelKey),
      );
    }
  });

  it('opens the document picker when insert-from-documents is clicked', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    expect(mockQuill.QuillCtor).toHaveBeenCalled();

    component.insertImagesFromExistingDocuments();
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalledWith(
      NoteImagePickerDialogComponent,
      expect.objectContaining({ panelClass: 'note-image-picker-panel' }),
    );
  });

  it('wires the insert-from-documents button to the picker handler', () => {
    const spy = vi.spyOn(component, 'insertImagesFromExistingDocuments');
    const button = fixture.nativeElement.querySelector(
      '.note-quill-image-from-docs',
    ) as HTMLButtonElement;

    button.click();

    expect(spy).toHaveBeenCalled();
  });

  it('opens the hidden file input when the image toolbar button is used', () => {
    const fileInput = fixture.nativeElement.querySelector(
      'input[type="file"].note-quill-hidden-file-input',
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    const imageButton = fixture.nativeElement.querySelector('.ql-image') as HTMLButtonElement;
    imageButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    imageButton.click();
    fixture.detectChanges();

    expect(mockQuill.QuillCtor).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('shows the HTML source toggle and Save in the footer', () => {
    expect(fixture.nativeElement.querySelector('.source-toggle')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.note-footer .save-btn')).toBeTruthy();
  });

  it('enters HTML source mode when the source toggle is clicked', () => {
    const toggle = fixture.nativeElement.querySelector('.source-toggle') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(component.sourceMode()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('textarea[aria-label="Note HTML source"]'),
    ).toBeTruthy();
  });

  it('emits saveNote with Quill HTML when Save is clicked', () => {
    const saveSpy = vi.fn();
    component.saveNote.subscribe(saveSpy);

    const saveButton = fixture.nativeElement.querySelector(
      '.note-footer .save-btn',
    ) as HTMLButtonElement;
    saveButton.click();

    expect(saveSpy).toHaveBeenCalledWith('<p>Hello</p>');
  });

  it('registers video tooltip repositioning on the video toolbar button', () => {
    const videoButton = fixture.nativeElement.querySelector('.ql-video') as HTMLButtonElement;
    const tooltip = document.createElement('div');
    tooltip.className = 'ql-tooltip';
    tooltip.setAttribute('data-mode', 'video');
    Object.defineProperty(tooltip, 'offsetWidth', { value: 320 });

    const editorEl = fixture.nativeElement.querySelector('.note-quill-editor') as HTMLElement;
    editorEl.appendChild(tooltip);

    videoButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    videoButton.click();

    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(mockQuill.instance.getBounds).toHaveBeenCalled();
        expect(tooltip.style.left).not.toBe('');
        expect(tooltip.style.top).not.toBe('');
        expect(tooltip.style.transform).toBe('translateX(-50%)');
        resolve();
      });
    });
  });
});
