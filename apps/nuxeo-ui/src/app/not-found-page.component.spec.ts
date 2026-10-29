/**
 * The page an unmatched route lands on.
 *
 * Before the catch-all route existed, a stale bookmark rendered a blank page — measured at under
 * 120 characters of text, with no header and no way back. These tests hold the two things that
 * made it worth adding: the shared 404 error state is rendered, and there is a control that
 * actually navigates somewhere.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';

import { NotFoundPageComponent } from './not-found-page.component';
import { testTranslateModule } from './i18n/translate-testing';

describe('NotFoundPageComponent', () => {
  let fixture: ComponentFixture<NotFoundPageComponent>;
  let navigateByUrl: jasmine.Spy;

  beforeEach(async () => {
    navigateByUrl = jasmine.createSpy('navigateByUrl').and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [NotFoundPageComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: Router, useValue: { navigateByUrl } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotFoundPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders the shared error state at 404', () => {
    const errorState = fixture.nativeElement.querySelector('nxs-error-state');
    expect(errorState).not.toBeNull();
    // Rendered rather than blank: the defect was a page with nothing on it.
    expect((fixture.nativeElement.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('offers a way back to the dashboard, and takes it', async () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    button!.click();
    await fixture.whenStable();

    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });
});
