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
export { addressTakenById, APP_ID, APP_V2_KEYS, validateApp, type AppOptions } from './lib/app';
export { DATE_RULE_MAX_DAYS, MAX_NESTING, TEMPLATE_MAX_LENGTH, type Finding } from './lib/checker';
export {
  propertiesOf,
  propertyTypeOf,
  readContentModel,
  type ContentModel,
  type ContentModelReading,
  type DocumentTypeModel,
  type FacetModel,
  type PropertyModel,
  type SchemaModel,
} from './lib/content-model';
export {
  HOME_LIST_LIMIT,
  HOME_PAGE,
  HOME_RECENT_MAX_TYPES,
  HOME_V2_KEYS,
  NAVIGATION_V2_KEYS,
  validateHome,
  validateNavigation,
  type HomeOptions,
} from './lib/home';
export { LABELS_V2_KEYS, validateLabels, validateModuleSettings } from './lib/labels';
export {
  BANNER_TONES,
  CONNECTOR_FIELD,
  CONNECTOR_ID,
  LAYOUT_MODES,
  LAYOUT_V2_KEYS,
  heldToModel,
  loadable,
  publishable,
  validateLayoutV2,
  validateTaskForm,
  type LayoutMode,
  type ValidationOptions,
} from './lib/layout-v2';
export { CHECKLIST_SUBFIELDS } from './lib/layout-model';
export {
  placeFile,
  validateFile,
  withPackageActions,
  type PackageContext,
  type PackageFile,
  type PackageOptions,
  type PlacedFile,
} from './lib/package';
export { PLATFORM_ROUTES } from './lib/platform-routes';
export { QUEUE_V2_KEYS, validateQueue } from './lib/queue';
export {
  APP_RULES,
  CORE_RULES,
  EXTERNAL_WIDGETS,
  PACKAGED_BULK_ACTIONS,
  PACKAGED_CHECKS,
  PACKAGED_COMPUTATIONS,
  PACKAGED_MODULES,
  PACKAGED_PAGES,
  PACKAGED_REGISTRIES,
  PACKAGED_ROW_ACTIONS,
  PACKAGED_WIDGETS,
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
