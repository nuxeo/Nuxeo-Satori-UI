/**
 * What `crowdin-conf.yml` uploads, and where Crowdin writes each translation back: read from the
 * file, not restated, so that its controls (`crowdin-sources.selftest.mjs`) hold the real config.
 *
 * ## Why this exists beside `checkCrowdinConfig`
 *
 * The guardrail holds the config to the Hyland standard: approved-only export, the enterprise
 * host, no skip options, a root that cannot reach `node_modules`. It does not ask the question a
 * new source raises — **does every file that should be translated reach Crowdin, and does its
 * translation land where the application reads it?** Both halves fail silently. A kit whose
 * `labels/en.json` no pattern matches is never offered to a translator, and a language written
 * under a name the app does not ask for (`no.json` for Norwegian Bokmål, which the app calls `nb`)
 * downloads, commits and is never read, while every job reports success.
 *
 * ## No YAML parser, on purpose
 *
 * For the reason `crowdinFileEntries` in `scripts/review-guardrails.mjs` gives: none is a declared
 * dependency here. The `files` list is the flow sequence the config has always used, so it is
 * read by turning that one block into JSON. A config in another shape is refused by name rather
 * than guessed at, which a control asserts.
 *
 * Only `node:` built-ins, so `crowdin-status.yaml`, which runs without an install, can import it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Crowdin's two-letters code for the language ids this application asks for, from Crowdin's own
 * language list (the Languages API's `twoLettersCode`). Read, not guessed: Norwegian is the one
 * where the id and the app's name part company, since Crowdin has both "Norwegian" (`no`) and
 * "Norwegian Bokmal" (`nb`), and Danish, Finnish and Swedish are `da`, `fi` and `sv` throughout.
 */
export const CROWDIN_TWO_LETTERS_CODES = Object.freeze({
  ar: 'ar',
  da: 'da',
  de: 'de',
  es: 'es',
  fi: 'fi',
  fr: 'fr',
  he: 'he',
  it: 'it',
  ja: 'ja',
  nb: 'nb',
  nl: 'nl',
  no: 'no',
  sv: 'sv',
});

/** The `files` entries of `crowdin-conf.yml`, parsed, or a reason the block could not be read. */
export function readCrowdinFiles(text) {
  const body = withoutComments(text);
  const key = /^'?files'?\s*:\s*\[/m.exec(body);
  if (!key) return { invalid: 'it has no `files: [ … ]` flow sequence' };
  const open = key.index + key[0].length - 1;
  const close = matching(body, open);
  if (close === -1) return { invalid: 'its `files` sequence is never closed' };
  try {
    const entries = JSON.parse(flowToJson(body.slice(open, close + 1)));
    if (!Array.isArray(entries) || entries.some((entry) => !isRecord(entry)))
      return { invalid: '`files` is not a list of mappings' };
    return { entries };
  } catch (error) {
    return { invalid: `its \`files\` sequence is not the flow form it reads: ${error.message}` };
  }
}

/** A Crowdin source pattern as a regular expression over repository paths: `*` is one segment. */
export function sourcePattern(source) {
  const pattern = source.replace(/^\//, '');
  return new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`,
  );
}

/** The two-letters code Crowdin writes for `languageId` under `entry`, after its mapping. */
export function twoLettersCode(entry, languageId) {
  const mapped = entry['languages_mapping']?.['two_letters_code']?.[languageId];
  if (typeof mapped === 'string') return mapped;
  return CROWDIN_TWO_LETTERS_CODES[languageId] ?? null;
}

/**
 * Where Crowdin writes the translation of `file` into `languageId`, as a repository path, or
 * `null` for a placeholder this does not render. `%original_path%` is the file's directory
 * (`preserve_hierarchy: true`, `base_path: '.'`).
 */
export function translationPath(entry, file, languageId) {
  const translation = entry['translation'];
  if (typeof translation !== 'string') return null;
  const code = twoLettersCode(entry, languageId);
  const slash = file.lastIndexOf('/');
  const name = file.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const values = {
    original_path: file.slice(0, Math.max(slash, 0)),
    original_file_name: name,
    file_name: dot === -1 ? name : name.slice(0, dot),
    file_extension: dot === -1 ? '' : name.slice(dot + 1),
    two_letters_code: code,
  };
  let unknown = false;
  const path = translation.replace(/%([a-z_]+)%/g, (_, placeholder) => {
    const value = values[placeholder];
    if (typeof value !== 'string') unknown = true;
    return value ?? '';
  });
  return unknown ? null : path.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

/** Every file under `directories` of `root`, as a repository path with `/`. */
export function repositoryFiles(root, directories = ['apps', 'libs', 'business-apps']) {
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(relative(root, path).split(sep).join('/'));
    }
  };
  for (const directory of directories) {
    if (existsSync(join(root, directory))) visit(join(root, directory));
  }
  return files.sort();
}

/** The globs under `on.push.paths` of a workflow, as written. */
export function pushPaths(workflow) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => /^\s+paths:\s*$/.test(line));
  if (start === -1) return [];
  const indent = /^\s*/.exec(lines[start])[0].length;
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^\s*/.exec(line)[0].length <= indent) break;
    const item = /^\s*-\s*'([^']+)'\s*$/.exec(line) ?? /^\s*-\s*"([^"]+)"\s*$/.exec(line);
    if (item) globs.push(item[1]);
  }
  return globs;
}

/** A GitHub `paths` glob as a regular expression: `*` is one segment, `**` any number. */
function pathsGlob(glob) {
  return sourcePattern(`/${glob}`);
}

/**
 * What is wrong with the sources `config` declares, for the repository whose files are `files`:
 * each finding a sentence. Empty when the app's catalogue and every kit's English labels are each
 * one source; when each language lands at the name the app reads, Norwegian as `nb`; when every
 * entry exports approved translations only; and when the push workflow watches every source.
 *
 * @param {{ config: string, pushWorkflow: string, files: readonly string[],
 *   languages: readonly string[] }} input `languages` are Crowdin language ids, with the name the
 *   app reads each as in `APP_NAMES`
 */
export function crowdinSourceFindings({ config, pushWorkflow, files, languages }) {
  const read = readCrowdinFiles(config);
  if ('invalid' in read) return [`crowdin-conf.yml cannot be read: ${read.invalid}.`];
  const { entries } = read;
  const findings = [];
  const sources = files.filter(
    (file) => file === APP_CATALOGUE || KIT_LABELS.test(file),
  );
  const kits = sources.filter((file) => KIT_LABELS.test(file));
  if (!sources.includes(APP_CATALOGUE))
    findings.push(`${APP_CATALOGUE} is not in the repository, so the app's source was not checked.`);
  if (kits.length === 0)
    findings.push('No kit has a labels/en.json, so the kits were not checked: nothing to iterate.');
  const watched = pushPaths(pushWorkflow).map(pathsGlob);

  for (const source of sources) {
    const matching = entries.filter(
      (entry) => typeof entry['source'] === 'string' && sourcePattern(entry['source']).test(source),
    );
    if (matching.length === 0) {
      findings.push(
        `${source} is matched by no source in crowdin-conf.yml, so it is never offered to a translator.`,
      );
      continue;
    }
    if (matching.length > 1) {
      findings.push(
        `${source} is matched by ${matching.length} sources in crowdin-conf.yml, so it is uploaded twice.`,
      );
      continue;
    }
    const [entry] = matching;
    if (entry['export_only_approved'] !== 'true' && entry['export_only_approved'] !== true)
      findings.push(
        `The source ${entry['source']} does not export approved translations only, which D8 requires.`,
      );
    const directory = source.slice(0, source.lastIndexOf('/'));
    for (const language of languages) {
      const expected = `${directory}/${APP_NAMES[language] ?? language}.json`;
      const actual = translationPath(entry, source, language);
      if (actual !== expected)
        findings.push(
          `Crowdin would write ${source} in ${language} to ${actual ?? 'a path this cannot render'}, ` +
            `and the app reads it at ${expected}.`,
        );
    }
    if (!watched.some((glob) => glob.test(source)))
      findings.push(
        `.github/workflows/crowdin-push.yaml watches no path matching ${source}, so a change to it ` +
          'starts no upload.',
      );
  }
  return findings;
}

/** The app's English catalogue, the first source. */
export const APP_CATALOGUE = 'apps/nuxeo-ui/public/i18n/en.json';

/** A kit's English labels (docs/business-apps/app-definition-v2.md, section 7). */
export const KIT_LABELS = /^business-apps\/packages\/[^/]+\/bundle\/agentic-ui-config\/labels\/en\.json$/;

/**
 * The name the app reads each Crowdin language id as, where the two differ: Norwegian, which a
 * project may target as "Norwegian" (`no`) or "Norwegian Bokmal" (`nb`), is `nb` either way.
 */
export const APP_NAMES = Object.freeze({ no: 'nb' });

function withoutComments(text) {
  return text
    .split('\n')
    .map((line) => {
      let quote = null;
      for (let at = 0; at < line.length; at += 1) {
        const ch = line[at];
        if (quote !== null) {
          if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"') quote = ch;
        else if (ch === '#' && (at === 0 || /\s/.test(line[at - 1]))) return line.slice(0, at);
      }
      return line;
    })
    .join('\n');
}

/** The index of the bracket that closes the one at `open`, outside quotes, or -1. */
function matching(text, open) {
  let depth = 0;
  let quote = null;
  for (let at = open; at < text.length; at += 1) {
    const ch = text[at];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** A YAML flow collection of single-quoted strings, `true` and numbers, as JSON. */
function flowToJson(flow) {
  let json = '';
  for (let at = 0; at < flow.length; at += 1) {
    const ch = flow[at];
    if (ch === "'") {
      let value = '';
      for (at += 1; at < flow.length; at += 1) {
        if (flow[at] === "'" && flow[at + 1] === "'") {
          value += "'";
          at += 1;
        } else if (flow[at] === "'") break;
        else value += flow[at];
      }
      json += JSON.stringify(value);
    } else json += ch;
  }
  // YAML allows a comma before a closing bracket; JSON does not.
  return json.replace(/,(\s*[}\]])/g, '$1');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
