/**
 * A reviewer's approval of a migration's report (docs/business-apps/studio-migration.md, sections
 * 5 and 8): who approved the report and its decisions, when, and the SHA-256 of what they
 * approved. It is kept in the conversion's `approval.json`, which only the `approve` command
 * writes, and readiness needs one whose digests are those of the conversion as it is now.
 *
 * **What is approved.** `report.json` and `decisions.json`, each as the tool reads it and writes it
 * back, two-space JSON, so that any change to what either says voids the approval and their
 * spacing alone does not; and every other file of the conversion, `app/` and `themes/`, by its path
 * and bytes. A conversion made again, decisions carried or filled in, a file edited by hand: each
 * changes a digest, and the approval is void, which readiness and the report say. And each plugin
 * the report accepts, a custom element's (M3): every file of its library, `studio-plugin.json`
 * among them, by its path and content, as check 9 read it. A plugin changed after its approval
 * voids it; a conversion that accepts no plugin has none, and an approval of it names none.
 *
 * **Who approves.** A person, named with `--by`, at a terminal. `approve` is the only command that
 * writes an approval: `migrate`, for one package or many, never runs it, and it refuses to run
 * where nothing can answer it, as in a script, a pipeline or an agent's run, whose input is not a
 * terminal. There it asks the person to type back the first characters of the digest it shows.
 * So an agent's own run cannot approve itself in the normal course of a run. It is no proof of who
 * typed: someone at a terminal, or a program that drives one, can type any name, and the approval
 * is a record of who said they approved, as a signature on paper is, not a cryptographic one.
 */
import { createHash } from 'node:crypto';
import { isRecord } from '@agentic-ui/shared/app-definition';
import { PLUGIN_DIRECTORY } from './convert-elements';
import type { Conversion, MigrationReport } from './convert';
import { legible, type DecisionsBuild } from './decisions';

export const APPROVAL_FORMAT = 'studio-migration-approval/1';

/** Its place in a conversion directory, beside `report.json` and `decisions.json`. */
export const APPROVAL_FILE = 'approval.json';

/** How many characters of the digest the person types back. */
export const CONFIRM_LENGTH = 8;

/** The SHA-256 of what an approval approves, each in hexadecimal. */
export interface ApprovedDigests {
  readonly report: string;
  /** `null` when the conversion holds no `decisions.json`. */
  readonly decisions: string | null;
  /** Every other file of the conversion, `app/` and `themes/`, by its path and bytes. */
  readonly files: string;
  /**
   * Every file of each plugin the report accepts, by its library, path and content; `null` when
   * it accepts none. An approval written before plugins were covered has none, which holds only
   * for a conversion that accepts no plugin.
   */
  readonly plugins: string | null;
}

/**
 * The files of a plugin library, as text by their path under it, as check 9 read them; `null`
 * when the library is not there. Given by whoever read the plugins (`plugins.ts`).
 */
export type PluginFiles = (library: string) => Readonly<Record<string, string>> | null;

/** A library a plugin is written to, `libs/extensions/<element>`: no other directory is read. */
const PLUGIN_LIBRARY = new RegExp(`^${PLUGIN_DIRECTORY}/[a-z][a-z0-9]*(-[a-z0-9]+)+$`);

/**
 * The libraries of the plugins the report accepts, sorted: each custom element's proposal that
 * the conversion was made with accepted, by the library the report names. An id listed twice is
 * its first entry's, as the decisions read it.
 */
export function acceptedPlugins(report: Pick<MigrationReport, 'constructs'>): string[] {
  const seen = new Set<string>();
  const libraries = new Set<string>();
  for (const entry of Array.isArray(report.constructs) ? report.constructs : []) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (
      entry.kind === 'custom-element' &&
      entry.outcome === 'proposed' &&
      entry.proposal === true &&
      entry.applied === 'accept'
    )
      libraries.add(typeof entry.to === 'string' ? entry.to : '');
  }
  return [...libraries].sort();
}

/** The digest of the accepted plugins' files, or `null` when the report accepts none. */
function pluginsDigest(libraries: readonly string[], plugins: PluginFiles): string | null {
  if (libraries.length === 0) return null;
  const lines: string[] = [];
  for (const library of libraries) {
    // A library the report names elsewhere than a plugin's directory is read from nowhere.
    const files = PLUGIN_LIBRARY.test(library) ? plugins(library) : null;
    if (files === null) {
      lines.push(`${library}\u0000missing\n`);
      continue;
    }
    for (const path of Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      lines.push(`${library}/${path}\u0000${sha256(files[path])}\n`);
  }
  return sha256(lines.join(''));
}

export interface Approval extends Omit<ApprovedDigests, 'plugins'> {
  /** Written only when the report accepts a plugin, so an approval of none is as it was. */
  readonly plugins?: string;
  readonly format: typeof APPROVAL_FORMAT;
  /** The person who approved it, as they named themselves. */
  readonly approvedBy: string;
  /** When, as an ISO 8601 instant. */
  readonly approvedAt: string;
  /** The build of the package whose report it is. */
  readonly package: DecisionsBuild;
}

export class ApprovalError extends Error {
  override readonly name = 'ApprovalError';
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** A file's content as the tool writes it, two-space JSON and a line break. */
const asWritten = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The digests of a conversion as it is now, with the files of the plugins it accepts as `plugins`
 * gives them. Refused when it accepts a plugin and `plugins` is not given: no digest is made of
 * files no one read.
 */
export function digestsOf(conversion: Conversion, plugins?: PluginFiles): ApprovedDigests {
  const libraries = acceptedPlugins(conversion.report);
  if (libraries.length > 0 && plugins === undefined)
    throw new ApprovalError(
      `the report accepts the plugins ${libraries.join(', ')}, and they were not read, so no digest of them is made`,
    );
  const files: [string, string][] = [
    ...Object.entries(conversion.app).map(([path, content]): [string, string] => [
      `app/${path}`,
      sha256(asWritten(content)),
    ]),
    ...Object.entries(conversion.appAssets).map(([path, bytes]): [string, string] => [
      `app/${path}`,
      sha256(bytes),
    ]),
    ...Object.entries(conversion.themes).map(([name, theme]): [string, string] => [
      `themes/${name}.json`,
      sha256(asWritten(theme)),
    ]),
    ...Object.entries(conversion.assets).map(([path, bytes]): [string, string] => [
      path,
      sha256(bytes),
    ]),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    report: sha256(asWritten(conversion.report)),
    decisions: conversion.decisions === undefined ? null : sha256(asWritten(conversion.decisions)),
    files: sha256(files.map(([path, digest]) => `${path}\u0000${digest}\n`).join('')),
    plugins: plugins === undefined ? null : pluginsDigest(libraries, plugins),
  };
}

/** One digest of them all, which the person types the first characters of. */
export function approvalDigest(digests: ApprovedDigests): string {
  return sha256(
    `${digests.report}\n${digests.decisions ?? 'none'}\n${digests.files}\n` +
      // As before plugins were covered, for a conversion that accepts none.
      (digests.plugins === null ? '' : `${digests.plugins}\n`),
  );
}

/**
 * The approval of a conversion as it is now, by `by`, at `at`, with the files of the plugins it
 * accepts as `plugins` gives them: refused when it names no one, or the conversion holds an
 * approval already, which is never written over.
 */
export function approvalOf(
  conversion: Conversion,
  build: DecisionsBuild,
  by: string,
  at: Date,
  plugins?: PluginFiles,
): Approval {
  const name = by.trim();
  // eslint-disable-next-line no-control-regex
  if (!legible(name) || /[\u0000-\u001f\u007f]/.test(name) || name.length > 200)
    throw new ApprovalError(
      'an approval names the person who approves, in --by, as one line of up to 200 characters, with a letter or a digit in it',
    );
  if (conversion.approval !== undefined)
    throw new ApprovalError(
      `the conversion holds ${APPROVAL_FILE} already, which is never written over: move it aside to approve again`,
    );
  return {
    format: APPROVAL_FORMAT,
    approvedBy: name,
    approvedAt: at.toISOString(),
    package: { ...build },
    ...written(digestsOf(conversion, plugins)),
  };
}

/** The digests as an approval writes them: the plugins' only when there are any. */
function written({
  plugins,
  ...rest
}: ApprovedDigests): Omit<Approval, 'format' | 'approvedBy' | 'approvedAt' | 'package'> {
  return { ...rest, ...(plugins === null ? {} : { plugins }) };
}

export interface HeldApproval {
  /** Why the conversion is not approved, one line each; empty when it is. */
  readonly findings: readonly string[];
  /** The approval, when the file is one, void or not. */
  readonly approval?: Approval;
  /** True when it approves the conversion as it is now. */
  readonly approved: boolean;
}

/**
 * The conversion's approval, held to the conversion as it is now, to the package given, and to
 * the files of the plugins it accepts as `plugins` gives them: one the plugins were not given for
 * approves nothing of them, so it is not held.
 */
export function holdApproval(
  conversion: Conversion,
  build: DecisionsBuild,
  plugins?: PluginFiles,
): HeldApproval {
  const findings: string[] = [];
  const raw = conversion.approval;
  if (raw === undefined) {
    findings.push(
      'no one has approved the report and its decisions: a person does, with the approve command, once every decision is made',
    );
    return { findings, approved: false };
  }
  if (!isRecord(raw) || raw['format'] !== APPROVAL_FORMAT) {
    findings.push(`${APPROVAL_FILE} is not a ${APPROVAL_FORMAT} file, so it approves nothing`);
    return { findings, approved: false };
  }
  const by = typeof raw['approvedBy'] === 'string' ? raw['approvedBy'].trim() : '';
  const at = typeof raw['approvedAt'] === 'string' ? raw['approvedAt'] : '';
  if (!legible(by) || at === '' || Number.isNaN(Date.parse(at))) {
    findings.push(
      `${APPROVAL_FILE} names no one who approved it, or no time, so it approves nothing`,
    );
    return { findings, approved: false };
  }
  const approval = raw as unknown as Approval;
  const given = isRecord(raw['package']) ? raw['package'] : {};
  const keys = ['name', 'version', 'commit', 'buildTime', 'bundle'] as const;
  if (keys.some((key) => (given[key] ?? null) !== build[key]))
    findings.push(
      `${APPROVAL_FILE} approves a report of ${String(given['name'])} ${String(given['version'])}, bundle ${typeof given['bundle'] === 'string' ? given['bundle'].slice(0, 12) : 'none'}, not of the package given, ${build.name} ${build.version}, bundle ${build.bundle.slice(0, 12)}`,
    );
  const libraries = acceptedPlugins(conversion.report);
  if (libraries.length > 0 && plugins === undefined) {
    findings.push(
      `the report accepts the plugins ${libraries.join(', ')}, which were not read, so the approval is not held to them: check or report reads them from the repository`,
    );
    return { findings, approval, approved: false };
  }
  const now = digestsOf(conversion, plugins);
  const changed = [
    ...(raw['report'] !== now.report ? ['report.json'] : []),
    ...((raw['decisions'] ?? null) !== now.decisions ? ['decisions.json'] : []),
    ...(raw['files'] !== now.files ? ["the conversion's files"] : []),
    ...((raw['plugins'] ?? null) !== now.plugins ? ['the accepted plugins'] : []),
  ];
  const plural = new Set(["the conversion's files", 'the accepted plugins']);
  if (changed.length > 0)
    findings.push(
      `the approval by ${by} at ${at} is void: ${changed.join(' and ')} ${changed.length === 1 && !plural.has(changed[0]) ? 'has' : 'have'} changed since, so a person approves again`,
    );
  return { findings, approval, approved: findings.length === 0 };
}
