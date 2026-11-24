#!/usr/bin/env node
/**
 * The server over stdio, as an MCP client such as Claude Code starts it:
 *
 *   node tools/builder-mcp/src/main.ts
 *
 * Node 24 runs this TypeScript as it is, stripping the types; there is no build step. The
 * environment is read once, here: NUXEO_URL, NUXEO_USER and NUXEO_PASS, and DEV_SERVER_URL for
 * preview_package (config.ts). Without the credentials the server still starts, so that
 * validate_package and preview_package answer, and each Nuxeo tool says what is missing.
 *
 * stdout is the protocol's, so nothing else is written to it. It runs unconditionally: a "was I
 * started directly?" guard is how another entry point in this repository once did nothing.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readDevServer, readTarget } from './config.ts';
import { NuxeoReader } from './nuxeo.ts';
import { createServer } from './server.ts';

const read = readTarget(process.env);
if ('problem' in read)
  process.stderr.write(`nuxeo-builder: the Nuxeo tools will refuse: ${read.problem}\n`);
// A reader per tool call: each call asks Nuxeo who it runs as before it reads anything.
const nuxeo = 'target' in read ? () => new NuxeoReader(read.target) : read;
const devServer = readDevServer(process.env);
if (typeof devServer !== 'string')
  process.stderr.write(`nuxeo-builder: preview_package will refuse: ${devServer.problem}\n`);

serveStdio(() => createServer({ nuxeo, devServer }), {
  onerror: (error) => process.stderr.write(`nuxeo-builder: ${error.message}\n`),
});
