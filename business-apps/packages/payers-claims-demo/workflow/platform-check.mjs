#!/usr/bin/env node
/**
 * Hold the claims review workflow to a Nuxeo server's own classes, with no deploy: copy the jars
 * `PlatformCheck.java` needs out of the local container, read-only, into a temporary folder, and
 * run it there (PlatformCheck.java says what it checks, and what it does not).
 *
 *   node business-apps/packages/payers-claims-demo/workflow/platform-check.mjs
 *
 * Reads the container with `docker exec <container> cat` and `unzip -p` alone: nothing is written,
 * installed or restarted there. NUXEO_CONTAINER names it, `nuxeo` by default. Needs Docker, the
 * container running, and Java 21 or later on this machine. CI has neither, and does not run it.
 *
 * Exit codes: 0, every check passed; 1, one failed; 2, a precondition: no Docker, no container,
 * no Java, or a jar the container does not have.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { HERE, KIT } from './route-model.mjs';

const CONTAINER = process.env['NUXEO_CONTAINER'] || 'nuxeo';
const SERVER = '/opt/nuxeo/server';
/** What the check loads, by where the container has it: bundles, then the server's libraries. */
const JARS = [
  'nxserver/bundles/nuxeo-common-*.jar',
  'nxserver/bundles/nuxeo-runtime-[0-9]*.jar',
  'nxserver/bundles/nuxeo-core-api-*.jar',
  'nxserver/bundles/nuxeo-core-schema-*.jar',
  'nxserver/bundles/nuxeo-core-io-*.jar',
  'nxserver/bundles/nuxeo-core-event-*.jar',
  'nxserver/bundles/nuxeo-core-el-*.jar',
  'nxserver/bundles/nuxeo-core-[0-9]*.jar',
  'nxserver/bundles/nuxeo-automation-core-*.jar',
  'nxserver/bundles/nuxeo-routing-api-*.jar',
  'nxserver/bundles/nuxeo-routing-core-*.jar',
  'nxserver/bundles/nuxeo-platform-actions-core-*.jar',
  'nxserver/bundles/nuxeo-platform-directory-api-*.jar',
  'nxserver/bundles/nuxeo-platform-directory-core-*.jar',
  'nxserver/lib/dom4j-*.jar',
  'nxserver/lib/commons-io-*.jar',
  'nxserver/lib/commons-codec-*.jar',
  'nxserver/lib/xsom-*.jar',
  'nxserver/lib/relaxngDatatype-*.jar',
  'nxserver/lib/mvel2-*.jar',
  'lib/commons-lang3-*.jar',
  'lib/log4j-api-*.jar',
  'lib/log4j-core-*.jar',
  'lib/xercesImpl-*.jar',
  'lib/el-api.jar',
];
const CONTROL_JAR = 'nxserver/bundles/nuxeo-routing-default-*.jar';
const CONTROL_ENTRY = 'data/SerialDocumentReview.zip';

/** A precondition this machine or the container does not meet: fix it, not the check. */
class Precondition extends Error {}
const fail = (message) => {
  throw new Precondition(message);
};
const run = (command, args, options = {}) =>
  spawnSync(command, args, { maxBuffer: 256 * 1024 * 1024, ...options });

/** The one file in the container a pattern names, or a precondition when it names none or two. */
function resolveOne(pattern) {
  const listed = run('docker', ['exec', CONTAINER, 'sh', '-c', `ls -1 ${SERVER}/${pattern}`], {
    encoding: 'utf8',
  });
  const found = (listed.stdout ?? '').split('\n').filter(Boolean);
  if (found.length !== 1)
    fail(
      `${CONTAINER} has ${found.length} files for ${SERVER}/${pattern}, and the check needs one`,
    );
  return found[0];
}

const scratch = mkdtempSync(join(tmpdir(), 'payers-platform-check-'));
try {
  const java = run('java', ['-version'], { encoding: 'utf8' });
  if (java.error || java.status !== 0)
    fail('Java 21 or later is needed on this machine: none found.');
  const docker = run('docker', ['exec', CONTAINER, 'true']);
  if (docker.error || docker.status !== 0)
    fail(`docker exec ${CONTAINER} failed: is Docker running, with the container ${CONTAINER} up?`);
  const classpath = [];
  for (const pattern of JARS) {
    const path = resolveOne(pattern);
    const copy = run('docker', ['exec', CONTAINER, 'cat', path]);
    if (copy.status !== 0) fail(`could not read ${path} from ${CONTAINER}`);
    const local = join(scratch, path.slice(path.lastIndexOf('/') + 1));
    writeFileSync(local, copy.stdout);
    classpath.push(local);
  }
  const controlJar = resolveOne(CONTROL_JAR);
  const control = run('docker', ['exec', CONTAINER, 'unzip', '-p', controlJar, CONTROL_ENTRY]);
  if (control.status !== 0 || control.stdout.length === 0)
    fail(`${controlJar} has no ${CONTROL_ENTRY}, the control the check reads first`);
  const controlZip = join(scratch, 'SerialDocumentReview.zip');
  writeFileSync(controlZip, control.stdout);
  console.log(`Copied ${classpath.length} jars and the control from ${CONTAINER}, read-only.`);

  const check = run(
    'java',
    [
      '-cp',
      classpath.join(delimiter),
      '-Dlog4j2.level=ERROR',
      join(HERE, 'PlatformCheck.java'),
      KIT,
      controlZip,
    ],
    { stdio: 'inherit' },
  );
  process.exitCode = check.status === 0 ? 0 : 1;
} catch (error) {
  if (!(error instanceof Precondition)) throw error;
  console.error(error.message);
  process.exitCode = 2;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
