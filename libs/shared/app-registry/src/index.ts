/**
 * The client of the app registry in `nuxeo-agentic-core`: the apps the person signed in may see,
 * the one open, and where each file of its definition is read from
 * (docs/business-apps/app-definition-v2.md, section 13).
 */
export {
  APP_REGISTRY_FORMAT,
  labelLanguagesOf,
  readAppRegistry,
  type AppRegistryListing,
  type RegistryApp,
  type RegistryDiagnostic,
} from './lib/app-registry-file';
export {
  APP_DEFINITION_FILES,
  APP_REGISTRY_CHOICE_KEY,
  APP_REGISTRY_PATH,
  APP_REGISTRY_RELOAD,
  APP_REGISTRY_STORAGE,
  APP_REGISTRY_TIMEOUT_MS,
  AppRegistryService,
  chooseApp,
  type AppDefinitionFiles,
  type AppRegistryState,
} from './lib/app-registry.service';
