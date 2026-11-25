import { HttpErrorResponse } from '@angular/common/http';
import type { Injector } from '@angular/core';
import { AppRegistryService } from '@agentic-ui/shared/app-registry';
import { AppActionsService } from '@agentic-ui/shared/document-layouts';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { firstValueFrom } from 'rxjs';

function warn(message: string): void {
  console.warn(`[agentic-ui-actions] ${message}`);
}

/**
 * The app's operation buttons, its `actions.json` (docs/business-apps/app-definition-v2.md,
 * section 5), registered for the record page's toolbar and a queue's rows (`AppActionsService`).
 *
 * Read from the app registry alone, for the app open: the registry serves the file with only the
 * actions the server's allow-list lets run, and a button runs through `AgenticUi.RunAction`,
 * which names the app. So with no app open, before sign-in or on a server with no registry, there
 * is nothing to register: no server would run them. The development server never serves the file:
 * a file `npm run config:dev` wrote would be one the server's allow-list had not filtered.
 *
 * Loaded once, at startup, by an `APP_INITIALIZER` that imports this file lazily
 * (`business-apps.actions-start.ts`): the toolbar and the row actions are plain registries, read
 * when a page is drawn, so a button registered after that would not show until the page is drawn
 * again. Startup waits for the read, with the registry's 10-second timeout. Never rejects.
 */
export async function registerAppActions(injector: Injector): Promise<void> {
  try {
    // First: the registry reads the API's origin from the configuration once, and keeps it.
    await injector.get(AppConfigService).load();
    const registry = injector.get(AppRegistryService);
    await registry.load();
    const app = registry.current();
    if (!app || !app.files.includes('actions.json')) return;
    const content = await firstValueFrom(registry.file('actions.json', null));
    injector.get(AppActionsService).register(app.id, content);
  } catch (error) {
    const reason =
      error instanceof HttpErrorResponse
        ? `HTTP ${error.status}`
        : ((error as Error)?.message ?? String(error));
    warn(`actions.json not applied: ${reason}; the app's operation buttons are not offered`);
  }
}
