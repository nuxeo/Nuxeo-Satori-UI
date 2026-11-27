/**
 * A package's custom elements, as the code track of M3 reads them (docs/business-apps/
 * studio-migration.md, section 4): each element's properties, the bindings its template makes, the
 * events it fires, the operations it calls and the Web UI behaviours it uses. The `plugin` command
 * writes a plugin's interface and its spec skeleton from this, and check 9 holds the plugin to it.
 *
 * A custom element is a `dom-module` of the project's custom bundle, `nuxeo-<project>-custom-bundle
 * .html`, where Studio puts a project's hand-written code, that holds a `<script>`: the element's
 * definition. Studio Designer generates nothing there, so everything in it is the customer's. A
 * `dom-module` with no script, such as a shared style, is not an element.
 *
 * Nothing is run. The template is read from the parsed markup, and the script from its syntax
 * tree, which TypeScript's parser builds without evaluating anything. A definition other than
 * Polymer's legacy `Polymer({ is: … })`, which Studio's own templates use, is read for its events
 * and operations only, and says so, so that a person reads the rest.
 */
import { createHash } from 'node:crypto';
import * as ts from 'typescript';
import { attributesOf, elementsOf, isCustomElement } from './markup';

/** A property of the element, as its `properties` block declares it. */
export interface ElementProperty {
  readonly name: string;
  /** `String`, `Number`, `Boolean`, `Object`, `Array`, `Date`, or `null` when not written. */
  readonly type: string | null;
  /** Its default value, as written in the script; `null` for none. Never evaluated. */
  readonly value: string | null;
  readonly notify: boolean;
  readonly readOnly: boolean;
  /** The method that computes it, as written: `_compute(a, b)`. */
  readonly computed: string | null;
  readonly observer: string | null;
  /** True when its name starts with `_`: Polymer's convention for the element's own state. */
  readonly internal: boolean;
}

/** A `[[…]]` or `{{…}}` binding in the element's template. */
export interface ElementBinding {
  /** What it binds, between the brackets, as written. */
  readonly expression: string;
  /** True for `{{…}}`, which writes back what the element it sits on changes. */
  readonly twoWay: boolean;
  /** The element it sits on, or in the text of. */
  readonly element: string;
  /** The attribute it is the value of; `null` for text. */
  readonly attribute: string | null;
}

/** An event the element fires. */
export interface ElementEvent {
  readonly name: string;
  /** Its detail, as written in the script; `null` for none. */
  readonly detail: string | null;
}

/** An operation the element's template runs. */
export interface ElementOperation {
  readonly operation: string;
  /** `nuxeo-operation` or `nuxeo-operation-button`. */
  readonly element: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface CustomElement {
  /** The custom bundle that defines it. */
  readonly path: string;
  /** Its place among the custom bundle's elements, from 0. */
  readonly index: number;
  /** The `dom-module` id, which is the element's name. */
  readonly name: string;
  /** `polymer` when its script calls `Polymer({ is: <name>, … })`; `null` when it does not. */
  readonly definition: 'polymer' | null;
  readonly properties: readonly ElementProperty[];
  /** Its `behaviors`, as written: `Nuxeo.I18nBehavior`. */
  readonly behaviours: readonly string[];
  /** The methods its definition declares. */
  readonly methods: readonly string[];
  /** The methods it calls on itself that it does not declare: its behaviours', such as `i18n`. */
  readonly inherited: readonly string[];
  readonly bindings: readonly ElementBinding[];
  /** The document paths its bindings read, as `document.properties.cl:amount` or `document.uid`. */
  readonly reads: readonly string[];
  /** The translation keys it passes to `i18n`, in its template or its script. */
  readonly texts: readonly string[];
  /** The `on-<event>` handlers of its template, as `tap → _escalate`, and its `listeners`. */
  readonly listeners: readonly string[];
  readonly events: readonly ElementEvent[];
  readonly operations: readonly ElementOperation[];
  /** The conditions of its template, `dom-if` and `nuxeo-filter`, by what they test. */
  readonly conditions: readonly string[];
  /** The custom elements its template uses. */
  readonly elements: readonly string[];
  /** The files of the package that use it, outside its own definition. */
  readonly uses: readonly string[];
  /**
   * The SHA-256 of its definition's markup, script included: a plugin records the one it was
   * written from, and check 9 tells it when the element has changed since.
   */
  readonly sha256: string;
}

/** True for a `dom-module` that defines an element: one with a custom element's name and a script. */
export function definesElement(module: Element): boolean {
  const id = module.getAttribute('id')?.trim() ?? '';
  return (
    module.localName === 'dom-module' &&
    /^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(id) &&
    Array.from(module.children).some((child) => child.localName === 'script')
  );
}

/** The `dom-module`s of a parsed custom bundle that define elements, in document order. */
export function elementModules(document: Document): Element[] {
  return Array.from(document.querySelectorAll('dom-module')).filter(definesElement);
}

/** What one `dom-module` of the custom bundle at `path` defines. `uses` is filled in later. */
export function readCustomElement(path: string, index: number, module: Element): CustomElement {
  const name = module.getAttribute('id')?.trim() ?? '';
  const template = Array.from(module.children).find((child) => child.localName === 'template');
  const content = (template as HTMLTemplateElement | undefined)?.content ?? null;
  const markup = content ? elementsOf(content) : [];
  const script = Array.from(module.children)
    .filter((child) => child.localName === 'script')
    .map((child) => child.textContent ?? '')
    .join('\n');
  const read = readScript(script, name);

  // In document order: an element's attributes, then what it holds, a template's content included.
  const bindings: ElementBinding[] = [];
  const visit = (node: Node, host: string): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        for (const binding of bindingsIn(child.textContent ?? ''))
          bindings.push({ ...binding, element: host, attribute: null });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      for (const attribute of Array.from(element.attributes)) {
        // `on-tap="_escalate"` names a listener, not a binding.
        if (attribute.name.startsWith('on-')) continue;
        for (const binding of bindingsIn(attribute.value))
          bindings.push({ ...binding, element: element.localName, attribute: attribute.name });
      }
      visit(element, element.localName);
      const inner = (element as Partial<HTMLTemplateElement>).content;
      if (element.localName === 'template' && inner) visit(inner, element.localName);
    }
  };
  if (content) visit(content, 'template');

  const reads = unique(
    bindings.flatMap((binding) =>
      [...binding.expression.matchAll(/\bdocument(?:\.[\w:-]+)*/g)].map((match) => match[0]),
    ),
  );
  const texts = unique([
    ...bindings.flatMap((binding) => i18nKeys(binding.expression)),
    ...read.texts,
  ]);
  const listeners = unique([
    ...markup.flatMap((element) =>
      Array.from(element.attributes)
        .filter((attribute) => attribute.name.startsWith('on-'))
        .map((attribute) => `${attribute.name.slice(3)} → ${attribute.value.trim()}`),
    ),
    ...read.listeners,
  ]);
  const operations: ElementOperation[] = markup.flatMap((element) => {
    const attributes = attributesOf(element);
    const operation =
      element.localName === 'nuxeo-operation'
        ? element.getAttribute('op')
        : element.localName === 'nuxeo-operation-button'
          ? element.getAttribute('operation')
          : null;
    return operation?.trim()
      ? [{ operation: operation.trim(), element: element.localName, attributes }]
      : [];
  });
  const conditions = markup.flatMap((element) => {
    if (
      element.localName === 'dom-if' ||
      (element.localName === 'template' && element.getAttribute('is')?.trim() === 'dom-if')
    )
      return [`dom-if ${element.getAttribute('if') ?? ''}`.trim()];
    if (element.localName === 'nuxeo-filter')
      return [
        `nuxeo-filter ${Array.from(element.attributes)
          .map((attribute) => `${attribute.name}="${attribute.value}"`)
          .join(' ')}`.trim(),
      ];
    return [];
  });

  return {
    path,
    index,
    name,
    definition: read.definition,
    properties: read.properties,
    behaviours: read.behaviours,
    methods: read.methods,
    inherited: read.inherited,
    bindings,
    reads,
    texts,
    listeners,
    events: read.events,
    operations,
    conditions,
    elements: unique(markup.filter(isCustomElement).map((element) => element.localName)),
    uses: [],
    sha256: createHash('sha256').update(module.outerHTML).digest('hex'),
  };
}

/** The bindings in a text: each `[[…]]` and `{{…}}`. */
function bindingsIn(text: string): { expression: string; twoWay: boolean }[] {
  return [...text.matchAll(/\[\[([^\]]*)\]\]|\{\{([^}]*)\}\}/g)].map((match) => ({
    expression: (match[1] ?? match[2] ?? '').trim(),
    twoWay: match[2] !== undefined,
  }));
}

/** The keys of each `i18n('key')` in a text. */
function i18nKeys(text: string): string[] {
  return [...text.matchAll(/\bi18n\(\s*(['"])([^'"]+)\1/g)].map((match) => match[2]);
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

interface ScriptRead {
  readonly definition: 'polymer' | null;
  readonly properties: ElementProperty[];
  readonly behaviours: string[];
  readonly methods: string[];
  readonly inherited: string[];
  readonly listeners: string[];
  readonly events: ElementEvent[];
  readonly texts: string[];
}

/**
 * What the element's script declares, from its syntax tree. The legacy `Polymer({ is, … })` call
 * gives the properties, behaviours, methods and listeners; any script gives the events it fires
 * with `this.fire(…)` or `new CustomEvent(…)`, and the methods it calls on itself.
 */
function readScript(script: string, name: string): ScriptRead {
  const source = ts.createSourceFile('element.js', script, ts.ScriptTarget.Latest, true);
  const text = (node: ts.Node): string => node.getText(source);
  const literal = (node: ts.Node | undefined): string | null =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : null;
  const keyOf = (property: ts.ObjectLiteralElementLike): string | null =>
    property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? property.name.text
      : null;

  let definition: ts.ObjectLiteralExpression | null = null;
  const events: ElementEvent[] = [];
  const calledOnThis: string[] = [];
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [first] = node.arguments;
      if (
        ts.isIdentifier(callee) &&
        callee.text === 'Polymer' &&
        first &&
        ts.isObjectLiteralExpression(first)
      ) {
        const is = first.properties.find((property) => keyOf(property) === 'is');
        if (
          definition === null &&
          is &&
          ts.isPropertyAssignment(is) &&
          literal(is.initializer) === name
        )
          definition = first;
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        calledOnThis.push(callee.name.text);
        if (callee.name.text === 'fire' && literal(first) !== null)
          events.push({
            name: literal(first) as string,
            detail: node.arguments[1] ? text(node.arguments[1]) : null,
          });
        if (callee.name.text === 'i18n' && literal(first) !== null)
          texts.push(literal(first) as string);
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'CustomEvent' &&
      literal(node.arguments?.[0]) !== null
    )
      events.push({
        name: literal(node.arguments?.[0]) as string,
        detail: node.arguments?.[1] ? text(node.arguments[1]) : null,
      });
    ts.forEachChild(node, visit);
  };
  visit(source);

  const properties: ElementProperty[] = [];
  const behaviours: string[] = [];
  const methods: string[] = [];
  const listeners: string[] = [];
  const found = definition as ts.ObjectLiteralExpression | null;
  for (const member of found?.properties ?? []) {
    const key = keyOf(member);
    if (key === null) continue;
    if (ts.isMethodDeclaration(member)) {
      methods.push(key);
      continue;
    }
    if (!ts.isPropertyAssignment(member)) continue;
    const value = member.initializer;
    if (ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
      methods.push(key);
    } else if (key === 'behaviors' && ts.isArrayLiteralExpression(value)) {
      behaviours.push(...value.elements.map((element) => text(element)));
    } else if (key === 'listeners' && ts.isObjectLiteralExpression(value)) {
      for (const listener of value.properties) {
        if (!ts.isPropertyAssignment(listener)) continue;
        const handler = literal(listener.initializer) ?? text(listener.initializer);
        listeners.push(`${keyOf(listener) ?? text(listener.name)} → ${handler}`);
      }
    } else if (key === 'properties' && ts.isObjectLiteralExpression(value)) {
      for (const declared of value.properties) {
        const propertyName = keyOf(declared);
        if (propertyName === null || !ts.isPropertyAssignment(declared)) continue;
        properties.push(readProperty(propertyName, declared.initializer, text, literal, keyOf));
      }
    }
  }
  return {
    definition: found ? 'polymer' : null,
    properties,
    behaviours,
    methods,
    inherited: unique(calledOnThis.filter((method) => !methods.includes(method))),
    listeners,
    events,
    texts,
  };
}

function readProperty(
  name: string,
  initializer: ts.Expression,
  text: (node: ts.Node) => string,
  literal: (node: ts.Node | undefined) => string | null,
  keyOf: (property: ts.ObjectLiteralElementLike) => string | null,
): ElementProperty {
  const base = {
    name,
    type: null as string | null,
    value: null as string | null,
    notify: false,
    readOnly: false,
    computed: null as string | null,
    observer: null as string | null,
    internal: name.startsWith('_'),
  };
  // `name: String` is the short form of `name: { type: String }`.
  if (ts.isIdentifier(initializer)) return { ...base, type: initializer.text };
  if (!ts.isObjectLiteralExpression(initializer)) return base;
  const field = (key: string): ts.Expression | undefined => {
    const found = initializer.properties.find((property) => keyOf(property) === key);
    return found && ts.isPropertyAssignment(found) ? found.initializer : undefined;
  };
  const type = field('type');
  const value = field('value');
  return {
    ...base,
    type: type && ts.isIdentifier(type) ? type.text : null,
    value: value ? text(value) : null,
    notify: field('notify')?.kind === ts.SyntaxKind.TrueKeyword,
    readOnly: field('readOnly')?.kind === ts.SyntaxKind.TrueKeyword,
    computed: literal(field('computed')),
    observer: literal(field('observer')),
  };
}

/**
 * Each element's interface as a plugin holds it: an input for each property that is not its own
 * state, and an output for each event, named as Angular names them, in camel case.
 */
export function pluginInterface(element: CustomElement): {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
} {
  return {
    inputs: element.properties
      .filter((property) => !property.internal && property.computed === null)
      .map((property) => camelCase(property.name)),
    outputs: unique(element.events.map((event) => camelCase(event.name))),
  };
}

/** `claim-escalated` is `claimEscalated`, as an Angular output is named. */
export function camelCase(name: string): string {
  return name.replace(/[-_]+([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/** The lines the `inventory` command prints for an element, under "Custom elements". */
export function describeElement(element: CustomElement): string[] {
  const list = (items: readonly string[]): string => (items.length ? items.join(', ') : 'none');
  const { inputs, outputs } = pluginInterface(element);
  const property = (declared: ElementProperty): string =>
    `${declared.name}${declared.type ? ` (${declared.type})` : ''}${
      declared.value !== null ? ` = ${declared.value}` : ''
    }${declared.internal ? ', its own state' : ''}`;
  const binding = (bound: ElementBinding): string =>
    bound.twoWay ? `{{${bound.expression}}}` : `[[${bound.expression}]]`;
  return [
    `  ${element.name}, in ${element.path}${
      element.definition === 'polymer'
        ? ''
        : ': not a Polymer({ is }) definition, so read only for its events'
    }`,
    `    properties: ${list(element.properties.map(property))}`,
    `    behaviours: ${list(element.behaviours)}; calls on itself: ${list(element.inherited)}`,
    `    reads: ${list(element.reads)}`,
    `    bindings: ${list(element.bindings.map(binding))}`,
    `    conditions: ${list(element.conditions)}`,
    `    texts: ${list(element.texts)}`,
    `    listens: ${list(element.listeners)}`,
    `    fires: ${list(element.events.map((event) => event.name))}`,
    `    runs: ${list(element.operations.map((run) => `${run.operation} (${run.element})`))}`,
    `    used in: ${list(element.uses)}`,
    `    as a plugin: inputs ${list(inputs)}; outputs ${list(outputs)}`,
  ];
}
