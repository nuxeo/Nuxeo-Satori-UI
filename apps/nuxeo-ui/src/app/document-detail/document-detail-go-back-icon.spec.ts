/**
 * NXENG-826 — header back icon must render arrow_back via CSS codepoint on the legacy Material
 * Icons font (apps/nuxeo-ui/src/index.html). fontIcon does not paint a glyph with that font alone.
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

@Component({
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail-go-back-icon.scss',
  ],
  templateUrl: './document-detail-go-back-icon.spec.html',
})
class DocumentDetailGoBackIconHostComponent {}

describe('Document detail header go-back icon glyph (NXENG-826)', () => {
  let fixture: ComponentFixture<DocumentDetailGoBackIconHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentDetailGoBackIconHostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentDetailGoBackIconHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('renders arrow_back via ::before on an empty mat-icon (legacy Material Icons font)', () => {
    const icon = fixture.nativeElement.querySelector(
      'mat-icon.detail-header-go-back-icon',
    ) as HTMLElement;
    expect(icon).toBeTruthy();
    expect((icon.textContent ?? '').trim()).toBe('');

    const glyph = getComputedStyle(icon, '::before');
    const content = glyph.content.replace(/"/g, '');
    expect(content).not.toBe('none');
    expect(content.codePointAt(0))
      .withContext('::before must use Material Icons arrow_back codepoint U+E5C4')
      .toBe(0xe5c4);
    expect(glyph.fontFamily.toLowerCase()).toContain('material icons');
  });
});
