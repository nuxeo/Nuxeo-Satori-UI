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
 * changes a digest, and the approval is void, which readiness and the report say.
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
import type { Conversion } from './convert';
import type { DecisionsBuild } from './decisions';

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
}

export interface Approval extends ApprovedDigests {
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

/** The digests of a conversion as it is now. */
export function digestsOf(conversion: Conversion): ApprovedDigests {
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
  };
}

/** One digest of all three, which the person types the first characters of. */
export function approvalDigest(digests: ApprovedDigests): string {
  return sha256(`${digests.report}\n${digests.decisions ?? 'none'}\n${digests.files}\n`);
}

/**
 * The approval of a conversion as it is now, by `by`, at `at`: refused when it names no one, or
 * the conversion holds an approval already, which is never written over.
 */
export function approvalOf(
  conversion: Conversion,
  build: DecisionsBuild,
  by: string,
  at: Date,
): Approval {
  const name = by.trim();
  // eslint-disable-next-line no-control-regex
  if (name === '' || /[\u0000-\u001f\u007f]/.test(name) || name.length > 200)
    throw new ApprovalError(
      'an approval names the person who approves, in --by, as one line of up to 200 characters',
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
    ...digestsOf(conversion),
  };
}

export interface HeldApproval {
  /** Why the conversion is not approved, one line each; empty when it is. */
  readonly findings: readonly string[];
  /** The approval, when the file is one, void or not. */
  readonly approval?: Approval;
  /** True when it approves the conversion as it is now. */
  readonly approved: boolean;
}

/** The conversion's approval, held to the conversion as it is now and to the package given. */
export function holdApproval(conversion: Conversion, build: DecisionsBuild): HeldApproval {
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
  if (by === '' || at === '' || Number.isNaN(Date.parse(at))) {
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
  const now = digestsOf(conversion);
  const changed = [
    ...(raw['report'] !== now.report ? ['report.json'] : []),
    ...((raw['decisions'] ?? null) !== now.decisions ? ['decisions.json'] : []),
    ...(raw['files'] !== now.files ? ["the conversion's files"] : []),
  ];
  if (changed.length > 0)
    findings.push(
      `the approval by ${by} at ${at} is void: ${changed.join(' and ')} ${changed.length === 1 && changed[0] !== "the conversion's files" ? 'has' : 'have'} changed since, so a person approves again`,
    );
  return { findings, approval, approved: findings.length === 0 };
}
