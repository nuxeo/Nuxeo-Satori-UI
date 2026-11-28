/**
 * `satori tool [--list | <name> [<arguments as JSON>]]`: the MCP server's tools from the command
 * line, for an agent whose IDE cannot run the server, as when an organisation's policy allows only
 * the MCP servers it lists, or for a person at a terminal.
 *
 * It starts `satori mcp`, the same server an IDE starts, in this folder, with this process's
 * environment, asks it one thing over stdio, prints the answer and stops it. So every read is the
 * server's read, and every write is the server's validated write: kept only when the package then
 * passes `satori validate`'s steps. Nothing here reads a credential: the server does, from
 * `NUXEO_URL`, `NUXEO_USER` and `NUXEO_PASS`, as it always does.
 *
 * - `--list` prints each tool, its title, what it does and the arguments it takes, as JSON.
 * - `<name> [<json>]` calls one, its arguments an object, `{}` when none are given, and prints its
 *   answer's text: JSON for every tool of the server.
 *
 * Exit codes: 0, the tool answered; 1, it answered with an error, such as a refused write; 2, the
 * command was wrong, or the server could not be started.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const USAGE = "usage: satori tool --list | satori tool <name> ['<arguments as JSON>']";
const TIMEOUT_MS = 300_000;

export async function toolCommand(args, { here }) {
  if (args.length === 0 || args.length > 2) return usage();
  const list = args[0] === '--list';
  if (list && args.length > 1) return usage();
  if (!list && args[0].startsWith('-')) return usage();
  let parameters = {};
  if (!list && args[1] !== undefined) {
    try {
      parameters = JSON.parse(args[1]);
    } catch (error) {
      console.error(`satori tool: the arguments are not JSON (${error.message}).\n${USAGE}`);
      return 2;
    }
    if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) {
      console.error(`satori tool: the arguments are a JSON object, such as '{ "type": "Claim" }'.`);
      return 2;
    }
  }
  const server = spawn(process.execPath, [join(here, 'satori.mjs'), 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  let buffer = '';
  let said = '';
  const pending = new Map();
  server.stderr.on('data', (chunk) => (said += chunk));
  server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  let id = 0;
  const ask = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => reject(new Error(`${method} had no answer`)), TIMEOUT_MS);
      pending.set(n, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    });
  const stopped = new Promise((resolve) => server.on('close', resolve));
  try {
    const started = await Promise.race([
      ask('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'satori tool', version: '1' },
      }),
      stopped.then(() => null),
    ]);
    if (started === null || started.error) {
      console.error(
        `satori tool: the MCP server did not start${said.trim() ? `:\n${said.trim()}` : '.'}`,
      );
      return 2;
    }
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    if (list) {
      const answer = await ask('tools/list', {});
      const tools = (answer.result?.tools ?? []).map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        arguments: tool.inputSchema?.properties ?? {},
        required: tool.inputSchema?.required ?? [],
      }));
      process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`);
      return 0;
    }
    const answer = await ask('tools/call', { name: args[0], arguments: parameters });
    if (answer.error) {
      console.error(`satori tool: ${answer.error.message ?? JSON.stringify(answer.error)}`);
      return 2;
    }
    const text = (answer.result?.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    (answer.result?.isError ? process.stderr : process.stdout).write(`${text}\n`);
    if (answer.result?.isError) return 1;
    // A write the pipeline refused is an answer, and the package is as it was: exit 1, as validate does.
    try {
      const value = JSON.parse(text);
      if (value?.written === false && value?.validation?.passed === false) return 1;
      if (value?.passed === false) return 1;
    } catch {
      // Not JSON: the answer is the text.
    }
    return 0;
  } catch (error) {
    console.error(`satori tool: ${error.message}`);
    return 2;
  } finally {
    server.stdin.end();
    server.kill();
  }
}

function usage() {
  console.error(USAGE);
  return 2;
}
