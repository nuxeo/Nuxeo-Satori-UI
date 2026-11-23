/**
 * Parsing a package's HTML and XML as data.
 *
 * jsdom runs no script and loads no resource unless it is asked to, through `runScripts` and
 * `resources`, and nothing here asks. So a `<script>` in a layout stays text, and an
 * `<link rel="import">` in a bundle fetches nothing.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

/**
 * Forwarded nowhere, so it prints nothing. jsdom builds a stylesheet from each `<style>` and
 * reports any it cannot parse, which is every theme with a Polymer mixin; this tool reads that CSS
 * itself (`theme.ts`), so the report is noise. Parse failures that matter still throw.
 */
const silent = new VirtualConsole();

export function parseHtml(markup: string): Document {
  return new JSDOM(markup, { virtualConsole: silent }).window.document;
}

/** Throws when the text is not well-formed XML. */
export function parseXml(markup: string): Document {
  return new JSDOM(markup, { contentType: 'application/xml', virtualConsole: silent }).window
    .document;
}

/**
 * Every element under `root`, in document order, including those inside `<template>` elements.
 * A query does not reach them: an HTML parser puts a template's children in its `content`
 * fragment, not among its children, and every Polymer layout keeps its markup in a template.
 */
export function elementsOf(root: ParentNode): Element[] {
  const found: Element[] = [];
  const visit = (node: ParentNode): void => {
    for (const child of Array.from(node.children)) {
      found.push(child);
      visit(child);
      const content = (child as Partial<HTMLTemplateElement>).content;
      if (child.localName === 'template' && content) visit(content);
    }
  };
  visit(root);
  return found;
}

/** A custom element's name has a hyphen, as the HTML standard requires; a built-in one never does. */
export function isCustomElement(element: Element): boolean {
  return element.localName.includes('-');
}

/** The text of the element's own `<label>` child, as a view layout writes a field's label. */
export function childLabel(element: Element): string | null {
  for (const child of Array.from(element.children)) {
    if (child.localName === 'label') return normalizeSpace(child.textContent ?? '');
  }
  return null;
}

/**
 * An element's attributes, by name. Built with `Object.fromEntries`, which defines each as the
 * record's own, so an attribute named `__proto__` is a key like any other.
 */
export function attributesOf(element: Element): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]),
  );
}

export function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
