import type { Injector } from '@angular/core';

/** What the operation buttons' lazily loaded module offers. */
export interface AppActionsModule {
  registerAppActions(injector: Injector): Promise<void>;
}

/**
 * Starts the app's operation buttons, `actions.json` (`business-apps.actions.ts`), from an
 * `APP_INITIALIZER`, as the menu is started (`business-apps.menu-start.ts`).
 *
 * Its own file, importing nothing, so that the module and the engine it uses load only here,
 * lazily. And so that this owns the one promise the application waits on: it never rejects, even
 * when the module's chunk cannot be fetched, since a rejected initializer stops the whole
 * application from starting, where missing buttons leave the rest of the app as it is.
 */
export async function startAppActions(
  injector: Injector,
  load: () => Promise<AppActionsModule> = () => import('./business-apps.actions'),
): Promise<void> {
  try {
    const actions = await load();
    await actions.registerAppActions(injector);
  } catch (error) {
    const message = (error as { message?: unknown } | null)?.message;
    console.warn(
      `[agentic-ui-actions] the app's operation buttons were not loaded: ${typeof message === 'string' ? message : String(error)}`,
    );
  }
}
