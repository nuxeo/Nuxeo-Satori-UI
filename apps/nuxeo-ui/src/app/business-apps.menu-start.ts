import type { Injector } from '@angular/core';

/** What the menu's lazily loaded module offers. */
export interface AppMenuModule {
  registerAppMenu(injector: Injector): Promise<void>;
}

/**
 * Starts the app's menu, `navigation.json` (`business-apps.menu.ts`), from an `APP_INITIALIZER`.
 *
 * Its own file, in the first bundle and importing nothing, so that the menu's module and the two
 * engines it uses load only here, lazily. And so that this, not the module, owns the one promise
 * the application waits on: it never rejects, even when the module's chunk cannot be fetched (a
 * flaky network, a chunk gone after a deploy), since a rejected initializer stops the whole
 * application from starting, where a missing menu leaves only the platform's.
 */
export async function startAppMenu(
  injector: Injector,
  load: () => Promise<AppMenuModule> = () => import('./business-apps.menu'),
): Promise<void> {
  try {
    const menu = await load();
    await menu.registerAppMenu(injector);
  } catch (error) {
    const message = (error as { message?: unknown } | null)?.message;
    console.warn(
      `[agentic-ui-menu] the app's menu was not loaded: ${typeof message === 'string' ? message : String(error)}; the platform's menu shows`,
    );
  }
}
