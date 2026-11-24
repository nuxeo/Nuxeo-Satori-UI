/**
 * A strict XML reader for the kit's own files: its route model's documents and its components.
 * Node 24 has no XML parser, and the kit's scripts install nothing.
 *
 * It parses, in one pass from the start, rather than removing markup with patterns: a comment is
 * skipped by finding where it ends, so text can never be left that reads as markup once something
 * around it is taken out. Not every XML document: no DTD, no namespaces resolved, no entities but
 * the five predefined and character references. Anything it does not read, it refuses.
 */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;

/**
 * The document element of `xml`, as `{ name, attributes, children, text }`, or a thrown error
 * naming where it is not well-formed: an unclosed or mismatched element, an attribute without
 * quotes or given twice, an unknown entity, a comment holding `--` or not closed, a `<!` that
 * opens neither a comment nor CDATA, or anything but space, comments and instructions outside the
 * one element.
 */
export function parseXml(xml) {
  let at = 0;
  const fail = (message) => {
    const line = xml.slice(0, at).split('\n').length;
    throw new Error(`line ${line}: ${message}`);
  };
  const decode = (text) =>
    text.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[a-z]+);|&/g, (match, entity) => {
      if (entity === undefined) fail('a bare & that is not a reference');
      if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
      if (!(entity in ENTITIES)) fail(`an unknown entity &${entity};`);
      return ENTITIES[entity];
    });
  /** A comment at `at`, skipped whole: XML forbids `--` inside one, so the first `--` ends it. */
  const comment = () => {
    const end = xml.indexOf('--', at + 4);
    if (end < 0) fail('an unclosed comment');
    if (xml[end + 2] !== '>') fail('"--" inside a comment');
    at = end + 3;
  };
  const skipMisc = () => {
    for (;;) {
      const rest = xml.slice(at);
      const space = /^[ \t\r\n]+/.exec(rest);
      if (space) at += space[0].length;
      else if (rest.startsWith('<!--')) comment();
      else if (rest.startsWith('<?')) {
        const end = xml.indexOf('?>', at + 2);
        if (end < 0) fail('an unclosed instruction');
        at = end + 2;
      } else if (rest.startsWith('<!')) fail('a "<!" that opens neither a comment nor CDATA');
      else return;
    }
  };
  const name = () => {
    NAME.lastIndex = at;
    const match = NAME.exec(xml);
    if (!match) fail('a name was expected');
    at = NAME.lastIndex;
    return match[0];
  };
  const element = () => {
    if (xml[at] !== '<') fail('an element was expected');
    at++;
    const node = { name: name(), attributes: {}, children: [], text: '' };
    for (;;) {
      const space = /^[ \t\r\n]*/.exec(xml.slice(at))[0];
      at += space.length;
      if (xml.startsWith('/>', at)) {
        at += 2;
        return node;
      }
      if (xml[at] === '>') {
        at++;
        break;
      }
      if (!space) fail(`a space was expected before an attribute of <${node.name}>`);
      const attribute = name();
      if (attribute in node.attributes) fail(`<${node.name}> gives ${attribute} twice`);
      const value = /^[ \t\r\n]*=[ \t\r\n]*("[^"<]*"|'[^'<]*')/.exec(xml.slice(at));
      if (!value) fail(`the attribute ${attribute} of <${node.name}> has no quoted value`);
      at += value[0].length;
      node.attributes[attribute] = decode(value[1].slice(1, -1));
    }
    for (;;) {
      if (at >= xml.length) fail(`<${node.name}> is not closed`);
      if (xml.startsWith('</', at)) {
        at += 2;
        const closing = name();
        if (closing !== node.name) fail(`</${closing}> closes <${node.name}>`);
        const end = /^[ \t\r\n]*>/.exec(xml.slice(at));
        if (!end) fail(`</${closing}> is not closed`);
        at += end[0].length;
        return node;
      }
      if (xml.startsWith('<![CDATA[', at)) {
        const end = xml.indexOf(']]>', at);
        if (end < 0) fail('an unclosed CDATA section');
        node.text += xml.slice(at + 9, end);
        at = end + 3;
      } else if (xml.startsWith('<!', at) || xml.startsWith('<?', at)) skipMisc();
      else if (xml[at] === '<') node.children.push(element());
      else {
        const end = xml.indexOf('<', at);
        const text = xml.slice(at, end < 0 ? xml.length : end);
        if (text.includes(']]>')) fail(']]> in text');
        node.text += decode(text);
        at = end < 0 ? xml.length : end;
      }
    }
  };
  if (xml.charCodeAt(0) === 0xfeff) fail('a byte order mark');
  skipMisc();
  const root = element();
  skipMisc();
  if (at !== xml.length) fail('content after the document element');
  return root;
}

/** The first child element of `node` named `name`, or `null`. */
export const child = (node, name) => node?.children.find((c) => c.name === name) ?? null;
/** Every child element of `node` named `name`. */
export const childrenNamed = (node, name) => node?.children.filter((c) => c.name === name) ?? [];
/** The trimmed text of `node`'s first child named `name`, or `null`. */
export const textOf = (node, name) => child(node, name)?.text.trim() ?? null;
/** Every element below `node`, depth first. */
export function descendants(node) {
  return node.children.flatMap((c) => [c, ...descendants(c)]);
}
