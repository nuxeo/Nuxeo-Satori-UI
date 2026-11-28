/**
 * `satori version <package> <x.y.z | patch | minor | major>`: raises a package's version in every
 * place that carries it, together, so that a change can be installed over the one before it.
 *
 * Nuxeo keeps a package it already has at the same version, so each change installed needs a new
 * one, and the pipeline's step 3 holds three places to one another:
 *
 *   package/package.xml               <package ... version="x.y.z">
 *   bundle/META-INF/MANIFEST.MF       Bundle-Version: x.y.z
 *   bundle/agentic-ui-config/app.json "packageVersion": "x.y.z", when the package has an app
 *
 * It refuses a package where they already disagree, since which is meant cannot be told, and a
 * version that is not higher. Each file is written whole, beside its place, and renamed into it once
 * all are written. Exit codes: 0, done; 1, refused; 2, the command was wrong.
 */
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const USAGE = 'usage: satori version <package> <x.y.z | patch | minor | major>';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PACKAGE_XML = 'package/package.xml';
const MANIFEST = 'bundle/META-INF/MANIFEST.MF';
const APP = 'bundle/agentic-ui-config/app.json';

export function versionCommand(args) {
  if (args.length !== 2 || args.some((arg) => arg.startsWith('-'))) {
    console.error(USAGE);
    return 2;
  }
  const [folder, wanted] = args;
  const directory = resolve(folder);
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`satori version: ${folder} is not a folder.\n${USAGE}`);
    return 2;
  }
  const refuse = (why) => {
    console.error(`satori version: nothing was written: ${why}`);
    return 1;
  };
  const read = (path) => {
    const file = join(directory, ...path.split('/'));
    const entry = lstatSync(file, { throwIfNoEntry: false });
    if (entry === undefined) return null;
    if (!entry.isFile()) return undefined;
    return readFileSync(file, 'utf8');
  };

  const places = [];
  const xml = read(PACKAGE_XML);
  if (typeof xml !== 'string') return refuse(`${PACKAGE_XML} is not a file of ${folder}.`);
  const xmlMatch = /(<package\b[^>]*?\bversion=")([^"]*)(")/.exec(xml);
  if (xmlMatch === null) return refuse(`${PACKAGE_XML} names no version.`);
  places.push({
    path: PACKAGE_XML,
    text: xml,
    found: xmlMatch[2],
    swap: (to) => xml.replace(xmlMatch[0], `${xmlMatch[1]}${to}${xmlMatch[3]}`),
  });

  const manifest = read(MANIFEST);
  if (typeof manifest !== 'string') return refuse(`${MANIFEST} is not a file of ${folder}.`);
  const manifestMatch = /^(Bundle-Version:[ \t]*)([^\r\n]*)/m.exec(manifest);
  if (manifestMatch === null) return refuse(`${MANIFEST} has no Bundle-Version.`);
  places.push({
    path: MANIFEST,
    text: manifest,
    found: manifestMatch[2].trim(),
    swap: (to) => manifest.replace(manifestMatch[0], `${manifestMatch[1]}${to}`),
  });

  const app = read(APP);
  if (app === undefined) return refuse(`${APP} is not a file.`);
  if (app !== null) {
    let value;
    try {
      value = JSON.parse(app.replace(/^﻿/, ''));
    } catch (error) {
      return refuse(`${APP} is not JSON (${error.message}).`);
    }
    if (typeof value?.packageVersion !== 'string') return refuse(`${APP} has no "packageVersion".`);
    const appMatch = /("packageVersion"\s*:\s*")([^"]*)(")/.exec(app);
    if (appMatch === null)
      return refuse(`${APP}'s "packageVersion" could not be found as written.`);
    places.push({
      path: APP,
      text: app,
      found: value.packageVersion,
      swap: (to) => app.replace(appMatch[0], `${appMatch[1]}${to}${appMatch[3]}`),
    });
  }

  const versions = new Set(places.map(({ found }) => found));
  if (versions.size !== 1)
    return refuse(
      `the package's versions disagree (${places.map(({ path, found }) => `${path} ${found}`).join(', ')}), so which is meant cannot be told: put them right by hand first.`,
    );
  const current = places[0].found;
  const parts = SEMVER.exec(current);
  if (parts === null) return refuse(`${current} is not a version of the form x.y.z.`);
  const [major, minor, patch] = parts.slice(1).map(Number);
  const next =
    wanted === 'major'
      ? `${major + 1}.0.0`
      : wanted === 'minor'
        ? `${major}.${minor + 1}.0`
        : wanted === 'patch'
          ? `${major}.${minor}.${patch + 1}`
          : wanted;
  const nextParts = SEMVER.exec(next);
  if (nextParts === null) {
    console.error(`satori version: ${wanted} is not x.y.z, patch, minor or major.\n${USAGE}`);
    return 2;
  }
  const compare = nextParts
    .slice(1)
    .map(Number)
    .map((each, index) => each - [major, minor, patch][index])
    .find((difference) => difference !== 0);
  if (compare === undefined || compare < 0)
    return refuse(`${next} is not higher than ${current}: Nuxeo would keep the package it has.`);

  const written = [];
  try {
    for (const place of places) {
      const file = join(directory, ...place.path.split('/'));
      const temporary = `${file}.satori-${process.pid}`;
      writeFileSync(temporary, place.swap(next), { flag: 'wx' });
      written.push({ temporary, file });
    }
  } catch (error) {
    for (const { temporary } of written) rmSync(temporary, { force: true });
    return refuse(`a file could not be written (${error.code ?? error.message}).`);
  }
  for (const { temporary, file } of written) renameSync(temporary, file);
  process.stdout.write(
    `satori version: ${current} to ${next}, in ${places.map(({ path }) => path).join(', ')}. Build it, and install the zip over ${current}.\n`,
  );
  return 0;
}
