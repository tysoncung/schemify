// JSON → API compatibility diff (breaking-change viewer).
//
// Compares two API response schemas — a "before" and "after" version of the
// same endpoint's payload — and classifies every field-level change by its
// backwards-compatibility impact. Where `./diff` reports the raw structural
// delta (added / removed / changed), this layer answers the question an API
// author actually asks before shipping: "will this break existing clients?"
//
// The structural diff is produced by `compareSchemas` (see `./diff`); each of
// its entries is then labelled `breaking` or `compatible` under response
// semantics (the server → client contract):
//   * removing a field                    → breaking (clients read `undefined`),
//   * a field's type changing             → breaking,
//   * a required field becoming optional  → breaking (may now be absent),
//   * adding a field                      → compatible (clients ignore extras),
//   * an optional field becoming required → compatible (always present now).
// Passing `direction: 'request'` mirrors the analysis for request payloads
// (client → server), where added-required fields and new requirements break
// old callers instead.
//
// The overall verdict is `breaking` if any change breaks, `compatible` if there
// are only compatible changes, and `identical` when the two schemas match.
// `renderApiDiff` presents the result as a grouped Markdown report.

import type { TransformResult } from '../types';
import { type DiffStatus, type SchemaDiffEntry, compareSchemas } from './diff';

/** Which side of the API contract the compared schemas describe. */
export type ApiDiffDirection = 'response' | 'request';

/** Overall backwards-compatibility verdict for a comparison. */
export type Compatibility = 'identical' | 'compatible' | 'breaking';

/** One field's change together with its compatibility impact. */
export interface ApiDiffEntry {
  /** Dotted path from the root, e.g. `user.address.city` or `items[].id`. */
  path: string;
  /** Structural relationship to the first schema. */
  status: DiffStatus;
  /** Compact type in the first schema; `undefined` when the field was added. */
  before?: string;
  /** Compact type in the second schema; `undefined` when the field was removed. */
  after?: string;
  /** Whether this change breaks compatibility for existing consumers. */
  breaking: boolean;
  /** Human-readable explanation of the change and its impact. */
  detail: string;
}

/** Tally of each compatibility class across a comparison. */
export interface ApiDiffSummary {
  breaking: number;
  compatible: number;
  unchanged: number;
}

/** The structured result of comparing two API schemas. */
export interface ApiDiff {
  /** Every field, in first-schema order followed by fields new to the second. */
  entries: ApiDiffEntry[];
  summary: ApiDiffSummary;
  /** The single verdict derived from the entries. */
  compatibility: Compatibility;
}

export interface ApiDiffOptions {
  /** Column header / label for the first schema. Defaults to `"Before"`. */
  beforeName?: string;
  /** Column header / label for the second schema. Defaults to `"After"`. */
  afterName?: string;
  /**
   * Whether the schemas describe a response (server → client, the default) or a
   * request (client → server). The direction flips which changes are breaking.
   */
  direction?: ApiDiffDirection;
  /** Include a section for unchanged fields in the report. Defaults to `false`. */
  includeUnchanged?: boolean;
}

/** Placeholder shown when a field is absent from one side of the comparison. */
const ABSENT = '—';

// --- Classification ----------------------------------------------------------

/** The compatibility verdict for a single change. */
interface Impact {
  breaking: boolean;
  detail: string;
}

/** Split a compact type description into its base type and optionality. */
function splitOptional(type: string): { base: string; optional: boolean } {
  return type.endsWith('?')
    ? { base: type.slice(0, -1), optional: true }
    : { base: type, optional: false };
}

/**
 * Classify a `changed` entry, whose base type and/or optionality differ. A base
 * type change always breaks; a pure optionality flip breaks or not depending on
 * the direction of the contract.
 */
function classifyChanged(
  before: string,
  after: string,
  direction: ApiDiffDirection,
): Impact {
  const b = splitOptional(before);
  const a = splitOptional(after);

  if (b.base !== a.base) {
    return {
      breaking: true,
      detail: `Type changed from \`${b.base}\` to \`${a.base}\``,
    };
  }

  // Same base type, so only optionality changed (an identical type would have
  // been reported as `unchanged`, not `changed`).
  if (!b.optional && a.optional) {
    // required → optional
    return direction === 'response'
      ? { breaking: true, detail: 'Field became optional (may now be absent)' }
      : { breaking: false, detail: 'Field became optional' };
  }
  // optional → required
  return direction === 'response'
    ? { breaking: false, detail: 'Field became required (always present now)' }
    : { breaking: true, detail: 'Field became required' };
}

/** Classify one structural diff entry under the given contract direction. */
function classify(entry: SchemaDiffEntry, direction: ApiDiffDirection): Impact {
  switch (entry.status) {
    case 'unchanged':
      return { breaking: false, detail: 'Unchanged' };
    case 'added': {
      if (direction === 'response') {
        return { breaking: false, detail: 'Field added' };
      }
      // Request: a new required field breaks callers that do not send it yet.
      const { optional } = splitOptional(entry.after ?? '');
      return optional
        ? { breaking: false, detail: 'Optional field added' }
        : { breaking: true, detail: 'Required field added' };
    }
    case 'removed':
      return direction === 'response'
        ? { breaking: true, detail: 'Field removed' }
        : { breaking: false, detail: 'Field removed' };
    case 'changed':
      return classifyChanged(entry.before ?? '', entry.after ?? '', direction);
  }
}

/** Derive the single overall verdict from a comparison's tally. */
function verdictOf(summary: ApiDiffSummary): Compatibility {
  if (summary.breaking > 0) {
    return 'breaking';
  }
  if (summary.compatible > 0) {
    return 'compatible';
  }
  return 'identical';
}

// --- Comparison --------------------------------------------------------------

/**
 * Compare two already-parsed API payloads and report how the second (`after`)
 * differs from the first (`before`), annotating each change with whether it
 * breaks compatibility for existing consumers.
 */
export function compareApiSchemas(
  before: unknown,
  after: unknown,
  options: ApiDiffOptions = {},
): ApiDiff {
  const direction = options.direction ?? 'response';
  const structural = compareSchemas(before, after);

  const entries: ApiDiffEntry[] = [];
  const summary: ApiDiffSummary = { breaking: 0, compatible: 0, unchanged: 0 };

  for (const entry of structural.entries) {
    const { breaking, detail } = classify(entry, direction);
    entries.push({
      path: entry.path,
      status: entry.status,
      before: entry.before,
      after: entry.after,
      breaking,
      detail,
    });
    if (entry.status === 'unchanged') {
      summary.unchanged += 1;
    } else if (breaking) {
      summary.breaking += 1;
    } else {
      summary.compatible += 1;
    }
  }

  return { entries, summary, compatibility: verdictOf(summary) };
}

// --- Rendering ---------------------------------------------------------------

/** Escape a value for use inside a Markdown table cell. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Headline verdict word for each compatibility level. */
const VERDICT_LABEL: Record<Compatibility, string> = {
  identical: 'IDENTICAL',
  compatible: 'COMPATIBLE',
  breaking: 'BREAKING',
};

/** Render a structured API diff as a grouped, side-by-side Markdown report. */
export function renderApiDiff(
  diff: ApiDiff,
  options: ApiDiffOptions = {},
): string {
  const beforeName = options.beforeName ?? 'Before';
  const afterName = options.afterName ?? 'After';
  const includeUnchanged = options.includeUnchanged ?? false;

  const { summary } = diff;
  const lines: string[] = [
    `## API Diff: ${beforeName} → ${afterName}`,
    '',
    `**Verdict: ${VERDICT_LABEL[diff.compatibility]}** — ${summary.breaking} breaking, ${summary.compatible} compatible, ${summary.unchanged} unchanged`,
  ];

  const section = (title: string, rows: ApiDiffEntry[]): void => {
    if (rows.length === 0) {
      return;
    }
    lines.push(
      '',
      `### ${title}`,
      '',
      `| Field | ${beforeName} | ${afterName} | Change |`,
      '| --- | --- | --- | --- |',
    );
    for (const entry of rows) {
      const before =
        entry.before === undefined ? ABSENT : escapeCell(entry.before);
      const after =
        entry.after === undefined ? ABSENT : escapeCell(entry.after);
      lines.push(
        `| ${escapeCell(entry.path)} | ${before} | ${after} | ${escapeCell(entry.detail)} |`,
      );
    }
  };

  section(
    'Breaking changes',
    diff.entries.filter((entry) => entry.breaking),
  );
  section(
    'Compatible changes',
    diff.entries.filter(
      (entry) => !entry.breaking && entry.status !== 'unchanged',
    ),
  );
  if (includeUnchanged) {
    section(
      'Unchanged',
      diff.entries.filter((entry) => entry.status === 'unchanged'),
    );
  }

  return lines.join('\n');
}

// --- Public API --------------------------------------------------------------

function parseSample(json: string, which: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(
      `Invalid JSON (${which}): ${(error as Error).message}`,
    );
  }
}

/**
 * Compare two JSON strings as API schemas and render the compatibility report
 * as grouped Markdown.
 *
 * @throws {SyntaxError} if either `beforeJson` or `afterJson` is not valid JSON.
 */
export function jsonToApiDiff(
  beforeJson: string,
  afterJson: string,
  options: ApiDiffOptions = {},
): TransformResult {
  const before = parseSample(beforeJson, options.beforeName ?? 'Before');
  const after = parseSample(afterJson, options.afterName ?? 'After');
  return {
    label: 'API Diff',
    code: renderApiDiff(compareApiSchemas(before, after, options), options),
  };
}
