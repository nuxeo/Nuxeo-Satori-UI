import { Markdown, Source, Title, useOf } from '@storybook/addon-docs/blocks';
import { createElement as h, Fragment, type ReactElement, type ReactNode } from 'react';

import { compodoc, type CompodocInterface, type CompodocMember } from './compodoc';

/** Every component documented here is imported from this entry point. */
const ENTRY_POINT = '@nuxeo-satori/platform/components';

const NONE = '—';

/** What a story file's meta may add under `parameters.docs.api`. */
interface ApiParameters {
  /** Interfaces to list under "Types" that no input or output names, such as a dialog's data. */
  readonly types?: readonly string[];
}

const code = (text: string): ReactElement => h('code', null, text);

const description = (member: CompodocMember): ReactNode => {
  const text = member.rawdescription?.trim();
  return text ? h(Markdown, null, text) : NONE;
};

function table(headers: readonly string[], rows: readonly (readonly ReactNode[])[]): ReactElement {
  return h(
    'table',
    null,
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        headers.map((header) => h('th', { key: header, scope: 'col' }, header)),
      ),
    ),
    h(
      'tbody',
      null,
      rows.map((cells, row) =>
        h(
          'tr',
          { key: row },
          cells.map((cell, column) => h('td', { key: column }, cell)),
        ),
      ),
    ),
  );
}

const heading = (level: 'h2' | 'h3', id: string, text: string): ReactElement =>
  h(level, { id }, text);

function inputsTable(inputs: readonly CompodocMember[]): ReactNode {
  if (inputs.length === 0) return h('p', null, 'None.');
  return table(
    ['Name', 'Type', 'Required', 'Default', 'Description'],
    inputs.map((input) => [
      code(input.name),
      input.type ? code(input.type) : NONE,
      input.required ? 'Yes' : 'No',
      !input.required && input.defaultValue !== undefined ? code(input.defaultValue) : NONE,
      description(input),
    ]),
  );
}

function outputsTable(outputs: readonly CompodocMember[]): ReactNode {
  if (outputs.length === 0) return h('p', null, 'None.');
  return table(
    ['Name', 'Emits', 'Description'],
    outputs.map((output) => [
      code(output.name),
      output.type ? code(output.type) : NONE,
      description(output),
    ]),
  );
}

function interfaceSection(type: CompodocInterface): ReactElement {
  const properties = type.properties ?? [];
  return h(
    Fragment,
    { key: type.name },
    heading('h3', `type-${type.name.toLowerCase()}`, type.name),
    type.rawdescription?.trim() ? h(Markdown, null, type.rawdescription.trim()) : null,
    table(
      ['Property', 'Type', 'Required', 'Description'],
      properties.map((property) => [
        code(property.name),
        property.type ? code(property.type) : NONE,
        property.optional ? 'No' : 'Yes',
        description(property),
      ]),
    ),
  );
}

/** The interfaces Compodoc documents that `typeTexts` name, in the order first named. */
function namedInterfaces(typeTexts: readonly string[]): CompodocInterface[] {
  const known = new Map((compodoc.interfaces ?? []).map((type) => [type.name, type]));
  const found = new Map<string, CompodocInterface>();
  for (const text of typeTexts) {
    for (const [name] of text.matchAll(/\b[A-Z]\w*\b/g)) {
      const type = known.get(name);
      if (type && !found.has(name)) found.set(name, type);
    }
  }
  return [...found.values()];
}

/**
 * The API page: the `autodocs` page of every story file, renamed in `main.ts`.
 *
 * Every row is read from Compodoc's output for the component the meta names — its inputs with
 * their type, whether they are required, their default and their JSDoc, its outputs with what they
 * emit, and the library interfaces those types use — so the page cannot drift from the component.
 * What the component is for and how to use it is on its Overview page.
 */
export function ApiPage(): ReactElement {
  const { preparedMeta } = useOf('meta', ['meta']);
  const component = preparedMeta.component as { readonly name?: string } | undefined;
  const parameters = (preparedMeta.parameters['docs'] as { api?: ApiParameters } | undefined)?.api;
  const entry = compodoc.components.find((candidate) => candidate.name === component?.name);

  if (!component?.name || !entry) {
    return h(
      Fragment,
      null,
      h(Title),
      h(
        'p',
        null,
        'Compodoc has no entry for this component, so its inputs and outputs cannot be listed. ' +
          'Storybook runs Compodoc first when it is started or built through Nx.',
      ),
    );
  }

  const inputs = entry.inputsClass ?? [];
  const outputs = entry.outputsClass ?? [];
  const types = namedInterfaces([
    ...inputs.map((input) => input.type ?? ''),
    ...outputs.map((output) => output.type ?? ''),
    ...(parameters?.types ?? []),
  ]);

  return h(
    Fragment,
    null,
    h(Title),
    h(
      'p',
      null,
      'The inputs and outputs of ',
      code(`<${entry.selector ?? component.name}>`),
      ', read from the component’s source by Compodoc. Its Overview page says what it is for and ',
      'how to use it.',
    ),
    h(Source, {
      language: 'typescript',
      dark: true,
      code: `import { ${component.name} } from '${ENTRY_POINT}';`,
    }),
    heading('h2', 'inputs', 'Inputs'),
    inputsTable(inputs),
    heading('h2', 'outputs', 'Outputs'),
    outputsTable(outputs),
    types.length > 0 ? heading('h2', 'types', 'Types') : null,
    ...types.map(interfaceSection),
  );
}
