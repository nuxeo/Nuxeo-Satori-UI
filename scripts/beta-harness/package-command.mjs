/**
 * Run package tools without a shell, including on Windows where their .cmd shims
 * cannot be passed to spawn/execFile. Arguments remain separate argv entries.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, realpathSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';

const PACKAGE_TOOLS = new Set(['npm', 'npx', 'nx']);

/** Resolve from the launcher, not cwd: scratch installs deliberately have no npm dependency. */
export function packageCommand(command, args = [], options = {}) {
  if (!PACKAGE_TOOLS.has(command)) return { command, args };
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  if (command === 'nx') {
    const require = createRequire(join(resolve(cwd), 'package.json'));
    const manifest = require.resolve('nx/package.json');
    const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin.nx;
    return { command: process.execPath, args: [resolve(dirname(manifest), bin), ...args] };
  }

  const entry = `${command}-cli.js`;
  const candidates = [];
  if (env.npm_execpath && /npm-cli\.js$/i.test(env.npm_execpath)) {
    candidates.push(join(dirname(env.npm_execpath), entry));
  }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  for (const bin of [dirname(process.execPath), ...(env[pathKey] ?? '').split(delimiter)]) {
    if (!bin) continue;
    candidates.push(join(bin, 'node_modules', 'npm', 'bin', entry));
    // POSIX installs commonly symlink /usr/bin/npm to npm's bin/npm-cli.js.
    for (const shim of ['npm', 'npm.cmd']) {
      const path = join(bin, shim);
      if (existsSync(path)) candidates.push(join(dirname(realpathSync(path)), entry));
    }
  }
  const cli = candidates.find((path) => existsSync(path));
  if (!cli)
    throw new Error(`Cannot locate ${entry}; install npm alongside Node or put npm on PATH.`);
  return { command: process.execPath, args: [cli, ...args] };
}

function invocation(command, args, options) {
  if (options?.shell) throw new Error('Package commands must run without a shell.');
  return packageCommand(command, args, options);
}

export function spawnToolSync(command, args, options = {}) {
  const tool = invocation(command, args, options);
  return spawnSync(tool.command, tool.args, { ...options, shell: false });
}

export function execToolSync(command, args, options = {}) {
  const tool = invocation(command, args, options);
  return execFileSync(tool.command, tool.args, { ...options, shell: false });
}

export function spawnTool(command, args, options = {}) {
  const tool = invocation(command, args, options);
  return spawn(tool.command, tool.args, { ...options, shell: false });
}
