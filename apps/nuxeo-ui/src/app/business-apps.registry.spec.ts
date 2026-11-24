/**
 * The app registry in the shell (docs/business-apps/app-definition-v2.md, section 13): the engines
 * read through it, and the page follows the person signed in, reloading when a sign-in changes the
 * app open, once.
 */
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  APP_DEFINITION_FILES,
  APP_REGISTRY_RELOAD,
  AppRegistryService,
} from '@agentic-ui/shared/app-registry';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

import { AuthService } from './auth/auth.service';
import {
  APP_REGISTRY_RELOADED_KEY,
  APP_REGISTRY_RELOAD_WINDOW_MS,
  followSignIn,
  provideAppRegistry,
} from './business-apps.registry';

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('the app registry in the shell', () => {
  let username: ReturnType<typeof signal<string | null>>;
  let refreshes: number;
  let changes: boolean;
  let reloads: number;

  beforeEach(() => {
    sessionStorage.removeItem(APP_REGISTRY_RELOADED_KEY);
    username = signal<string | null>('dana');
    refreshes = 0;
    changes = true;
    reloads = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { username } },
        {
          provide: AppRegistryService,
          useValue: {
            refresh: () => {
              refreshes++;
              return Promise.resolve(changes);
            },
          },
        },
        { provide: APP_REGISTRY_RELOAD, useValue: () => reloads++ },
        { provide: AppConfigService, useValue: { load: () => Promise.resolve() } },
      ],
    });
  });

  afterEach(() => sessionStorage.removeItem(APP_REGISTRY_RELOADED_KEY));

  async function signIn(as: string | null): Promise<void> {
    username.set(as);
    TestBed.tick();
    await turn();
  }

  it('gives the engines the registry to read their files through', () => {
    TestBed.resetTestingModule();
    const registry = {};
    TestBed.configureTestingModule({
      providers: [
        // The initializer is not run here: the provider is what is asserted.
        provideAppRegistry().filter((provider) => 'provide' in provider),
        { provide: AppRegistryService, useValue: registry },
      ],
    });

    expect(TestBed.inject(APP_DEFINITION_FILES)).toBe(registry as never);
  });

  it('reads the registry again when someone signs in, and reloads when the app open changes', async () => {
    await followSignIn(TestBed.inject(Injector));
    TestBed.tick();
    expect(refreshes).withContext('nothing changed at startup').toBe(0);

    await signIn(null);
    expect(refreshes).withContext('signing out reads nothing').toBe(0);

    await signIn('sam');
    expect(refreshes).toBe(1);
    expect(reloads).toBe(1);
  });

  it('does not reload when the app open stays the same', async () => {
    changes = false;
    await followSignIn(TestBed.inject(Injector));

    await signIn('sam');

    expect(refreshes).toBe(1);
    expect(reloads).toBe(0);
  });

  it('does not reload when someone else has signed in by the time the registry answers', async () => {
    const answers: ((changed: boolean) => void)[] = [];
    TestBed.overrideProvider(AppRegistryService, {
      useValue: { refresh: () => new Promise<boolean>((resolve) => answers.push(resolve)) },
    });
    await followSignIn(TestBed.inject(Injector));

    await signIn('sam');
    await signIn('riley');
    // Sam's answer arrives after Riley has signed in; Riley's is still on its way.
    answers[0]?.(true);
    await turn();

    expect(answers.length).toBe(2);
    expect(reloads).toBe(0);
  });

  it('reloads once for the same person, not for ever, and again once the window has passed', async () => {
    await followSignIn(TestBed.inject(Injector));

    await signIn('sam');
    expect(reloads).toBe(1);

    // As if the page had reloaded and the registry had answered differently again.
    await signIn(null);
    await signIn('sam');
    expect(reloads).withContext('the second reload for the same person is refused').toBe(1);

    const last = JSON.parse(sessionStorage.getItem(APP_REGISTRY_RELOADED_KEY) ?? '{}');
    sessionStorage.setItem(
      APP_REGISTRY_RELOADED_KEY,
      JSON.stringify({ ...last, at: last.at - APP_REGISTRY_RELOAD_WINDOW_MS - 1 }),
    );
    await signIn(null);
    await signIn('sam');
    expect(reloads).toBe(2);

    await signIn('riley');
    expect(reloads).withContext('someone else is another sign-in').toBe(3);
  });
});
