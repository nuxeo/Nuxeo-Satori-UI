import { describe, expect, it } from 'vitest';
import { administrationRoutes, AdministrationShellComponent } from './index';
import { administrationRoutes as routes } from './lib/lib.routes';
import { AdministrationShellComponent as ShellComponent } from './lib/administration-shell/administration-shell.component';

describe('administration public entry point', () => {
  it('exports the feature routes and shell', () => {
    expect(administrationRoutes).toBe(routes);
    expect(AdministrationShellComponent).toBe(ShellComponent);
  });
});
