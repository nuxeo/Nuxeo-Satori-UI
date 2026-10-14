import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionComponentRegistry,
  type ExtensionDocumentLayoutDescriptor,
  type ExtensionRuleContext,
} from '@nuxeo-satori/platform/extensions';
import type { NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { LayoutMode } from './layout.model';

/**
 * The entry that replaces a type's layout in one mode, or `null` for the layout itself: the first,
 * by order, whose rule passes and whose component this build has. Each mode is its own slot, and
 * each is resolved by name so the reference check can see it is read.
 */
export function layoutSlotEntry(
  extensions: AppExtensionsService,
  components: ExtensionComponentRegistry,
  mode: LayoutMode,
  context: ExtensionRuleContext,
): ExtensionDocumentLayoutDescriptor | null {
  const entries =
    mode === 'metadata'
      ? extensions.resolve<ExtensionDocumentLayoutDescriptor>(
          EXTENSION_SLOTS.documentMetadata,
          context,
        )
      : mode === 'edit'
        ? extensions.resolve<ExtensionDocumentLayoutDescriptor>(
            EXTENSION_SLOTS.documentEdit,
            context,
          )
        : extensions.resolve<ExtensionDocumentLayoutDescriptor>(
            EXTENSION_SLOTS.documentCreate,
            context,
          );
  return entries.find((entry) => components.has(entry.componentId ?? entry.id)) ?? null;
}

/**
 * What a create form's rules read as the document: the type being created, in the folder it is
 * created in. Rules such as `app.rules.isType` then answer for the new document, not for the folder.
 */
export function documentToCreate(type: string, parentPath: string | null): NuxeoDocument {
  const folder = parentPath ? parentPath.replace(/\/+$/, '') : '';
  return {
    uid: '',
    title: '',
    type,
    path: `${folder}/`,
    lastModified: '',
    properties: {},
    facets: [],
  };
}
