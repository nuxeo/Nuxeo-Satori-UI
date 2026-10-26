/**
 * The avatar colours, as **our own** type.
 *
 * ## Why not just return `SatAvatarCategory`
 *
 * `avatarColor` used to be typed `(name: string) => SatAvatarCategory`, and that shipped
 * two problems in one signature.
 *
 * The first is the rule: a third-party design-system type has no business in our public
 * API, for the same reason `AGENTS/11-beta-program.md` §7 forbids adf-hx types there. A
 * customer writing against `@nuxeo/satori-platform/nuxeo-client` should not have to know
 * that our avatars come from a design system, and we should be free to change that without
 * it being a breaking change for them.
 *
 * The second is worse and was concrete: **the published declarations did not compile.**
 * ng-packagr's rollup dropped the `import` and emitted
 *
 *     declare function avatarColor(name: string): SatAvatarCategory;
 *
 * with `SatAvatarCategory` declared nowhere in the file. Every customer annotating that
 * result got `TS2304: Cannot find name 'SatAvatarCategory'`. `beta:fork` did not catch it
 * because the app template never calls `avatarColor`, and the API snapshot recorded the
 * broken signature as the baseline. `beta:publishable` now typechecks the shipped
 * declarations themselves, which is the check that sees this class of defect.
 *
 * ## Staying compatible, without importing the design system
 *
 * The union must remain exactly upstream's `SatAvatarCategory`, because the values are
 * handed straight to `<sat-avatar [category]>`. The two-way assertion that holds it there is
 * in `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.ts`, which imports both types
 * and is compiled by every build, CI's included.
 *
 * It is not here because this library's shipped sources may not import a design-system
 * package, not even a type: `libs/shared/satori-components` is allowed to import
 * `@nuxeo/satori-platform/nuxeo-client` (it does not yet), and its guardrail follows imports
 * transitively and would reject any `@hylandsoftware/*` reached through this barrel.
 */
export type AvatarColor =
  'purple' | 'blue' | 'pink' | 'teal' | 'yellow' | 'green' | 'red' | 'orange';

const AVATAR_PALETTE: readonly AvatarColor[] = [
  'purple',
  'blue',
  'pink',
  'teal',
  'yellow',
  'green',
  'red',
  'orange',
];

/**
 * Deterministic color for a username so the same user always gets
 * the same avatar color across the application.
 */
export function avatarColor(name: string): AvatarColor {
  if (!name) return 'blue';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
