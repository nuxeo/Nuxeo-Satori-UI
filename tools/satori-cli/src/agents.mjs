/**
 * `satori agents sync [<directory>] [--check]`: what a customer's AI IDE needs to build with the
 * tool, in their configuration repository, `.` unless another folder is named. Each file is the
 * tool's own, versioned with it, so a new version of the tool brings new files, and running it
 * again changes nothing:
 *
 *   .cursor/skills/satori-app-builder/SKILL.md   the app builder skill, for Cursor
 *   .claude/skills/satori-app-builder/SKILL.md   the same, for Claude Code
 *   .agent/skills/satori-app-builder/SKILL.md    the same, for any other agent
 *   AGENTS.md                                    the section between its markers
 *   .mcp.json, .cursor/mcp.json                  the server `nuxeo-satori`, `satori mcp`
 *
 * - **The skill files are the tool's, whole.** The skill is the customer edition of this
 *   repository's `app-builder` skill, carried as `agents/skills/satori-app-builder/SKILL.md`, the
 *   same bytes in all three places, with a line saying which version wrote it.
 * - **In `AGENTS.md`, only the section between `<!-- BEGIN satori agents` and
 *   `<!-- END satori agents -->` is the tool's.** It is written in place, or added at the end of a
 *   file that has none, or makes the file when there is none. Everything outside it is the
 *   customer's, and kept byte for byte. A file with a marker missing, repeated or out of order is
 *   refused, since what is the customer's could not be told.
 * - **In each MCP file, only the server `nuxeo-satori` is the tool's.** It starts the tool the
 *   repository installs, from `node_modules/.bin`, never through a fetch. Its address and
 *   credentials are references to the environment, `NUXEO_URL`, `NUXEO_USER` and `NUXEO_PASS`, in
 *   each client's own syntax, and never a value: nothing is read from the environment here. Every
 *   other server and key is kept. A file that is not a JSON object is refused.
 * - **Nothing is followed.** A target, or a folder on the way to it, that is a link, or is not
 *   what it should be, is refused, so nothing is written outside the repository.
 * - **All or nothing.** Every file is worked out first; with one refused, none is written.
 * - **`--check`** writes nothing, and exits 1 naming each file that is not what this version
 *   writes: for the repository's CI, so that a new version of the tool, or an edit of a managed
 *   section, is seen.
 *
 * Exit codes: 0, done, or in step; 1, refused, or with `--check` not in step; 2, the command was
 * wrong.
 */
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const USAGE = 'usage: satori agents sync [<directory>] [--check]';

export const SKILL = 'satori-app-builder';
export const SERVER = 'nuxeo-satori';
const BEGIN = '<!-- BEGIN satori agents';
const END = '<!-- END satori agents -->';
/** What the server reads, each given to it as a reference to the environment, never a value. */
export const SERVER_VARIABLES = ['NUXEO_URL', 'NUXEO_USER', 'NUXEO_PASS'];

/** The MCP files, each in its client's form. */
const MCP_FILES = [
  {
    file: '.mcp.json',
    // Claude Code's: started in the repository, `${NAME:-}` read from its environment, empty when
    // unset, which the server reads as unset and says so.
    entry: () => ({
      type: 'stdio',
      command: 'node_modules/.bin/satori',
      args: ['mcp'],
      env: Object.fromEntries(SERVER_VARIABLES.map((name) => [name, `\${${name}:-}`])),
    }),
  },
  {
    file: join('.cursor', 'mcp.json'),
    // Cursor's: `${workspaceFolder}` for the repository, `${env:NAME}` for the environment.
    entry: () => ({
      type: 'stdio',
      command: '${workspaceFolder}/node_modules/.bin/satori',
      args: ['mcp', '--root', '${workspaceFolder}'],
      env: Object.fromEntries(SERVER_VARIABLES.map((name) => [name, `\${env:${name}}`])),
    }),
  },
];

export function agentsCommand(args, context) {
  if (args[0] !== 'sync') {
    console.error(USAGE);
    return 2;
  }
  const rest = args.slice(1);
  const check = rest.includes('--check');
  const positionals = rest.filter((arg) => arg !== '--check');
  if (positionals.length > 1 || positionals.some((arg) => arg.startsWith('-'))) {
    console.error(USAGE);
    return 2;
  }
  const directory = resolve(positionals[0] ?? '.');
  const entry = lstatSync(directory, { throwIfNoEntry: false });
  if (!entry?.isDirectory()) {
    console.error(
      `${positionals[0] ?? '.'} is not a folder: agents sync writes into a repository.`,
    );
    return 2;
  }
  const planned = agentFiles(directory, context);
  if ('problems' in planned) {
    console.error(`satori agents sync: nothing was written.`);
    for (const problem of planned.problems) console.error(`  - ${problem}`);
    return 1;
  }
  const differing = planned.files.filter(({ now, want }) => now !== want);
  if (check) {
    if (differing.length === 0) {
      process.stdout.write(
        `satori agents sync --check: the agent files are those @nuxeo/satori-cli ${context.version} writes.\n`,
      );
      return 0;
    }
    console.error(
      `satori agents sync --check: ${differing.length} file(s) are not what @nuxeo/satori-cli ${context.version} writes; run satori agents sync, and commit them:`,
    );
    for (const { path, now } of differing)
      console.error(`  - ${path}${now === null ? ', missing' : ''}`);
    return 1;
  }
  for (const { target, want } of differing) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, want);
  }
  process.stdout.write(
    differing.length === 0
      ? `satori agents sync: in step with @nuxeo/satori-cli ${context.version}; nothing was written.\n`
      : `satori agents sync: from @nuxeo/satori-cli ${context.version}:\n${planned.files
          .map(
            ({ path, now, want }) =>
              `  ${path}: ${now === want ? 'unchanged' : now === null ? 'written' : 'refreshed'}`,
          )
          .join('\n')}\n`,
  );
  return 0;
}

/**
 * Every file `sync` manages in `directory`, as it is and as this version writes it, or the
 * problems that refuse it. `context.here` is where the tool is, `context.version` its version.
 */
export function agentFiles(directory, { here, version }) {
  const problems = [];
  const files = [];
  const read = (path) => {
    const target = join(directory, path);
    const problem = unfollowed(directory, path);
    if (problem !== null) {
      problems.push(problem);
      return { target, now: undefined };
    }
    const entry = lstatSync(target, { throwIfNoEntry: false });
    return { target, now: entry ? readFileSync(target, 'utf8') : null };
  };
  const plan = (path, want) => {
    const { target, now } = read(path);
    if (now === undefined) return;
    const wanted = want(now);
    if (typeof wanted === 'string') files.push({ path: shown(path), target, now, want: wanted });
    else problems.push(`${shown(path)}: ${wanted.problem}`);
  };

  const skill = skillText(
    readFileSync(join(here, 'agents', 'skills', SKILL, 'SKILL.md'), 'utf8'),
    version,
  );
  for (const folder of ['.cursor', '.claude', '.agent'])
    plan(join(folder, 'skills', SKILL, 'SKILL.md'), () => skill);

  const section = readFileSync(join(here, 'agents', 'AGENTS.section.md'), 'utf8').replaceAll(
    '{{version}}',
    version,
  );
  plan('AGENTS.md', (now) => withSection(now, section, version));

  for (const { file, entry } of MCP_FILES) plan(file, (now) => withServer(now, entry()));
  return problems.length > 0 ? { problems } : { files };
}

/** The skill as installed: the carried text, with the line saying what wrote it after its header. */
function skillText(text, version) {
  const header = /^---\n[\s\S]*?\n---\n/.exec(text);
  if (header === null) throw new Error(`the carried skill has no front matter.`);
  return `${header[0]}\n<!-- Written by satori agents sync, from @nuxeo/satori-cli ${version}, and replaced whole by it: keep your own rules in AGENTS.md, outside its satori section. -->\n${text.slice(header[0].length)}`;
}

/** `AGENTS.md` with the tool's section in it, everything else as it was. */
function withSection(now, section, version) {
  // The section's own line ending when it has one, else the file's first, else a line feed.
  const marked = now === null ? -1 : now.indexOf(BEGIN);
  const from = marked < 0 ? (now ?? '') : now.slice(marked);
  const eol = /^[^\n]*\r\n/.test(from) ? '\r\n' : '\n';
  const block = [
    `${BEGIN}: written by satori agents sync, from @nuxeo/satori-cli ${version}. Edits between these markers are replaced; write yours outside them. -->`,
    ...section.replace(/\n+$/, '').split('\n'),
    END,
  ].join(eol);
  if (now === null) return `# AGENTS.md${eol}${eol}${block}${eol}`;
  const lines = now.split(/\r?\n/);
  const begins = lines.flatMap((line, index) => (line.startsWith(BEGIN) ? [index] : []));
  const ends = lines.flatMap((line, index) => (line === END ? [index] : []));
  if (begins.length === 0 && ends.length === 0) {
    const kept = now.replace(/(\r?\n)*$/, '');
    return `${kept}${kept === '' ? '' : `${eol}${eol}`}${block}${eol}`;
  }
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0])
    return {
      problem: `its satori section is not one "${BEGIN} ..." line followed by one "${END}" line (${begins.length} and ${ends.length} found), so what is yours cannot be told from what is the tool's. Put the two markers right, or remove both, and run it again.`,
    };
  // The text around the section, as it was, to the byte.
  const offsets = lineOffsets(now);
  const before = now.slice(0, offsets[begins[0]]);
  const after = now.slice(offsets[ends[0]] + END.length);
  return `${before}${block}${after}`;
}

/** Where each line of `text` starts. */
function lineOffsets(text) {
  const offsets = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === '\n') offsets.push(index + 1);
  return offsets;
}

/** An MCP file with the tool's server in it, every other key as it was. */
function withServer(now, entry) {
  let value = {};
  if (now !== null) {
    try {
      value = JSON.parse(now.replace(/^\uFEFF/, ''));
    } catch (error) {
      return { problem: `it is not JSON (${error.message}), so its servers cannot be kept.` };
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return { problem: 'it is not a JSON object.' };
    if (
      value.mcpServers !== undefined &&
      (value.mcpServers === null ||
        typeof value.mcpServers !== 'object' ||
        Array.isArray(value.mcpServers))
    )
      return { problem: '"mcpServers" is not an object.' };
  }
  const servers = { ...(value.mcpServers ?? {}) };
  servers[SERVER] = entry;
  return `${JSON.stringify({ ...value, mcpServers: servers }, null, 2)}\n`;
}

/**
 * Why `path` inside `directory` may not be written, or `null`: a part of it that is a link, or a
 * folder on the way that is not a folder, or the file itself that is not a file.
 */
function unfollowed(directory, path) {
  const parts = path.split(sep);
  let current = directory;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (entry === undefined) return null;
    const last = index === parts.length - 1;
    if (entry.isSymbolicLink())
      return `${shown(relative(directory, current))} is a link, which is not followed: nothing is written through one.`;
    if (last ? !entry.isFile() : !entry.isDirectory())
      return `${shown(relative(directory, current))} is not a ${last ? 'file' : 'folder'}.`;
    if (last && entry.nlink > 1)
      return `${shown(relative(directory, current))} has a second name, a hard link, which is not followed.`;
  }
  return null;
}

function shown(path) {
  return path.split(sep).join('/');
}
