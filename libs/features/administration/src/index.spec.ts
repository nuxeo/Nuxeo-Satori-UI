import { AdministrationShellComponent, administrationRoutes } from './index';

describe('administration public API', () => {
  it('exports routes rooted at the public administration shell', () => {
    expect(administrationRoutes).toHaveLength(1);
    expect(administrationRoutes[0].path).toBe('');
    expect(administrationRoutes[0].component).toBe(AdministrationShellComponent);
  });

  it('preserves the analytics landing route', () => {
    expect(administrationRoutes[0].children).toContainEqual({
      path: '',
      pathMatch: 'full',
      redirectTo: 'analytics',
    });
  });
});
