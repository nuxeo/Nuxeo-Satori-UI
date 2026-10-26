import type { ExtensionTabDescriptor } from './extension-actions';

/**
 * The document-detail tabs.
 *
 * The same six tabs, in the same order, with the same labels and the same
 * gating that `document-detail.html` held as fixed `<mat-tab>` children. The
 * AI tab's `@if (featureFlags.aiEnabled())` is now `app.rules.isAiEnabled`,
 * which reads the same flag through the rule context, so a manifest can gate
 * the tab as well as the feature flag can.
 *
 * The five bodies remain markup in the host template and are matched by id. A
 * tab a customer adds names a registered component instead — see
 * `ExtensionTabDescriptor.componentId`. That asymmetry is deliberate: extracting
 * a thousand lines of tab body into separately registered components would be a
 * rewrite, and this makes the tab strip addressable without one.
 */
export const PACKAGED_DOCUMENT_TABS: readonly ExtensionTabDescriptor[] = [
  { id: 'app.tabs.view', labelKey: 'tab.tabs-view', label: 'View', order: 10 },
  { id: 'app.tabs.annotations', labelKey: 'tab.tabs-annotations', label: 'Annotations', order: 20 },
  { id: 'app.tabs.permissions', labelKey: 'tab.tabs-permissions', label: 'Permissions', order: 30 },
  { id: 'app.tabs.history', labelKey: 'tab.tabs-history', label: 'History', order: 40 },
  { id: 'app.tabs.publishing', labelKey: 'tab.tabs-publishing', label: 'Publishing', order: 50 },
  {
    id: 'app.tabs.aiInsights',
    labelKey: 'tab.tabs-ai-insights',
    label: 'AI Insights',
    icon: 'ai',
    order: 60,
    rule: 'app.rules.isAiEnabled',
  },
];
