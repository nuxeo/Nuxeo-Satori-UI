/**
 * NXSAT-526 — a tag chip's remove button must draw `cancel` from its codepoint on the legacy
 * Material Icons font (apps/nuxeo-ui/src/index.html), with no ligature text in the button. The
 * document page's tags are `nxs-tag-editor` now, so this renders the real component.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { testTranslateModule } from '../i18n/translate-testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
// testTranslateModule() removed - no longer exported in ngx-translate 18
import { of } from 'rxjs';

import { NxsTagEditorComponent } from '@nuxeo/satori-platform/components';
import { TagService } from '@nuxeo/satori-platform/nuxeo-client';

describe('Tag editor chip remove icon glyph (NXSAT-526)', () => {
  let fixture: ComponentFixture<NxsTagEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsTagEditorComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: TagService,
          useValue: { addTag: () => of([]), removeTag: () => of([]), suggestTags: () => of([]) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NxsTagEditorComponent);
    fixture.componentRef.setInput('documentUid', 'doc-1');
    fixture.componentRef.setInput('tags', ['example']);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('renders cancel via ::before on an empty mat-icon (legacy Material Icons font)', () => {
    const icon = fixture.nativeElement.querySelector(
      'button[matChipRemove] mat-icon.nxs-tag-editor__remove-icon',
    ) as HTMLElement;
    expect(icon).toBeTruthy();
    expect((icon.textContent ?? '').trim()).toBe('');

    const glyph = getComputedStyle(icon, '::before');
    const content = glyph.content.replace(/"/g, '');
    expect(content).not.toBe('none');
    expect(content.codePointAt(0))
      .withContext('::before must use Material Icons cancel codepoint U+E5C9')
      .toBe(0xe5c9);
    expect(glyph.fontFamily.toLowerCase()).toContain('material icons');
  });
});
