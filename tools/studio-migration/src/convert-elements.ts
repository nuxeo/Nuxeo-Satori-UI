/**
 * M3's part of the conversion, the code track (docs/business-apps/studio-migration.md, section 4):
 * each custom element of the package is proposed as a Layer 2 plugin, a library of its own that an
 * agent writes with the `plugin` command and the `studio-plugin` skill, built into the customer's
 * app from the template (decision 5 keeps that build until signed, pinned plugins are proven).
 *
 * The conversion writes no plugin and no configuration for one. It names the library the plugin
 * is written to, and the report lists the element as `proposed` with it until a person accepts it,
 * which check 9 must pass first: so a plugin a person has not accepted is never ready.
 */
import type { ConvertContext } from './convert';
import type { CustomElement } from './elements';

/** Where the plugin of a custom element is written, in the customer's copy of the repository. */
export const PLUGIN_DIRECTORY = 'libs/extensions';

/** The library a custom element's plugin is written to: `libs/extensions/<element>`. */
export function pluginLibraryOf(element: Pick<CustomElement, 'name'>): string {
  return `${PLUGIN_DIRECTORY}/${element.name}`;
}

export function convertElements(context: ConvertContext): void {
  for (const element of context.inventory.customElements) {
    const library = pluginLibraryOf(element);
    const used =
      element.uses.length > 0
        ? `It is used in ${element.uses.join(', ')}, where the plugin shows once a person places it`
        : 'Nothing in the package uses it';
    const read =
      element.definition === 'polymer'
        ? ''
        : ". Its script is not Polymer's Polymer({ is }) definition, so its properties are a person's to read";
    context.decide(`custom-element:${element.path}#${element.index + 1}`, {
      outcome: 'proposed',
      to: library,
      note: `An agent writes it as a Layer 2 plugin, ${library}, with the plugin command, built into the app from the template; check 9 holds the plugin to the element, and a person accepts it. ${used}${read}`,
    });
  }
}

/** The custom element of the package an element name is, if any. */
export function customElementNamed(
  elements: readonly CustomElement[],
  name: string,
): CustomElement | undefined {
  return elements.find((element) => element.name === name);
}
