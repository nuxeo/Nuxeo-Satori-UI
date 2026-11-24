import {
  type EnvironmentProviders,
  Injector,
  type Provider,
  effect,
  inject,
  provideAppInitializer,
  untracked,
} from '@angular/core';
import {
  APP_DEFINITION_FILES,
  APP_REGISTRY_RELOAD,
  AppRegistryService,
} from '@agentic-ui/shared/app-registry';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';

import { AuthService } from './auth/auth.service';

/**
 * Who the page was last reloaded for, after a sign-in changed the app open, and when, in
 * `sessionStorage`. The page is not reloaded for the same person twice within
 * {@link APP_REGISTRY_RELOAD_WINDOW_MS}: whatever made the registry answer differently at startup
 * and after the sign-in, it must not reload the page for ever.
 */
export const APP_REGISTRY_RELOADED_KEY = 'agentic-ui.app-registry.reloaded-for';

export const APP_REGISTRY_RELOAD_WINDOW_MS = 30_000;

/**
 * The app registry, for the shell (docs/business-apps/app-definition-v2.md, section 13): every file
 * of an app definition the engines read, the home, the menu, the queues, the labels and the task
 * forms, is read through `AppRegistryService`, which reads it where the development server serves
 * it and otherwise from the registry, for the app open. And the page follows the person signed in.
 */
export function provideAppRegistry(): (Provider | EnvironmentProviders)[] {
  return [
    { provide: APP_DEFINITION_FILES, useExisting: AppRegistryService },
    // Not waited on: it only follows sign-ins, and must not hold up the start.
    provideAppInitializer(() => void followSignIn(inject(Injector))),
  ];
}

/**
 * Reloads the page when a sign-in changes the app open.
 *
 * The registry serves an app after sign-in, and the menu and the labels are read once, at startup.
 * So a person who signs in on the page, where no one was signed in when it started, or someone
 * else was, would keep the menu of the app open before. When the registry, read again for them,
 * opens another app, the page reloads, and starts with theirs: the session is kept, so nothing is
 * asked again. A sign-in that opens the same app, the usual case once a person has signed in once,
 * changes nothing, and neither does signing out.
 */
export async function followSignIn(injector: Injector): Promise<void> {
  try {
    // First: `AuthService` reads `NUXEO_API_ORIGIN` when it is built, and that token keeps the
    // value it first reads, so building it before the configuration loads would pin the default
    // origin for the session (provide-app-config.ts, "Ordering note").
    await injector.get(AppConfigService).load();
  } catch {
    // The configuration's own fallbacks apply; the sign-ins are still followed.
  }
  const auth = injector.get(AuthService);
  const registry = injector.get(AppRegistryService);
  const reload = injector.get(APP_REGISTRY_RELOAD);
  let previous = auth.username();
  effect(
    () => {
      const username = auth.username();
      if (username === previous) return;
      previous = username;
      if (username === null) return;
      untracked(() => {
        void registry.refresh().then((changed) => {
          if (changed && auth.username() === username) reloadOnce(username, reload);
        });
      });
    },
    { injector },
  );
}

function reloadOnce(username: string, reload: () => void, now = Date.now()): void {
  let storage: Storage | null = null;
  try {
    storage = sessionStorage;
  } catch {
    // A browser that keeps nothing: reload, since the menu would otherwise be another app's.
  }
  let last: { username?: unknown; at?: unknown } = {};
  try {
    last = JSON.parse(storage?.getItem(APP_REGISTRY_RELOADED_KEY) ?? '{}') ?? {};
  } catch {
    last = {};
  }
  if (
    last.username === username &&
    typeof last.at === 'number' &&
    now - last.at >= 0 &&
    now - last.at < APP_REGISTRY_RELOAD_WINDOW_MS
  ) {
    console.warn(
      `[agentic-ui-apps] the app open for ${username} changed again just after a reload; not reloading again`,
    );
    return;
  }
  try {
    storage?.setItem(APP_REGISTRY_RELOADED_KEY, JSON.stringify({ username, at: now }));
  } catch {
    // Kept nowhere: the reload still happens, once, for this sign-in.
  }
  reload();
}
