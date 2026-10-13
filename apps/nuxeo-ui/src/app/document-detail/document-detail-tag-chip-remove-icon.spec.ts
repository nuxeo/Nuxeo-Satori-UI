/**
 * NXSAT-526 — tag chip remove must render cancel via CSS codepoint on the legacy Material Icons
 * font (apps/nuxeo-ui/src/index.html). An empty mat-icon alone does not paint the glyph.
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

@Component({
  standalone: true,
  imports: [MatIconModule],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail-tag-chip-remove-icon.scss',
  ],
  templateUrl: './document-detail-tag-chip-remove-icon.spec.html',
})
class DocumentDetailTagChipRemoveIconHostComponent {}

describe('Document detail tag chip remove icon glyph (NXSAT-526)', () => {
  let fixture: ComponentFixture<DocumentDetailTagChipRemoveIconHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentDetailTagChipRemoveIconHostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentDetailTagChipRemoveIconHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('renders cancel via ::before on an empty mat-icon (legacy Material Icons font)', () => {
    const icon = fixture.nativeElement.querySelector(
      'mat-icon.detail-tag-chip-remove-icon',
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
