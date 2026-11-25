import { LAYOUT_DESIGNER_PATH } from '../../platform-nav-items';
import { adminDrawerPathActive } from './nav-drawer-admin-active';

describe('adminDrawerPathActive', () => {
  it("marks Layout Designer on its queues' page, below it, as on its own", () => {
    expect(adminDrawerPathActive(LAYOUT_DESIGNER_PATH, LAYOUT_DESIGNER_PATH)).toBe(true);
    expect(adminDrawerPathActive(`${LAYOUT_DESIGNER_PATH}/queues`, LAYOUT_DESIGNER_PATH)).toBe(
      true,
    );
    expect(adminDrawerPathActive(`${LAYOUT_DESIGNER_PATH}-x`, LAYOUT_DESIGNER_PATH)).toBe(false);
  });

  it("marks Users & Groups on a user's page, and any other entry on its own page alone", () => {
    expect(
      adminDrawerPathActive(
        '/administration/users-groups/user/ada',
        '/administration/users-groups',
      ),
    ).toBe(true);
    expect(adminDrawerPathActive('/administration/audit?x=1', '/administration/audit')).toBe(true);
    expect(adminDrawerPathActive('/administration/audit/more', '/administration/audit')).toBe(
      false,
    );
    expect(
      adminDrawerPathActive(`${LAYOUT_DESIGNER_PATH}/queues`, '/administration/analytics'),
    ).toBe(false);
  });
});
