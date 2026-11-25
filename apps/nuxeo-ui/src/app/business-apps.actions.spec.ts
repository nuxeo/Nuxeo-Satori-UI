/**
 * The app's operation buttons, actions.json, registered at startup (business-apps.actions.ts and
 * business-apps.actions-start.ts): read from the app registry alone, for the app open, and never
 * stopping the application from starting.
 */
import { HttpErrorResponse } from '@angular/common/http';
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppRegistryService } from '@agentic-ui/shared/app-registry';
import { AppActionsService } from '@agentic-ui/shared/document-layouts';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { of, throwError } from 'rxjs';

import { startAppActions } from './business-apps.actions-start';
import { registerAppActions } from './business-apps.actions';

const ACTIONS = { version: 2, actions: [] };

describe("the app's operation buttons at startup", () => {
  let warnings: string[];
  let file: jasmine.Spy;
  let register: jasmine.Spy;
  let current: ReturnType<typeof signal<{ id: string; files: string[] } | null>>;

  beforeEach(() => {
    warnings = [];
    spyOn(console, 'warn').and.callFake((message: unknown) => warnings.push(String(message)));
    current = signal<{ id: string; files: string[] } | null>({
      id: 'payers-claims',
      files: ['app.json', 'actions.json'],
    });
    file = jasmine.createSpy('file').and.returnValue(of(ACTIONS));
    register = jasmine.createSpy('register').and.returnValue([]);
    TestBed.configureTestingModule({
      providers: [
        { provide: AppConfigService, useValue: { load: () => Promise.resolve() } },
        {
          provide: AppRegistryService,
          useValue: { load: () => Promise.resolve(), current, file },
        },
        { provide: AppActionsService, useValue: { register } },
      ],
    });
  });

  it("registers the actions.json the registry serves for the app open, under the app's id", async () => {
    await registerAppActions(TestBed.inject(Injector));
    // The registry alone: never the development server, which no allow-list filters.
    expect(file).toHaveBeenCalledOnceWith('actions.json', null);
    expect(register).toHaveBeenCalledOnceWith('payers-claims', ACTIONS);
  });

  it('registers nothing with no app open, or one with no actions.json', async () => {
    current.set(null);
    await registerAppActions(TestBed.inject(Injector));
    current.set({ id: 'payers-claims', files: ['app.json'] });
    await registerAppActions(TestBed.inject(Injector));
    expect(file).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('says why, and registers nothing, when the file cannot be read', async () => {
    file.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await registerAppActions(TestBed.inject(Injector));
    expect(register).not.toHaveBeenCalled();
    expect(warnings).toEqual([
      "[agentic-ui-actions] actions.json not applied: HTTP 500; the app's operation buttons are not offered",
    ]);
  });

  it('resolves when the module cannot be fetched, so the application still starts', async () => {
    await expectAsync(
      startAppActions(Injector.create({ providers: [] }), () =>
        Promise.reject(new Error('chunk gone')),
      ),
    ).toBeResolved();
    expect(warnings).toEqual([
      "[agentic-ui-actions] the app's operation buttons were not loaded: chunk gone",
    ]);
  });
});
