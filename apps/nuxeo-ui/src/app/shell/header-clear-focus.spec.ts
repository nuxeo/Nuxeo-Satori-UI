import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { SearchAggregationService, SearchService } from '@nuxeo/satori-platform/nuxeo-client';
import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { AppShellComponent } from './app-shell.component';

describe('Header search Clear browser focus', () => {
  let navigated: string[];
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent, MatIconTestingModule],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, {
        useValue: {
          isAuthenticated: signal(true),
          username: signal('test.user'),
          hasAdministrationAccess: signal(false),
          isAdministrator: signal(false),
          basicCredentials: () => null,
          shareAuthToken: () => null,
          logout: () => undefined,
        },
      })
      .compileComponents();
    navigated = [];
    spyOn(TestBed.inject(Router), 'navigateByUrl').and.callFake(async (url) => {
      navigated.push(String(url));
      return true;
    });
  });
  for (const term of ['invoice', '   ']) {
    it(`retains header Clear focus after clearing ${JSON.stringify(term)}`, async () => {
      const router = TestBed.inject(Router);
      spyOnProperty(router, 'url', 'get').and.returnValue('/search');
      spyOn(TestBed.inject(SearchService), 'suggestFromSuggestersLauncher').and.returnValue(of([]));
      const fixture = TestBed.createComponent(AppShellComponent);
      const shell = fixture.componentInstance;
      const settle = async () => {
        fixture.detectChanges();
        // Shell background work is outside this control's contract; flush its signal bindings
        // and actual browser frames without waiting for unrelated application requests.
        await Promise.resolve();
        fixture.detectChanges();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      };
      await settle();
      shell.onGlobalSearchInput(term);
      await settle();
      const clear = fixture.nativeElement.querySelector(
        '.header-search-actions button',
      ) as HTMLButtonElement;
      const clearKeywords = spyOn(shell, 'clearSearchKeywords').and.callThrough();
      window.focus();
      clear.focus();
      expect(document.hasFocus()).withContext('the browser test document has focus').toBeTrue();
      expect(document.activeElement).toBe(clear);
      expect(clear.disabled).toBeFalse();
      clear.click();
      await settle();

      expect(shell.globalSearchTerm()).toBe('');
      expect(TestBed.inject(SearchAggregationService).keywordRequest()).toEqual({ term: '' });
      expect(document.activeElement).withContext('after Clear empties the search term').toBe(clear);
      expect(clear.disabled).withContext('keep unavailable Clear focusable').toBeFalse();
      expect(clear.getAttribute('aria-disabled')).toBe('true');
      const navigationCount = navigated.length;
      clear.click();
      await settle();
      expect(clearKeywords).toHaveBeenCalledTimes(1);
      expect(navigated).toHaveSize(navigationCount);
      expect(document.activeElement).toBe(clear);
    });
  }
});
