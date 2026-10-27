import { expect, test } from './fixtures';

const NAV_LIST = 'sat-platform-nav nav.sat-platform-nav-list';
const MENU_ITEM = `${NAV_LIST} a[sat-platform-nav-menu-item]`;
const EXPAND = '[data-automation-id="platform-nav-expand-button"]';
const CLIPBOARD = 'a[sat-platform-nav-menu-item][data-nav-id="app.navbar.clipboard"]';
const TRASH = 'a[sat-platform-nav-menu-item][data-nav-id="app.navbar.trash"]';
const ADMINISTRATION = 'a[sat-platform-nav-menu-item][data-nav-id="app.navbar.administration"]';

/**
 * The rail is a vertical CDK menubar with a roving tabindex: Tab enters it once, at a single
 * entry, and the arrow keys move between entries. A second Tab leaves the rail, so the bottom
 * entries are reached with ArrowDown, and each must scroll fully into view as it takes focus.
 */
test('Arrow keys reach unobscured Trash and Administration links on a short rail', async ({
  signedIn: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto('/#/browse', { waitUntil: 'networkidle' });

  const list = page.locator(NAV_LIST);
  const clipboard = page.locator(CLIPBOARD);
  const trash = page.locator(TRASH);
  const administration = page.locator(ADMINISTRATION);

  await expect(list).toBeVisible();
  await expect(clipboard).toBeVisible();
  await expect(trash).toBeVisible();
  await expect(administration).toBeVisible();
  await expect
    .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);

  const expectUnobscuredInList = async (item: typeof trash) => {
    const unobscured = await item.evaluate((element) => {
      const navList = element.closest('nav.sat-platform-nav-list');
      if (!navList) {
        return false;
      }

      const itemRect = element.getBoundingClientRect();
      const listRect = navList.getBoundingClientRect();
      const hit = document.elementFromPoint(
        itemRect.left + itemRect.width / 2,
        itemRect.top + itemRect.height / 2,
      );

      return (
        itemRect.top >= listRect.top - 1 &&
        itemRect.bottom <= listRect.bottom + 1 &&
        (hit === element || element.contains(hit))
      );
    });

    expect(unobscured).toBe(true);
  };

  await page.locator(EXPAND).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(`${MENU_ITEM}:focus`)).toHaveCount(1);

  await page.keyboard.press('Home');
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);

  for (let step = 0; step < 20; step++) {
    if (await trash.evaluate((element) => element === document.activeElement)) {
      break;
    }
    await page.keyboard.press('ArrowDown');
  }
  await expect(trash).toBeFocused();
  await expectUnobscuredInList(trash);

  await page.keyboard.press('ArrowDown');
  await expect(administration).toBeFocused();
  await expectUnobscuredInList(administration);
});
