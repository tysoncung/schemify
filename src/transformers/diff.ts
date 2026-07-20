// JSON → schema comparison (side-by-side diff).
//
// Infers a type model from two JSON samples (see `./infer`) and reports how the
// second differs from the first. Each sample is flattened into a map of dotted
// field paths (`user.address.city`, `items[]` for array elements) to a compact
// type description; the two maps are then compared key by key. A field is:
//   * `added`    — present only in the second sample,
//   * `removed`  — present only in the first sample,
//   * `changed`  — present in both but with a different type or optionality,
//   * `unchanged`— present in both with an identical type.
// Optionality (a key absent from some records of an array, inferred as optional)
// is folded into the compared type as a trailing `?`, so a field that becomes
// optional reads as `changed`. `renderSchemaDiff` turns the structured diff into
// a side-by-side Markdown table, mirroring the Markdown documentation generator.

import type { TransformResult } from '../types';
import { type ObjectNode, type TypeNode, infer } from './infer';

/** How a single field in the second sample relates to the first. */
export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

/** One field's comparison across the two samples. */
export interface SchemaDiffEntry {
  /** Dotted path from the root, e.g. `user.address.city` or `items[].id`. */
  path: string;
  /** How the field changed between the two samples. */
  status: DiffStatus;
  /** Compact type in the first sample; `undefined` when the field was added. */
  before?: string;
  /** Compact type in the second sample; `undefined` when the field was removed. */
  after?: string;
}

/** Tally of each kind of change across a comparison. */
export interface SchemaDiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

/** The structured result of comparing two schemas. */
export interface SchemaDiff {
  entries: SchemaDiffEntry[];
  summary: SchemaDiffSummary;
}

export interface SchemaDiffOptions {
  /** Column header / label for the first sample. Defaults to `"Before"`. */
  beforeName?: string;
  /** Column header / label for the second sample. Defaults to `"After"`. */
  afterName?: string;
  /** Include rows for unchanged fields in the rendered table. Defaults to `true`. */
  includeUnchanged?: boolean;
}

/** Placeholder shown when a field is absent from one side of the comparison. */
const ABSENT = '—';

// --- Flattening --------------------------------------------------------------

/** A single field's type and optionality, keyed by path in the flattened map. */
interface FieldShape {
  /** Compact type description, without the optional marker. */
  type: string;
  /** Whether the property is optional (absent from some samples). */
  optional: boolean;
}

/** A compact, single-line type description used for leaf comparison. */
function describeType(node: TypeNode): string {
  switch (node.kind) {
    case 'primitive':
      return node.name;
    case 'object':
      // Nested object fields are expanded into their own paths; the container
      // itself is described generically.
      return 'object';
    case 'array': {
      const element = describeType(node.element);
      return node.element.kind === 'union' ? `(${element})[]` : `${element}[]`;
    }
    case 'union': {
      const parts = [...new Set(node.types.map(describeType))];
      // Keep `null` at the end for readability (e.g. `string | null`).
      parts.sort((a, b) => (a === 'null' ? 1 : 0) - (b === 'null' ? 1 : 0));
      return parts.join(' | ');
    }
    default:
      return 'unknown';
  }
}

/** Expand the object/array children of a node into the flattened path map. */
function collectChildren(
  node: TypeNode,
  path: string,
  out: Map<string, FieldShape>,
): void {
  if (node.kind === 'object' && node.properties.size > 0) {
    flattenObject(node, path, out);
  } else if (node.kind === 'array') {
    // Array elements share their parent's path with a `[]` marker; scalar
    // elements bottom out here without adding a child entry.
    collectChildren(node.element, `${path}[]`, out);
  }
}

/** Record every property of an object (and its descendants) into the map. */
function flattenObject(
  node: ObjectNode,
  prefix: string,
  out: Map<string, FieldShape>,
): void {
  for (const [key, prop] of node.properties) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.set(path, { type: describeType(prop.type), optional: prop.optional });
    collectChildren(prop.type, path, out);
  }
}

/** Flatten an inferred root type into a map of field path → shape. */
function flatten(root: TypeNode): Map<string, FieldShape> {
  const out = new Map<string, FieldShape>();
  if (root.kind === 'object' && root.properties.size > 0) {
    flattenObject(root, '', out);
  } else if (
    root.kind === 'array' &&
    root.element.kind === 'object' &&
    root.element.properties.size > 0
  ) {
    // A top-level array of records: compare the element fields, marked `[]`.
    flattenObject(root.element, '[]', out);
  } else {
    // A bare scalar, an array of scalars, or an empty object has no fields to
    // walk — compare it as a single synthetic root entry.
    out.set('(root)', { type: describeType(root), optional: false });
  }
  return out;
}

// --- Comparison --------------------------------------------------------------

/** The compared type string for a field, with a trailing `?` when optional. */
function typeWithOptionality(shape: FieldShape): string {
  return shape.optional ? `${shape.type}?` : shape.type;
}

/**
 * Compare two already-parsed JSON values and describe how the second (`after`)
 * differs from the first (`before`), field by field.
 */
export function compareSchemas(before: unknown, after: unknown): SchemaDiff {
  const left = flatten(infer(before));
  const right = flatten(infer(after));

  // Paths in first-sample order, then any paths unique to the second sample.
  const paths: string[] = [...left.keys()];
  for (const path of right.keys()) {
    if (!left.has(path)) {
      paths.push(path);
    }
  }

  const entries: SchemaDiffEntry[] = [];
  const summary: SchemaDiffSummary = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
  };

  for (const path of paths) {
    const l = left.get(path);
    const r = right.get(path);
    if (l && r) {
      const before = typeWithOptionality(l);
      const after = typeWithOptionality(r);
      const status: DiffStatus = before === after ? 'unchanged' : 'changed';
      entries.push({ path, status, before, after });
      summary[status] += 1;
    } else if (l) {
      entries.push({ path, status: 'removed', before: typeWithOptionality(l) });
      summary.removed += 1;
    } else if (r) {
      entries.push({ path, status: 'added', after: typeWithOptionality(r) });
      summary.added += 1;
    }
  }

  return { entries, summary };
}

// --- Rendering ---------------------------------------------------------------

/** Escape a value for use inside a Markdown table cell. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Render a structured schema diff as a side-by-side Markdown table. */
export function renderSchemaDiff(
  diff: SchemaDiff,
  options: SchemaDiffOptions = {},
): string {
  const beforeName = options.beforeName ?? 'Before';
  const afterName = options.afterName ?? 'After';
  const includeUnchanged = options.includeUnchanged ?? true;

  const rows: string[] = [];
  for (const entry of diff.entries) {
    if (!includeUnchanged && entry.status === 'unchanged') {
      continue;
    }
    const before =
      entry.before === undefined ? ABSENT : escapeCell(entry.before);
    const after = entry.after === undefined ? ABSENT : escapeCell(entry.after);
    rows.push(
      `| ${escapeCell(entry.path)} | ${before} | ${after} | ${entry.status} |`,
    );
  }

  const { added, removed, changed, unchanged } = diff.summary;

  return [
    `## Schema Diff: ${beforeName} → ${afterName}`,
    '',
    `**${added} added, ${removed} removed, ${changed} changed, ${unchanged} unchanged**`,
    '',
    `| Field | ${beforeName} | ${afterName} | Status |`,
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
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
 * Compare two JSON strings and render the schema differences as a side-by-side
 * Markdown table.
 *
 * @throws {SyntaxError} if either `beforeJson` or `afterJson` is not valid JSON.
 */
export function jsonToSchemaDiff(
  beforeJson: string,
  afterJson: string,
  options: SchemaDiffOptions = {},
): TransformResult {
  const before = parseSample(beforeJson, options.beforeName ?? 'Before');
  const after = parseSample(afterJson, options.afterName ?? 'After');
  return {
    label: 'Schema Diff',
    code: renderSchemaDiff(compareSchemas(before, after), options),
  };
}
