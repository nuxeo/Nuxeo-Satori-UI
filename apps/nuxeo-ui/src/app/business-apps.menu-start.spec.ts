/**
 * Starting the app's menu at startup (business-apps.menu-start.ts): that it can never stop the
 * application starting, and that it reads nothing from the configuration before it has loaded.
 */
import { ApplicationInitStatus, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  APP_BOOTSTRAP_CONFIG_URL,
  APP_CONFIG_FORMAT,
  type AppConfigLayer,
} from '@nuxeo/satori-platform/app-config';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from './app.config';
import { startAppMenu } from './business-apps.menu-start';

function envelope(layer: AppConfigLayer, content: Record<string, unknown>) {
  return {
    format: APP_CONFIG_FORMAT,
    layer,
    fragments: [{ name: 'acme', component: 'com.acme', bundle: 'acme-ui', source: 'x', content }],
    diagnostics: [],
  };
}

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('starting the app menu', () => {
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    spyOn(console, 'warn').and.callFake((message: unknown) => warnings.push(String(message)));
  });

  it('resolves when the menu’s code cannot be fetched, so the application still starts', async () => {
    const injector = Injector.create({ providers: [] });
    await expectAsync(
      startAppMenu(injector, () =>
        Promise.reject(new Error('Failed to fetch dynamically imported module')),
      ),
    ).toBeResolved();
    expect(warnings).toEqual([
      "[agentic-ui-menu] the app's menu was not loaded: Failed to fetch dynamically imported module; the platform's menu shows",
    ]);
  });

  it('reads the Nuxeo API origin only after the configuration has loaded, whatever arrives first', async () => {
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const status = TestBed.inject(ApplicationInitStatus);
    // The menu's code arrives first, as from a warm cache: its initializer has run on by now.
    await import('./business-apps.menu');
    for (let i = 0; i < 5; i++) await turn();
    for (const layer of ['bootstrap', 'manifest'] as const) {
      for (const request of http.match((r) => r.url.endsWith(`/agentic-ui-config/${layer}.json`))) {
        request.flush(
          envelope(
            layer,
            layer === 'bootstrap' ? { nuxeoApiOrigin: 'https://nuxeo.acme.example' } : {},
          ),
        );
      }
    }
    for (let i = 0; i < 50 && !status.done; i++) {
      await turn();
      http.match(() => true).forEach((request) => request.flush({}));
    }
    expect(status.done).withContext('application initializers settled').toBeTrue();
    expect(TestBed.inject(NUXEO_API_ORIGIN)).toBe('https://nuxeo.acme.example');
  });
});
