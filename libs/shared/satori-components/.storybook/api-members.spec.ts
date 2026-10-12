import { reflectComponentType, type Type } from '@angular/core';

import * as library from '../src/index';
import { apiBindings, apiMethods, joinBindings, type ReflectedBindings } from './api-members';
import { compodoc, type CompodocComponent, type CompodocMember } from './compodoc';

/**
 * Every component the library's entry point exports, by its exported name — which is its class
 * name, as the API page reads it in Storybook. Under Vitest's transform a decorated class can be
 * renamed (`NxsActionMenuComponent2`), so `component.name` is not used here.
 */
const COMPONENTS = Object.entries(library).flatMap(([name, value]): [string, Type<unknown>][] =>
  typeof value === 'function' && reflectComponentType(value as Type<unknown>) !== null
    ? [[name, value as Type<unknown>]]
    : [],
);

function entryFor(name: string): CompodocComponent {
  const entry = compodoc.components.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`Compodoc has no entry for ${name}`);
  return entry;
}

function templateNames(component: Type<unknown>, side: 'inputs' | 'outputs'): string[] {
  const mirror = reflectComponentType(component);
  if (!mirror) throw new Error('Not a component');
  return mirror[side].map((binding) => binding.templateName).sort((a, b) => a.localeCompare(b));
}

describe('the API page', () => {
  it('reads the components the entry point exports', () => {
    expect(COMPONENTS.map(([name]) => name)).toContain('NxsFavoriteToggleComponent');
    expect(COMPONENTS.length).toBeGreaterThanOrEqual(15);
  });

  describe.each(COMPONENTS)('%s', (name, component) => {
    const { inputs, outputs } = apiBindings(component, entryFor(name));

    it('lists each output under the name a template binds, and nothing else', () => {
      expect(outputs.map((output) => output.name)).toEqual(templateNames(component, 'outputs'));
    });

    it('lists each input under the name a template binds, and nothing else', () => {
      expect(inputs.map((input) => input.name)).toEqual(templateNames(component, 'inputs'));
    });

    it('describes every input and output from Compodoc', () => {
      const undocumented = [...inputs, ...outputs].filter((binding) => !binding.doc);
      expect(undocumented.map((binding) => binding.name)).toEqual([]);
    });
  });

  it('names a model() output for the event a template binds, and marks it two-way', () => {
    const entry = entryFor('NxsFavoriteToggleComponent');
    const { inputs, outputs } = apiBindings(library.NxsFavoriteToggleComponent, entry);

    expect(outputs.map((output) => output.name)).toEqual(['changed', 'failed', 'favoriteChange']);
    expect(outputs.find((output) => output.name === 'favoriteChange')).toMatchObject({
      twoWay: 'favorite',
      doc: { name: 'favorite', type: 'boolean' },
    });
    expect(inputs.find((input) => input.name === 'favorite')).toMatchObject({ twoWay: 'favorite' });
    expect(inputs.find((input) => input.name === 'documentId')?.twoWay).toBeUndefined();
  });

  it('lists a component’s public methods, and not its protected ones', () => {
    // `press()` on the favorite toggle and `toggle()` on the rich tooltip are protected.
    expect(apiMethods(entryFor('NxsFavoriteToggleComponent')).map((method) => method.name)).toEqual(
      ['toggle'],
    );
    expect(apiMethods(entryFor('NxsRichTooltipComponent'))).toEqual([]);
  });

  // The library's lint forbids aliases, so none of its components has one to check against.
  describe('with aliases', () => {
    /**
     * What `reflectComponentType` reports for `size = input(1, { alias: 'diameter' })`,
     * `picked = output<string>({ alias: 'choose' })` and `value = model(0)`.
     */
    const mirror: ReflectedBindings = {
      inputs: [
        { propName: 'size', templateName: 'diameter' },
        { propName: 'value', templateName: 'value' },
      ],
      outputs: [
        { propName: 'picked', templateName: 'choose' },
        { propName: 'value', templateName: 'valueChange' },
      ],
    };

    // As Compodoc 2 writes them: an aliased member under its alias, a model() under its property.
    const diameter: CompodocMember = { name: 'diameter', type: 'number', defaultValue: '1' };
    const value: CompodocMember = { name: 'value', type: 'number', defaultValue: '0' };
    const choose: CompodocMember = { name: 'choose', type: 'string' };
    const entry: CompodocComponent = {
      name: 'ProbeComponent',
      inputsClass: [diameter, value],
      outputsClass: [choose, value],
    };

    it('joins each binding to Compodoc’s entry by alias, or by property for a model()', () => {
      expect(joinBindings(mirror, entry)).toEqual({
        inputs: [
          { name: 'diameter', doc: diameter },
          { name: 'value', doc: value, twoWay: 'value' },
        ],
        outputs: [
          { name: 'choose', doc: choose },
          { name: 'valueChange', doc: value, twoWay: 'value' },
        ],
      });
    });

    it('falls back to Compodoc’s names for a class Angular does not know as a component', () => {
      class NotAComponent {}

      expect(apiBindings(NotAComponent, entry)).toEqual({
        inputs: [
          { name: 'diameter', doc: diameter },
          { name: 'value', doc: value },
        ],
        outputs: [
          { name: 'choose', doc: choose },
          { name: 'value', doc: value },
        ],
      });
    });
  });
});
