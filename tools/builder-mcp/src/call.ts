#!/usr/bin/env node
/**
 * One call to the Builder MCP server, from a shell, without registering the server in anyone's
 * Claude configuration: the moves and P&C kits' runs each wrote a client of their own for this,
 * outside the repository (the P&C kit's feedback, item 15).
 *
 *   node tools/builder-mcp/src/call.ts --list
 *   node tools/builder-mcp/src/call.ts <tool> ['<arguments, a JSON object>']
 *   node tools/builder-mcp/src/call.ts <tool> - < arguments.json
 *
 * It starts the server as an MCP client does, `node tools/builder-mcp/src/main.ts` over stdio,
 * with this shell's environment, so `NUXEO_URL`, `NUXEO_USER`, `NUXEO_PASS`, `DEV_SERVER_URL` and
 * `BUILDER_PACKAGE_ROOTS` are read there as they are for a registered server, and never here;
 * opens the session, calls the one tool, prints its answer to stdout, its JSON indented, and
 * stops the server. `-` reads the arguments from standard input, for a layout's whole content.
 *
 * Exit codes: 0, the tool answered; 1, it answered with an error, or the server refused the call,
 * such as for arguments the tool does not take, printed to stderr; 2, the command was wrong, or
 * the server did not answer.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));
const USAGE =
  'usage: node tools/builder-mcp/src/call.ts --list\n' +
  "       node tools/builder-mcp/src/call.ts <tool> ['<arguments, a JSON object>' | -]";
/** Past this the server is stopped: a write runs the pipeline and the generators, a minute or two. */
const TIMEOUT_MS = 600_000;

function usage(message?: string): never {
  process.stderr.write(`${message ? `${message}\n` : ''}${USAGE}\n`);
  process.exit(2);
}

const [tool, given, ...extra] = process.argv.slice(2);
if (tool === undefined || extra.length > 0) usage();
let args: unknown = {};
if (tool !== '--list' && given !== undefined) {
  try {
    args = JSON.parse(given === '-' ? readFileSync(0, 'utf8') : given);
  } catch (error) {
    usage(`The arguments are not JSON: ${(error as Error).message}`);
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args))
    usage(
      'The arguments are one JSON object, such as \'{ "package": "business-apps/packages/x" }\'.',
    );
}

const child = spawn(process.execPath, [ENTRY], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
const pending = new Map<number, (message: Record<string, unknown>) => void>();
let buffer = '';
child.stdout.on('data', (chunk: Buffer) => {
  buffer += chunk.toString('utf8');
  for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (line === '') continue;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Not the protocol's: stdout is the protocol's only, so this is a server fault, said below.
      stderr += `The server wrote a line that is not JSON-RPC.\n`;
      continue;
    }
    if (typeof message['id'] === 'number') pending.get(message['id'])?.(message);
  }
});
let next = 0;
const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
const request = (method: string, params: unknown) =>
  new Promise<Record<string, unknown>>((done) => {
    const id = ++next;
    pending.set(id, done);
    send({ jsonrpc: '2.0', id, method, params });
  });
const stop = () => {
  child.stdin.end();
  child.kill();
};
const timer = setTimeout(() => {
  stop();
  process.stderr.write(`The server did not answer within ${TIMEOUT_MS / 1000}s.\n${stderr}`);
  process.exit(2);
}, TIMEOUT_MS);
child.on('exit', (code) => {
  if (pending.size > 0) {
    process.stderr.write(`The server stopped (exit ${code}) before it answered.\n${stderr}`);
    process.exit(2);
  }
});

const opened = await request('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'builder-mcp-call', version: '0' },
});
pending.clear();
if (opened['error']) {
  stop();
  usage(`initialize: ${(opened['error'] as { message: string }).message}`);
}
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

const answer =
  tool === '--list'
    ? await request('tools/list', {})
    : await request('tools/call', { name: tool, arguments: args });
pending.clear();
clearTimeout(timer);
stop();
// A tool's call the server refused, its arguments for one, is the tool's error: exit 1.
if (answer['error']) {
  process.stderr.write(`${tool}: ${(answer['error'] as { message: string }).message}\n`);
  process.exit(tool === '--list' ? 2 : 1);
}
const result = answer['result'] as {
  tools?: { name: string; title?: string }[];
  isError?: boolean;
  content?: { text?: string }[];
};
if (tool === '--list') {
  for (const each of result.tools ?? [])
    process.stdout.write(`${each.name}${each.title ? `: ${each.title}` : ''}\n`);
  process.exit(0);
}
const text = (result.content ?? []).map((block) => block.text ?? '').join('');
if (result.isError) {
  process.stderr.write(`${text}\n`);
  process.exit(1);
}
let shown = text;
try {
  shown = JSON.stringify(JSON.parse(text), null, 2);
} catch {
  // Not JSON: printed as it is.
}
process.stdout.write(`${shown}\n`);
process.exit(0);
