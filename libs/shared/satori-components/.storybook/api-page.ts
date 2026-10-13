import type { Type } from '@angular/core';
import { Markdown, Source, Title, useOf } from '@storybook/addon-docs/blocks';
import { createElement as h, Fragment, type ReactElement, type ReactNode } from 'react';

import { apiBindings, apiMethods, type ApiBinding } from './api-members';
import {
  compodoc,
  type CompodocInterface,
  type CompodocMember,
  type CompodocMethod,
} from './compodoc';

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

/** A binding's JSDoc, and for a `model()` how the two halves of `[(name)]` fit together. */
function bindingDescription(binding: ApiBinding, side: 'input' | 'output'): ReactNode {
  const text = binding.doc ? description(binding.doc) : NONE;
  if (!binding.twoWay) return text;
  const twoWay = code(`[(${binding.twoWay})]`);
  const note =
    side === 'input'
      ? h('p', null, 'Two-way: ', twoWay, ' binds it with ', code(`${binding.twoWay}Change`), '.')
      : h('p', null, 'Emits the new value of ', code(binding.twoWay), ', for ', twoWay, '.');
  return h(Fragment, null, text, note);
}

function inputsTable(inputs: readonly ApiBinding[]): ReactNode {
  if (inputs.length === 0) return h('p', null, 'None.');
  return table(
    ['Name', 'Type', 'Required', 'Default', 'Description'],
    inputs.map((input) => [
      code(input.name),
      input.doc?.type ? code(input.doc.type) : NONE,
      input.doc?.required ? 'Yes' : 'No',
      !input.doc?.required && input.doc?.defaultValue !== undefined
        ? code(input.doc.defaultValue)
        : NONE,
      bindingDescription(input, 'input'),
    ]),
  );
}

function outputsTable(outputs: readonly ApiBinding[]): ReactNode {
  if (outputs.length === 0) return h('p', null, 'None.');
  return table(
    ['Name', 'Emits', 'Description'],
    outputs.map((output) => [
      code(output.name),
      output.doc?.type ? code(output.doc.type) : NONE,
      bindingDescription(output, 'output'),
    ]),
  );
}

function methodsTable(methods: readonly CompodocMethod[]): ReactNode {
  if (methods.length === 0) return h('p', null, 'None.');
  return table(
    ['Method', 'Description'],
    methods.map((method) => [code(signature(method)), description(method)]),
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

const signature = (method: CompodocMethod): string =>
  `${method.name}(${(method.args ?? [])
    .map(
      (arg) =>
        `${arg.name}${arg.optional ? '?' : ''}: ${arg.type ?? 'unknown'}` +
        (arg.defaultValue !== undefined ? ` = ${arg.defaultValue}` : ''),
    )
    .join(', ')}): ${method.returnType ?? 'void'}`;

const missing = (what: string): ReactElement =>
  h(
    'p',
    null,
    `Compodoc has no entry for ${what}, so it cannot be listed. Storybook runs Compodoc first when ` +
      'it is started or built through Nx.',
  );

/**
 * A service's public methods, read from Compodoc: each with its signature, defaults included, and
 * its JSDoc. For an Overview page whose component is reached through a service, such as the toast.
 */
export function CompodocService({ name }: { readonly name: string }): ReactElement {
  const service = (compodoc.injectables ?? []).find((candidate) => candidate.name === name);
  if (!service) return missing(`\`${name}\``);
  return table(
    ['Method', 'Description'],
    (service.methods ?? []).map((method) => [code(signature(method)), description(method)]),
  );
}

/** The named library interfaces, each as a table of its properties, read from Compodoc. */
export function CompodocTypes({ names }: { readonly names: readonly string[] }): ReactElement {
  const known = new Map((compodoc.interfaces ?? []).map((type) => [type.name, type]));
  return h(
    Fragment,
    null,
    names.map((name) => {
      const type = known.get(name);
      return type ? interfaceSection(type) : h(Fragment, { key: name }, missing(`\`${name}\``));
    }),
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
 * The inputs and outputs are the ones Angular's compiled metadata gives the component the meta
 * names, under the names a template binds — an alias, or `<name>Change` for a `model()` — and each
 * row's type, required flag, default and JSDoc are Compodoc's, as are its public methods and the
 * library interfaces those types use, so the page cannot drift from the component. What the
 * component is for and how to use it is on its Overview page.
 */
export function ApiPage(): ReactElement {
  const { preparedMeta } = useOf('meta', ['meta']);
  const component = preparedMeta.component as Type<unknown> | undefined;
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

  const { inputs, outputs } = apiBindings(component, entry);
  const methods = apiMethods(entry);
  const types = namedInterfaces([
    ...[...inputs, ...outputs].map((binding) => binding.doc?.type ?? ''),
    ...methods.flatMap((method) => [
      ...(method.args ?? []).map((arg) => arg.type ?? ''),
      method.returnType ?? '',
    ]),
    ...(parameters?.types ?? []),
  ]);

  return h(
    Fragment,
    null,
    h(Title),
    h(
      'p',
      null,
      'The inputs, outputs and public methods of ',
      code(`<${entry.selector ?? component.name}>`),
      ', under the names a template binds; their types, defaults and descriptions are read from ',
      'the component’s source by Compodoc. Its Overview page says what it is for and how to use it.',
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
    heading('h2', 'methods', 'Methods'),
    methodsTable(methods),
    types.length > 0 ? heading('h2', 'types', 'Types') : null,
    ...types.map(interfaceSection),
  );
}
