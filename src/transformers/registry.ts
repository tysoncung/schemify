// Output-format registry — the single source of truth for the formats Schemify
// can generate. The CLI and batch processor look formats up here by canonical
// name or alias, so adding a new transformer only means adding one entry.

import type { TransformResult } from '../types';
import { jsonToTypescript } from './typescript';
import { jsonToZod } from './zod';

/** The canonical name of every output format Schemify can generate. */
export type Format = 'typescript' | 'zod';

/** Options shared by every format's transformer. */
export interface FormatOptions {
  /** Name for the root type / schema. Defaults to `"Root"`. */
  rootName?: string;
  /** Prefix declarations with the `export` keyword. Defaults to `true`. */
  export?: boolean;
}

/** A single output format together with how to produce and name it. */
export interface FormatDefinition {
  /** Canonical format name. */
  format: Format;
  /** Human-readable label, matching the transformer's `TransformResult.label`. */
  label: string;
  /** File extension (without a leading dot) for written output. */
  extension: string;
  /** Alternate names accepted on the CLI, in addition to `format`. */
  aliases: string[];
  /** Transform a JSON string into this format. */
  transform: (json: string, options?: FormatOptions) => TransformResult;
}

/** Every format Schemify knows how to generate, in display order. */
export const FORMATS: readonly FormatDefinition[] = [
  {
    format: 'typescript',
    label: 'TypeScript',
    extension: 'ts',
    aliases: ['ts', 'tsx'],
    transform: jsonToTypescript,
  },
  {
    format: 'zod',
    label: 'Zod',
    extension: 'ts',
    aliases: [],
    transform: jsonToZod,
  },
];

const BY_NAME = new Map<string, FormatDefinition>();
for (const def of FORMATS) {
  BY_NAME.set(def.format, def);
  for (const alias of def.aliases) {
    BY_NAME.set(alias, def);
  }
}

/**
 * Resolve a format definition by its canonical name or any alias.
 * Lookup is case-insensitive and ignores surrounding whitespace.
 */
export function resolveFormat(name: string): FormatDefinition | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/** Every known format definition, in display order. */
export function listFormats(): readonly FormatDefinition[] {
  return FORMATS;
}
