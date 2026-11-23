/**
 * A minimal MCP client for the tests: JSON-RPC over a transport, opened the way today's clients
 * open a connection (`initialize`, then `notifications/initialized`). The SDK's client package is
 * not installed, and the server is what is under test, so the client is as small as it can be.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';

export interface ToolResult {
  readonly isError?: boolean;
  readonly content: readonly { readonly type: string; readonly text: string }[];
}

export interface Client {
  request(
    method: string,
    params?: unknown,
  ): Promise<{ result?: unknown; error?: { message: string } }>;
  /** A tool's text, parsed when it is JSON, with whether it was an error. */
  call(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ isError: boolean; text: string; json: unknown }>;
  close(): Promise<void>;
}

const OPENING = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'spec', version: '0' },
};

function clientOver(send: (message: unknown) => void, close: () => Promise<void>) {
  let id = 0;
  const pending = new Map<
    number,
    (message: { result?: unknown; error?: { message: string } }) => void
  >();
  const receive = (message: { id?: number; result?: unknown; error?: { message: string } }) => {
    if (typeof message.id === 'number') pending.get(message.id)?.(message);
  };
  const request: Client['request'] = (method, params = {}) =>
    new Promise((done) => {
      const next = ++id;
      pending.set(next, done);
      send({ jsonrpc: '2.0', id: next, method, params });
    });
  const client: Client = {
    request,
    async call(name, args = {}) {
      const answer = await request('tools/call', { name, arguments: args });
      if (answer.error) throw new Error(`tools/call ${name}: ${answer.error.message}`);
      const result = answer.result as ToolResult;
      const text = result.content.map((block) => block.text).join('');
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        // An error's text is a sentence, not JSON.
      }
      return { isError: result.isError === true, text, json };
    },
    close,
  };
  return { client, receive };
}

async function open(client: Client, send: (message: unknown) => void): Promise<Client> {
  const opened = await client.request('initialize', OPENING);
  if (opened.error) throw new Error(`initialize: ${opened.error.message}`);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return client;
}

/** A client connected in memory to a server built in the test. */
export async function connect(server: McpServer): Promise<Client> {
  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  await server.connect(theirs);
  const send = (message: unknown) => void ours.send(message as Parameters<typeof ours.send>[0]);
  const { client, receive } = clientOver(send, async () => {
    await ours.close();
    await server.close();
  });
  ours.onmessage = (message) => receive(message as { id?: number });
  await ours.start();
  return open(client, send);
}

/** A client speaking to the real entry point over stdio, in a child process. */
export async function spawnServer(
  entry: string,
  env: NodeJS.ProcessEnv,
): Promise<Client & { stderr: () => string }> {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [entry], {
    env,
    stdio: 'pipe',
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const { client, receive } = clientOver(send, async () => {
    child.stdin.end();
    await new Promise((done) => child.once('close', done));
  });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) receive(JSON.parse(line));
    }
  });
  await open(client, send);
  return Object.assign(client, { stderr: () => stderr });
}
