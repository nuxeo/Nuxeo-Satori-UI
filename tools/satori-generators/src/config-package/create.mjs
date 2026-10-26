#!/usr/bin/env node
/**
 * Scaffold a configuration package with Node alone: no `npm ci`, no Nx, no registry token.
 *
 *   node tools/satori-generators/src/config-package/create.mjs <name> --owner=<owner>
 *       [--title <text>] [--vendor <text>] [--version <x.y.z>] [--presales]
 *       [--directory <parent>] [--force]
 *
 * Writes `<directory>/<name>/` under the current directory, `config-packages/` by default.
 *
 * The `config-package` Nx generator beside this file does the same in a workspace with Nx
 * installed, and in this repository that takes `npm ci`, which needs a GitHub Packages token.
 * A configuration package needs nothing from that install, so this renders the same templates in
 * `files/` with the same options, defaults and checks, and writes the same bytes, `project.json`
 * included. `create.spec.ts` runs both over a set of options, `--force` and a set of refusals,
 * and compares what they write byte for byte.
 *
 * The templates are EJS, which Nx renders with the `ejs` package. This renders only the forms they
 * use — `<%= name %>`, `<%- JSON.stringify(name) %>`, `<% if (name) { %>` … `<% } %>` — and
 * refuses any other tag rather than guess what EJS would make of it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const FILES = join(dirname(fileURLToPath(import.meta.url)), 'files');
const USAGE = `Usage: node tools/satori-generators/src/config-package/create.mjs <name> --owner=<owner>
         [--title <text>] [--vendor <text>] [--version <x.y.z>] [--presales]
         [--directory <parent>] [--force]

  <name>        Marketplace package name, kebab-case, at most 128 characters
  --owner       Owner prefix for the Nuxeo component, <owner>.config.<name>: lower-case letters and digits
  --title       Marketplace title and the starter applicationTitle (default: the name in title case)
  --vendor      Vendor in the Marketplace listing (default: the title)
  --version     Package version (default: 1.0.0)
  --presales    Add a presales block: preset switching on, and one example preset
  --directory   Parent directory, relative to the current one (default: config-packages)
  --force       Overwrite the generated files if the package already exists`;

/** Exit 2: the command line itself is wrong, before any option is checked. */
function usage(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

/** `acme-insurance` → `Acme Insurance`. */
function titleCase(kebab) {
  return kebab
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' };

/** What EJS's `<%=` writes: `escapeXML` from `ejs/lib/utils.js`. */
function escapeXml(value) {
  return value === undefined || value === null
    ? ''
    : String(value).replace(/[&<>'"]/g, (c) => XML_ESCAPES[c]);
}

/** A template rendered as EJS renders it, for the tags the templates use; any other is refused. */
function render(template, values, file) {
  const lookup = (name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`${file}: "${name}" is not a template value`);
    return values[name];
  };
  const tags = [...template.matchAll(/<%([\s\S]*?)%>/g)];
  if (tags.length !== template.split('<%').length - 1) {
    throw new Error(`${file}: a "<%" has no closing "%>"`);
  }
  const branches = [];
  const emitting = () => branches.every(Boolean);
  let output = '';
  let at = 0;
  for (const tag of tags) {
    if (emitting()) output += template.slice(at, tag.index);
    at = tag.index + tag[0].length;
    const code = tag[1];
    let match;
    if ((match = /^=\s*([A-Za-z_]\w*)\s*$/.exec(code))) {
      if (emitting()) output += escapeXml(lookup(match[1]));
    } else if ((match = /^-\s*JSON\.stringify\(\s*([A-Za-z_]\w*)\s*\)\s*$/.exec(code))) {
      if (emitting()) output += JSON.stringify(lookup(match[1])) ?? '';
    } else if ((match = /^\s*if\s*\(\s*([A-Za-z_]\w*)\s*\)\s*\{\s*$/.exec(code))) {
      branches.push(Boolean(lookup(match[1])));
    } else if (/^\s*\}\s*$/.test(code)) {
      if (branches.length === 0) throw new Error(`${file}: "<%${code}%>" closes no if`);
      branches.pop();
    } else {
      throw new Error(
        `${file}: create.mjs does not render "<%${code}%>". It reads only <%= name %>, ` +
          '<%- JSON.stringify(name) %> and <% if (name) { %> … <% } %>; teach it the new form, ' +
          'and create.spec.ts will check it renders what the Nx generator writes.',
      );
    }
  }
  if (branches.length > 0) throw new Error(`${file}: an "<% if (…) { %>" is never closed`);
  if (emitting()) output += template.slice(at);
  return output;
}

/** Every file under `directory`, as paths relative to it with "/" separators. */
function templatesUnder(directory, prefix = '') {
  return readdirSync(directory)
    .sort()
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory()
        ? templatesUnder(path, `${prefix}${entry}/`)
        : [`${prefix}${entry}`];
    });
}

/** Where Nx's `generateFiles` writes a template: every `__key__` in the path is replaced. */
function targetPath(projectRoot, template, substitutions) {
  let path = posix.join(projectRoot, template);
  if (path.endsWith('.template')) path = path.slice(0, -'.template'.length);
  for (const [key, value] of Object.entries(substitutions)) {
    path = path.split(`__${key}__`).join(String(value));
  }
  return path;
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      owner: { type: 'string' },
      title: { type: 'string' },
      vendor: { type: 'string' },
      version: { type: 'string', default: '1.0.0' },
      presales: { type: 'boolean', default: false },
      directory: { type: 'string', default: 'config-packages' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (error) {
  usage(error.message);
}
const { values: options, positionals } = parsed;
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positionals.length !== 1) {
  usage(
    positionals.length
      ? `Give one package name, not ${positionals.length}.`
      : 'Give a package name.',
  );
}
if (options.owner === undefined) usage('--owner is required.');
const [name] = positionals;

/** Generated and written only once every option is checked and every template rendered. */
let files;
let projectRoot;
let substitutions;
try {
  // The same checks as the generator's, in the same order and with the same messages.
  const parentDirectory = options.directory;
  const segments = parentDirectory.split('/');
  if (
    !segments.every(
      (segment) => /^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(segment) && !/^\.\.?$/.test(segment),
    )
  ) {
    throw new Error(
      `--directory "${parentDirectory}" must be a relative path of letters, digits, ".", "_" and "-" separated by "/", no part starting with "-".`,
    );
  }
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`"${name}" must be kebab-case, e.g. acme-config.`);
  }
  if (name.length > 128) {
    throw new Error(
      `"${name}" is ${name.length} characters; a fragment name may have at most 128.`,
    );
  }
  if (!/^[a-z][a-z0-9]*$/.test(options.owner)) {
    throw new Error(`--owner "${options.owner}" must be lower-case letters and digits.`);
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/.test(options.version)) {
    throw new Error(`--version "${options.version}" must be like 1.0.0 or 1.0.0-rc.1.`);
  }
  projectRoot = `${parentDirectory}/${name}`;
  if (existsSync(projectRoot) && !options.force) {
    throw new Error(
      `${projectRoot} already exists. Choose another name, delete the directory, or pass --force to overwrite the generated files.`,
    );
  }

  const title = options.title?.trim() || titleCase(name);
  substitutions = {
    name,
    owner: options.owner,
    component: `${options.owner}.config.${name}`,
    title,
    vendor: options.vendor?.trim() || title,
    version: options.version,
    presales: options.presales,
    projectRoot,
    tmpl: '',
  };

  files = templatesUnder(FILES).map((template) => {
    if (!template.endsWith('__tmpl__')) {
      throw new Error(
        `files/${template}: create.mjs renders only *__tmpl__ templates. Nx would copy a binary ` +
          'file instead of rendering it, and this does not know which files Nx treats as binary.',
      );
    }
    return [
      targetPath(projectRoot, template, substitutions),
      render(readFileSync(join(FILES, template), 'utf8'), substitutions, `files/${template}`),
    ];
  });

  // What Nx's addProjectConfiguration writes: name and $schema first, then the configuration.
  const project = {
    name,
    $schema: posix.relative(projectRoot, 'node_modules/nx/schemas/project-schema.json'),
    projectType: 'library',
    tags: ['scope:customer', 'type:config'],
    targets: {
      build: {
        executor: 'nx:run-commands',
        cache: true,
        inputs: ['{projectRoot}/**/*'],
        outputs: [`{workspaceRoot}/dist/${projectRoot}`],
        options: {
          cwd: '{workspaceRoot}',
          command: `node ${projectRoot}/build.mjs --out dist/${projectRoot}`,
        },
      },
    },
  };
  files.push([`${projectRoot}/project.json`, `${JSON.stringify(project, null, 2)}\n`]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

for (const [path, content] of files) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

console.log(`
Generated ${projectRoot}

  Marketplace package:  ${name} ${substitutions.version}
  Nuxeo component:      ${substitutions.component}

Edit the fragments in ${projectRoot}/bundle/agentic-ui-config/, then build and install:

  node ${projectRoot}/build.mjs
  nuxeoctl mp-install ${projectRoot}/dist/${name}-${substitutions.version}.zip

The build needs only Node 20: no npm install, no registry token.

Everything in a fragment is served WITHOUT authentication — put nothing secret in it.
Raise the version in package/package.xml for every change you install, or Nuxeo will
treat the zip as the package it already has.
`);
