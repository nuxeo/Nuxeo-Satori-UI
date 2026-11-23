#!/usr/bin/env node
/**
 * The server over stdio, as an MCP client such as Claude Code starts it:
 *
 *   node tools/builder-mcp/src/main.ts
 *
 * Node 24 runs this TypeScript as it is, stripping the types; there is no build step. The
 * environment is read once, here: NUXEO_URL, NUXEO_USER and NUXEO_PASS (config.ts). Without the
 * credentials the server still starts, so that validate_package answers, and each Nuxeo tool says
 * what is missing.
 *
 * stdout is the protocol's, so nothing else is written to it. It runs unconditionally: a "was I
 * started directly?" guard is how another entry point in this repository once did nothing.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readTarget } from './config.ts';
import { NuxeoReader } from './nuxeo.ts';
import { createServer } from './server.ts';

const read = readTarget(process.env);
const nuxeo = 'target' in read ? new NuxeoReader(read.target) : read;
if ('problem' in nuxeo)
  process.stderr.write(`nuxeo-builder: the Nuxeo tools will refuse: ${nuxeo.problem}\n`);

serveStdio(() => createServer({ nuxeo }), {
  onerror: (error) => process.stderr.write(`nuxeo-builder: ${error.message}\n`),
});
