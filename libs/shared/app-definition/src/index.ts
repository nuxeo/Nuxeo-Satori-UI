/**
 * The app definition's contract: what a configuration package's files may say, checked the same
 * way by the package pipeline, the app when it loads them, the designer, the agent and the Studio
 * migration. Layout file version 2 is docs/business-apps/layout-v2.md; the other files are
 * docs/business-apps/app-definition-v2.md.
 *
 * The command line in `cli.ts` is not exported: it reads files with Node, and nothing in the
 * browser needs it.
 */
export { ACTIONS_V2_KEYS, PLACEMENTS, validateActions, type ActionsOptions } from './lib/actions';
export { APP_V2_KEYS, validateApp, type AppOptions } from './lib/app';
export { type Finding } from './lib/checker';
export { LABELS_V2_KEYS, validateLabels, validateModuleSettings } from './lib/labels';
export {
  LAYOUT_MODES,
  LAYOUT_V2_KEYS,
  loadable,
  publishable,
  validateLayoutV2,
  validateTaskForm,
  type LayoutMode,
  type ValidationOptions,
} from './lib/layout-v2';
export {
  placeFile,
  validateFile,
  withPackageActions,
  type PackageContext,
  type PackageFile,
  type PackageOptions,
  type PlacedFile,
} from './lib/package';
export { QUEUE_V2_KEYS, validateQueue } from './lib/queue';
export {
  APP_RULES,
  CORE_RULES,
  PACKAGED_BULK_ACTIONS,
  PACKAGED_CHECKS,
  PACKAGED_COMPUTATIONS,
  PACKAGED_MODULES,
  PACKAGED_REGISTRIES,
  PACKAGED_ROW_ACTIONS,
  PACKAGED_WIDGETS,
  PROPOSED_RULES,
  XPATH,
  isFieldReference,
  isRecord,
  withRegistered,
  type ParameterKind,
  type PropertyType,
  type Registries,
  type Signature,
  type WidgetDefinition,
} from './lib/registries';
