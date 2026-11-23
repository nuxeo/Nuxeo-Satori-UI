import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';

import { SelectionService } from '@nuxeo/satori-platform/nuxeo-client';
import { SelectionTopbarComponent } from '@nuxeo/satori-platform/ui';

import { appConfig } from '../app.config';
import { AppShellComponent } from './app-shell.component';
import { AuthService } from '../auth/auth.service';

/**
 * The shell's selection bar offers what the page holding the selection offers: a queue's page
 * names its bulk actions in `SelectionService.offeredBulkActions`, and the shell hands them to the
 * bar (docs/business-apps/app-definition-v2.md, section 4). The queue page's spec checks the
 * signal and the bar's spec checks its input; this checks the binding between them, without which
 * a queue would offer every bulk action.
 */
describe('the shell selection bar, on a page that offers its own bulk actions', () => {
  // Shape copied from `app-shell-header-a11y.spec.ts`, the working precedent.
  const authMock = {
    isAuthenticated: signal(true),
    username: signal('test.user'),
    hasAdministrationAccess: signal(false),
    isAdministrator: signal(false),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  } as unknown as AuthService;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();
  });

  afterEach(() => TestBed.inject(SelectionService).resetUiState());

  const actionIds = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('lib-selection-topbar [data-action-id]')].map(
      (button) => button.getAttribute('data-action-id') ?? '',
    );

  it("offers only the page's bulk actions, and every one again when the page names none", () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    const selection = TestBed.inject(SelectionService);
    selection.toggle('c1', 'Claim 1');
    selection.offeredBulkActions.set([
      'app.bulkActions.addToClipboard',
      'app.bulkActions.downloadZip',
    ]);
    fixture.detectChanges();

    const bar = fixture.debugElement.query(By.directive(SelectionTopbarComponent));
    expect((bar.componentInstance as SelectionTopbarComponent).offered()).toEqual([
      'app.bulkActions.addToClipboard',
      'app.bulkActions.downloadZip',
    ]);
    // The packaged six have handlers in the app, so both are drawn, in the slot's order.
    expect(actionIds(fixture.nativeElement as HTMLElement)).toEqual([
      'app.bulkActions.downloadZip',
      'app.bulkActions.addToClipboard',
    ]);

    selection.offeredBulkActions.set(null);
    fixture.detectChanges();
    expect(actionIds(fixture.nativeElement as HTMLElement).length).toBe(6);
  });
});
