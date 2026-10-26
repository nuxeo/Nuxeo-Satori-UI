/**
 * NXENG-826 / NXSAT-673 — header back icon must render via SVG icon, not CSS codepoint or
 * font ligature (which trip IBM's label-in-name check).
 */
import { Component, provideZonelessChangeDetection, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

@Component({
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail-go-back-icon.scss',
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './document-detail-go-back-icon.spec.html',
})
class DocumentDetailGoBackIconHostComponent {}

describe('Document detail header go-back icon glyph (NXENG-826)', () => {
  let fixture: ComponentFixture<DocumentDetailGoBackIconHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentDetailGoBackIconHostComponent, MatIconTestingModule],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentDetailGoBackIconHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('renders arrow_left via SVG icon without ligature text (NXSAT-673)', () => {
    const icon = fixture.nativeElement.querySelector('mat-icon') as HTMLElement;
    expect(icon).toBeTruthy();
    expect(icon.getAttribute('svgicon')).toBe('arrow_left');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect((icon.textContent ?? '').trim()).toBe('');
  });
});
