/**
 * Since 0.8.0, the kit's letter templates, `data.mjs`'s `LETTER_TEMPLATES` and their files in
 * `demo/letters/`, held to what nuxeo-agentic-letters takes from an administrator, before the seed
 * asks the server anything: the add-on refuses a template that breaks one of these on the server, so
 * a template the seed would be refused is `data.mjs`'s fault, found here first, with no server.
 *
 * What is held, as the add-on's README says it checks a template on save:
 *
 * - **A file the add-on takes:** HTML, at most 256 KiB, UTF-8.
 * - **Text and placeholders, nothing that runs:** no other template engine's syntax (`${`, `<#`,
 *   `#{`, `[#`, `<@`, `<%`, `{%`, Velocity's directives and references), no `javascript:`,
 *   `vbscript:`, `url(`, `expression(`, `@import` or conditional comment, and only the HTML tags and
 *   attributes the add-on allows.
 * - **Placeholders that name what the record has:** `{{prefix:name}}`, or a complex property's
 *   subfield, `{{prefix:name/sub}}`, a property of every type the template is for, as the kit's
 *   content model (`content-model.json`) has it; `{{prefix:ref>prefix2:name}}`, one hop through a
 *   property of the record holding a document's id, the second a property of the schema of that
 *   prefix; and `{{letter.date}}`, `{{letter.writer}}`, `{{letter.language}}`. Nothing else.
 * - **A template the add-on can choose:** a language it reads, conditions on a property of each of
 *   its types, and, of one letter's templates in one language, never two that fit the same seeded
 *   record, nor none that fits a record a button offers the letter on. Every letter has an English
 *   template, the add-on's default language.
 *
 * It mirrors the add-on's rules, it is not them: the add-on's own tests hold its checks, and only a
 * server that takes the seed's templates shows the two agree.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = dirname(fileURLToPath(import.meta.url));
export const LETTERS_DIR = join(DEMO, 'letters');
export const CONTENT_MODEL = join(DEMO, '..', 'content-model.json');

/** The add-on's processor, which a letter template's `tmpl:templateType` names. */
export const LETTER_PROCESSOR = 'agenticLetter';
/** The language the add-on falls back to, `nuxeo.agentic.letters.language.default` unset. */
export const DEFAULT_LANGUAGE = 'en';
export const MAX_TEMPLATE_BYTES = 256 * 1024;

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const PROPERTY = `${NAME}:${NAME}(?:/${NAME})*`;
const PLACEHOLDER = new RegExp(
  `^(?:(${PROPERTY})(?:>(${PROPERTY}))?|letter\\.(date|writer|language))$`,
);
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const CONDITION = new RegExp(`^(${NAME}:${NAME})=(.+)$`);
const LETTER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** What no letter template holds, anywhere, case aside. */
const FORBIDDEN = [
  '${',
  '#{',
  '<#',
  '</#',
  '[#',
  '[/#',
  '<@',
  '</@',
  '[@',
  '<%',
  '%>',
  '{%',
  '%}',
  '$!',
  'javascript:',
  'vbscript:',
  'url(',
  'expression(',
  '@import',
  '<!--[if',
];
const VELOCITY = /#(?:set|if|elseif|foreach|macro|include|parse|evaluate|define)\s*\(/i;
const REFERENCE = /\$[A-Za-z{!]/;
const TAGS = new Set([
  'html',
  'head',
  'body',
  'title',
  'meta',
  'style',
  'p',
  'br',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'small',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'hr',
  'blockquote',
  'address',
  'header',
  'footer',
  'section',
  'article',
  'main',
]);
const ATTRIBUTES = new Set(['class', 'style', 'lang', 'dir', 'title', 'colspan', 'rowspan']);

/**
 * The content model as the pipeline reads it: each type's properties by prefixed name, each with
 * its type and, for a complex one, its subfields; and each schema's by its prefix.
 */
export function readModel(text = readFileSync(CONTENT_MODEL, 'utf8')) {
  const model = JSON.parse(text);
  const schemas = new Map();
  const bySchema = (schema) => {
    const prefix = schema['@prefix'] || schema.prefix || schema.name;
    const fields = new Map();
    for (const [name, field] of Object.entries(schema.fields ?? {})) {
      const type = typeof field === 'string' ? field : (field?.type ?? 'string');
      const subfields = new Map(
        Object.entries(field?.fields ?? {}).map(([sub, value]) => [
          sub,
          typeof value === 'string' ? value : (value?.type ?? 'string'),
        ]),
      );
      fields.set(name, { type, subfields });
    }
    return { prefix, fields };
  };
  for (const schema of model.schemas ?? []) schemas.set(schema.name, bySchema(schema));
  for (const facet of model.facets ?? [])
    for (const schema of facet.schemas ?? [])
      if (!schemas.has(schema.name)) schemas.set(schema.name, bySchema(schema));
  const byPrefix = new Map([...schemas.values()].map((schema) => [schema.prefix, schema]));
  const types = new Map(
    Object.entries(model.doctypes ?? {}).map(([type, entry]) => [
      type,
      new Map((entry.schemas ?? []).map((name) => [schemas.get(name)?.prefix, schemas.get(name)])),
    ]),
  );
  return { types, byPrefix };
}

/** The field a `prefix:name/sub` path names in `schema`, or `null`: a scalar, or a list of one. */
function fieldOf(schema, path) {
  if (!schema) return null;
  const [name, ...subs] = path.slice(path.indexOf(':') + 1).split('/');
  const field = schema.fields.get(name);
  if (!field) return null;
  if (subs.length === 0) return /^complex|^blob/.test(field.type) ? null : field.type;
  if (subs.length !== 1 || field.type !== 'complex') return null;
  const sub = field.subfields.get(subs[0]);
  return sub && !/^complex|^blob/.test(sub) ? sub : null;
}

/** Each placeholder's inner text in `text`, with what is left once they are taken out. */
export function placeholdersOf(text) {
  const found = [];
  const rest = text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_, inner) => {
    found.push(inner);
    return '';
  });
  return { found, stray: rest.includes('{{') || rest.includes('}}') };
}

/** Every way one template's text breaks the add-on's rules, for the types it is for, or none. */
export function textProblems(name, text, types, model) {
  const problems = [];
  const lower = text.toLowerCase();
  for (const sequence of FORBIDDEN)
    if (lower.includes(sequence)) problems.push(`${name} holds ${JSON.stringify(sequence)}`);
  if (VELOCITY.test(text)) problems.push(`${name} holds a Velocity directive`);
  if (REFERENCE.test(text)) problems.push(`${name} holds a "$" reference`);
  if (/<\?|<!\[CDATA\[/i.test(text))
    problems.push(`${name} holds a processing instruction or CDATA`);
  // Read as a browser reads them: a comment's text with none of the characters that end it early,
  // a title and a style sheet with no "<" before their closing tag, and no character by which CSS
  // fetches, imports or escapes, nor a character reference in an attribute's value.
  for (const [, comment] of text.matchAll(/<!--([\s\S]*?)-->/g))
    if (/[-<>!]/.test(comment)) problems.push(`${name} has a comment holding -, <, > or !`);
  for (const [, tag, body] of text.matchAll(/<(title|style)\b[^>]*>([\s\S]*?)<\/\1/gi)) {
    if (body.includes('<')) problems.push(`${name}'s <${tag.toLowerCase()}> holds a "<"`);
    if (tag.toLowerCase() === 'style' && /[(@\\&]/.test(body))
      problems.push(`${name}'s style sheet holds a function, an at-rule or an escape`);
  }
  for (const [, value] of text.matchAll(/=\s*("[^"]*"|'[^']*')/g))
    if (value.includes('&')) problems.push(`${name} has an attribute value holding "&"`);
  for (const [, value] of text.matchAll(/\bstyle\s*=\s*("[^"]*"|'[^']*')/gi))
    if (/[(@\\]/.test(value))
      problems.push(`${name}'s style attribute holds a function, an at-rule or an escape`);
  // Each tag, a comment and the doctype matched and passed over rather than cut out of the text.
  for (const [, slash, tag, attributes] of text.matchAll(
    /<!--[\s\S]*?-->|<!DOCTYPE html>|<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)([^>]*)>/gi,
  )) {
    if (tag === undefined) continue;
    const lowerTag = tag.toLowerCase();
    if (!TAGS.has(lowerTag)) {
      problems.push(`${name} has a <${lowerTag}> tag, which the add-on does not take`);
      continue;
    }
    if (slash) continue;
    // An attribute's name, its value, quoted, taken out first: a value is text, not a name.
    const names = attributes.replace(/"[^"]*"|'[^']*'/g, '""');
    for (const [, attribute] of names.matchAll(
      /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*(?:=|(?=\s|\/|$))/g,
    )) {
      const lowerAttribute = attribute.toLowerCase();
      const allowed =
        ATTRIBUTES.has(lowerAttribute) || (lowerTag === 'meta' && lowerAttribute === 'charset');
      if (!allowed || (lowerTag === 'meta' && lowerAttribute !== 'charset'))
        problems.push(`${name}'s <${lowerTag}> has the attribute ${lowerAttribute}`);
    }
  }
  const { found, stray } = placeholdersOf(text);
  if (stray) problems.push(`${name} holds a "{{" or "}}" that is no placeholder`);
  if (found.length === 0) problems.push(`${name} holds no placeholder`);
  for (const inner of found) {
    const parsed = PLACEHOLDER.exec(inner);
    if (!parsed) {
      problems.push(`${name}'s placeholder {{${inner}}} is not one the add-on takes`);
      continue;
    }
    const [, first, second] = parsed;
    if (!first) continue;
    for (const type of types) {
      const schemas = model.types.get(type);
      if (!schemas) {
        problems.push(`${name} is for ${type}, which the content model does not have`);
        continue;
      }
      const owner = schemas.get(first.slice(0, first.indexOf(':')));
      const kind = fieldOf(owner, first);
      if (kind === null) {
        problems.push(`${name}'s {{${inner}}} names ${first}, which ${type} does not have`);
        continue;
      }
      if (second !== undefined) {
        if (kind !== 'string' || first.includes('/'))
          problems.push(`${name}'s {{${inner}}} goes through ${first}, which holds no document id`);
        const target = model.byPrefix.get(second.slice(0, second.indexOf(':')));
        if (fieldOf(target, second) === null)
          problems.push(
            `${name}'s {{${inner}}} names ${second}, which no schema of that prefix has`,
          );
      }
    }
  }
  return problems;
}

/** The value a `prefix:name` condition reads on a seeded record of `data.mjs`, written unprefixed. */
const valueOn = (record, property) => {
  const value = record[property.slice(property.indexOf(':') + 1)];
  return value === null || value === undefined ? null : String(value);
};

/** Whether every condition of `template` holds on the seeded `record`. */
export const fits = (template, record) =>
  template.conditions.every((condition) => {
    const [, property, value] = CONDITION.exec(condition) ?? [];
    return property !== undefined && valueOn(record, property) === value;
  });

/**
 * Every way `templates`, `data.mjs`'s `LETTER_TEMPLATES`, break what the add-on takes or can
 * choose from, for the seeded `records` by type (`{ Claim: CLAIMS, Case: CASES }`), each held to the
 * button that writes its letter (`offered`, a record a button offers the letter on), or none. `read`
 * reads a template's file.
 */
export function letterProblems(
  templates,
  { records, offered, model = readModel(), read = (file) => readFileSync(join(LETTERS_DIR, file)) },
) {
  const problems = [];
  const names = new Set();
  for (const template of templates) {
    const { name, letter, language, types, conditions, file, title } = template;
    if (names.has(name)) problems.push(`${name} is the name of two templates`);
    names.add(name);
    if (!LETTER_ID.test(letter ?? '')) problems.push(`${name}'s letter ${letter} is not an id`);
    if (!LANGUAGE.test(language ?? '')) problems.push(`${name}'s language ${language} is not one`);
    if (typeof title !== 'string' || title.trim() === '') problems.push(`${name} has no title`);
    if (!Array.isArray(types) || types.length === 0 || types.includes('all'))
      problems.push(`${name} names no record type, or all of them`);
    for (const condition of conditions ?? []) {
      const parsed = CONDITION.exec(condition);
      if (!parsed) {
        problems.push(`${name}'s condition ${condition} is not prefix:name=value`);
        continue;
      }
      for (const type of types ?? [])
        if (fieldOf(model.types.get(type)?.get(parsed[1].split(':')[0]), parsed[1]) === null)
          problems.push(`${name}'s condition reads ${parsed[1]}, which ${type} does not have`);
    }
    if (!/\.html$/.test(file ?? '')) {
      problems.push(`${name}'s file ${file} is not an HTML file`);
      continue;
    }
    let bytes;
    try {
      bytes = read(file);
    } catch {
      problems.push(`${name}'s file ${file} is not in demo/letters/`);
      continue;
    }
    if (bytes.length > MAX_TEMPLATE_BYTES)
      problems.push(`${name}'s file is ${bytes.length} bytes, over ${MAX_TEMPLATE_BYTES}`);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      problems.push(`${name}'s file is not UTF-8`);
      continue;
    }
    problems.push(...textProblems(name, text, types ?? [], model));
  }
  const letters = new Set(templates.map((template) => template.letter));
  for (const letter of letters) {
    const of = templates.filter((template) => template.letter === letter);
    if (!of.some((template) => template.language === DEFAULT_LANGUAGE))
      problems.push(`${letter} has no ${DEFAULT_LANGUAGE} template, the add-on's default language`);
    for (const language of new Set(of.map((template) => template.language))) {
      const inIt = of.filter((template) => template.language === language);
      for (const [type, seeded] of Object.entries(records)) {
        for (const record of seeded) {
          const fitting = inIt.filter(
            (template) => template.types.includes(type) && fits(template, record),
          );
          const number = record.number;
          if (fitting.length > 1)
            problems.push(
              `${number} fits ${fitting.length} ${letter} templates in ${language}: ${fitting.map((t) => t.name).join(', ')}`,
            );
          if (fitting.length === 0 && offered(letter, type, record))
            problems.push(
              `${number}, which a button offers ${letter} on, fits no ${letter} template in ${language}`,
            );
        }
      }
    }
  }
  return problems;
}

/**
 * Whether a button of the kit offers `letter` on the seeded `record` of `type`, as `actions.json`'s
 * rules read it: the denial letter on a denied claim, the appeal outcome letter on an appeal with a
 * decision.
 */
export function offered(letter, type, record) {
  if (letter === 'payers.denial') return type === 'Claim' && record.status === 'denied';
  if (letter === 'payers.appealOutcome')
    return (
      type === 'Case' &&
      record.category === 'appeal' &&
      ['upheld', 'overturned'].includes(record.decision ?? '')
    );
  return false;
}
