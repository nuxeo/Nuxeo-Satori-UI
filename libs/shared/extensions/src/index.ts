export {
  EXTENSION_SLOTS,
  type ExtensionElement,
  type ExtensionSlotId,
} from './lib/extension-slots';
export {
  CORE_RULE_EVALUATORS,
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
  SECURITY_RELEVANT_RULE_IDS,
  type ExtensionRule,
  type ExtensionRuleContext,
  type ExtensionRuleEvaluator,
  type ExtensionRuleRef,
  type ExtensionRuleResolver,
} from './lib/extension-rules';
export {
  ExtensionSlotRegistry,
  NO_EXTENSION_SLOT_OVERRIDES,
  type ExtensionOverride,
  type ExtensionSlotOverrides,
} from './lib/extension-slot-registry.service';
export {
  mergeExtensionConfigs,
  readExtensionConfig,
  resolveExtensionConfig,
  type ExtensionConfig,
  type ExtensionLayerResolver,
  type RefusedExtensionEntry,
  type ResolvedExtensionConfig,
} from './lib/extension-config';
export { DOCUMENT_RULE_EVALUATORS } from './lib/document-rules';
export { SURFACE_RULE_EVALUATORS } from './lib/surface-rules';
export {
  descriptorLabel,
  ExtensionActionRegistry,
  type ExtensionActionDescriptor,
  type ExtensionActionHandler,
  type ExtensionActionRegistration,
  type DocumentLayoutChange,
  type ExtensionColumnDescriptor,
  type ExtensionDocumentLayoutDescriptor,
  type ExtensionDocumentViewDescriptor,
  type ExtensionRouteDescriptor,
  type ExtensionTabDescriptor,
} from './lib/extension-actions';
export {
  PACKAGED_BROWSE_CONTEXT_MENU,
  PACKAGED_BULK_ACTIONS,
  PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
  PACKAGED_ROW_ACTIONS,
} from './lib/packaged-actions';
export { PACKAGED_DOCUMENT_TABS } from './lib/packaged-tabs';
export { PACKAGED_BROWSE_COLUMNS } from './lib/packaged-columns';
export {
  extensionRoutes,
  provideExtensionRoutes,
  type ExtensionRoutesOptions,
} from './lib/extension-routes';
export {
  extensionRoutePathRejection,
  partitionExtensionRouteDescriptors,
  type PartitionedExtensionRoutes,
  type RejectedExtensionRoute,
} from './lib/extension-route-paths';
export { ExtensionRuleContextService } from './lib/extension-rule-context.service';
export {
  ExtensionComponentRegistry,
  type ExtensionComponentSource,
} from './lib/extension-component-registry.service';
export { ExtensionOutletComponent } from './lib/extension-outlet.component';
export { AppExtensionsService } from './lib/app-extensions.service';
export {
  provideSatoriExtensions,
  type SatoriExtensionContributions,
  type SatoriExtensionContributor,
} from './lib/provide-satori-extensions';
export { APP_NAV_ITEMS, PACKAGED_NAV_ITEMS, type NavItemDescriptor } from './lib/nav-items';
export { DescriptorLabelPipe, type LabelledDescriptor } from './lib/descriptor-label.pipe';
