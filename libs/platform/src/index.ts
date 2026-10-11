/**
 * `@nuxeo-satori/platform` — the package root.
 *
 * The API lives in **entry points**, not here, so that importing the extension
 * contract does not drag the Nuxeo client or Angular Material in with it:
 *
 * | Entry point                            | What it is                                          |
 * | -------------------------------------- | --------------------------------------------------- |
 * | `@nuxeo-satori/platform/extensions`    | Layer 1/2 — slots, rules, actions, registration      |
 * | `@nuxeo-satori/platform/app-config`    | Layer 0 — bootstrap config and the runtime manifest  |
 * | `@nuxeo-satori/platform/components`    | `nxs-` components, Material-backed, no Satori import |
 * | `@nuxeo-satori/platform/components-satori` | The same IDs on Satori; the only Satori import   |
 * | `@nuxeo-satori/platform/nuxeo-client`  | Nuxeo REST services and document models             |
 * | `@nuxeo-satori/platform/ui`            | Shared components and dialogs                       |
 *
 * Shipping as one versioned package with sub-entry points, rather than four
 * packages, is deliberate: the distribution model in `docs/adf-hx-beta-plan.md`
 * promises that an upgrade is "an npm version bump for the platform", and four
 * independently versioned packages would make that four bumps and a
 * cross-compatibility matrix. It is also the shape `@alfresco/adf-hx-content-services`
 * itself ships in, which this codebase already consumes.
 */

/**
 * The entry point subpaths this package publishes, without the package name.
 *
 * Exported because it is checked: `platform-entry-points.spec.ts` asserts this
 * list against the `ng-package.json` files actually on disk, so it cannot drift
 * into documenting an entry point that does not ship — or omitting one that does.
 */
export const PLATFORM_ENTRY_POINTS = Object.freeze([
  'app-config',
  'components',
  'components-satori',
  'extensions',
  'nuxeo-client',
  'ui',
] as const);

/** A subpath of {@link PLATFORM_ENTRY_POINTS}. */
export type PlatformEntryPoint = (typeof PLATFORM_ENTRY_POINTS)[number];
