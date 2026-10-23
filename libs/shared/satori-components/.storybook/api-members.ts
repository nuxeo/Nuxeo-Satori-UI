import { reflectComponentType, type Type } from '@angular/core';

import type { CompodocComponent, CompodocMember, CompodocMethod } from './compodoc';

/** One input or output of a component, under the name a template binds it by. */
export interface ApiBinding {
  /** What a template writes: an alias when there is one, `<name>Change` for a `model()`'s output. */
  readonly name: string;
  /** Compodoc's entry for the member behind it — its type, default and JSDoc — when there is one. */
  readonly doc?: CompodocMember;
  /** For an input or output of a `model()`: the input a template binds two-way, `[(name)]`. */
  readonly twoWay?: string;
}

/** An input or output as `reflectComponentType` reports it. */
interface Reflected {
  readonly propName: string;
  readonly templateName: string;
}

/** The parts of `reflectComponentType`'s mirror the page reads. */
export interface ReflectedBindings {
  readonly inputs: readonly Reflected[];
  readonly outputs: readonly Reflected[];
}

/** A component's inputs and outputs, as the API page lists them. */
export interface ApiBindings {
  readonly inputs: ApiBinding[];
  readonly outputs: ApiBinding[];
}

/**
 * Angular's bindings for one side of a component, each joined to Compodoc's entry for it.
 *
 * Compodoc names an aliased `input()` or `output()` by its alias but a `model()`'s output by the
 * property, so an entry is found by the template name first and by the property name after.
 */
function join(
  bindings: readonly Reflected[],
  docs: readonly CompodocMember[] | undefined,
  models: ReadonlyMap<string, string>,
): ApiBinding[] {
  const byName = new Map((docs ?? []).map((doc) => [doc.name, doc]));
  return bindings
    .map(({ propName, templateName }) => {
      const doc = byName.get(templateName) ?? byName.get(propName);
      const twoWay = models.get(propName);
      return { name: templateName, ...(doc ? { doc } : {}), ...(twoWay ? { twoWay } : {}) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A component's inputs and outputs as Angular binds them, from its compiled metadata, with what
 * Compodoc read from the source for each.
 *
 * Compodoc lists a `model()` as an output under the property's name, which is not an event a
 * template can bind, and Angular's metadata is what a template is checked against. A class Angular
 * does not know as a component falls back to Compodoc's names.
 */
export function apiBindings(
  component: Type<unknown> | undefined,
  entry: CompodocComponent,
): ApiBindings {
  const mirror = component ? reflectComponentType(component) : null;
  if (mirror) return joinBindings(mirror, entry);
  const named = (docs: readonly CompodocMember[] | undefined) =>
    (docs ?? []).map((doc) => ({ name: doc.name, doc }));
  return { inputs: named(entry.inputsClass), outputs: named(entry.outputsClass) };
}

/** Angular's bindings for a component, each joined to Compodoc's entry for it. */
export function joinBindings(mirror: ReflectedBindings, entry: CompodocComponent): ApiBindings {
  // A property that is both an input and an output is a `model()`.
  const outputProps = new Set(mirror.outputs.map((output) => output.propName));
  const models = new Map(
    mirror.inputs
      .filter((input) => outputProps.has(input.propName))
      .map((input) => [input.propName, input.templateName]),
  );
  return {
    inputs: join(mirror.inputs, entry.inputsClass, models),
    outputs: join(mirror.outputs, entry.outputsClass, models),
  };
}

/**
 * The component's public methods, as Compodoc reports them. The `compodoc` target leaves out
 * private, protected, `@internal` and lifecycle members, so what is left is what a host may call.
 */
export function apiMethods(entry: CompodocComponent): readonly CompodocMethod[] {
  return entry.methodsClass ?? [];
}
