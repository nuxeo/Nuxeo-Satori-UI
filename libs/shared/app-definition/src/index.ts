/**
 * The app definition's contract: what a configuration package's files may say, checked the same
 * way by the package pipeline, the app when it loads them, the designer, the agent and the Studio
 * migration. Phase 0 starts it with layout file version 2 (docs/business-apps/layout-v2.md).
 *
 * The command line in `cli.ts` is not exported: it reads files with Node, and nothing in the
 * browser needs it.
 */
export {
  LAYOUT_MODES,
  LAYOUT_V2_KEYS,
  loadable,
  publishable,
  validateLayoutV2,
  type Finding,
  type LayoutMode,
  type ValidationOptions,
} from './lib/layout-v2';
export {
  APP_RULES,
  CORE_RULES,
  PACKAGED_CHECKS,
  PACKAGED_COMPUTATIONS,
  PACKAGED_REGISTRIES,
  PACKAGED_ROW_ACTIONS,
  PACKAGED_WIDGETS,
  PROPOSED_RULES,
  withRegistered,
  type ParameterKind,
  type PropertyType,
  type Registries,
  type Signature,
  type WidgetDefinition,
} from './lib/registries';
