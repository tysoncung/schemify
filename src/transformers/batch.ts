// Batch processing — run many JSON inputs through many output formats.
//
// This is the pure core behind `schemify`'s CLI: it takes already-read JSON
// sources (the reading of files/URLs/stdin lives in the CLI) and produces one
// result per source × format. A JSON parse error in one source is captured on
// that result rather than thrown, so a single bad input never aborts the batch.

import { type Format, type FormatOptions, resolveFormat } from './registry';

/** A named unit of raw JSON to transform (e.g. a file, URL, or stdin). */
export interface BatchSource {
  /** Display name / basis for an output filename (e.g. `"users.json"`). */
  name: string;
  /** Raw JSON text. */
  json: string;
}

/** The outcome of transforming one source into one format. */
export interface BatchResult {
  /** The originating source's name. */
  source: string;
  /** The canonical format that was requested. */
  format: Format;
  /** Human-readable format label. */
  label: string;
  /** File extension (without a dot) for this format's output. */
  extension: string;
  /** Generated code, or `null` when transformation failed. */
  code: string | null;
  /** Error message when transformation failed, otherwise `null`. */
  error: string | null;
}

/**
 * Transform every source into every requested format.
 *
 * Results are ordered source-major, format-minor (all formats of the first
 * source, then all formats of the second, …). Unknown formats and invalid JSON
 * surface as results with a non-null `error` instead of throwing.
 */
export function processBatch(
  sources: BatchSource[],
  formats: Format[],
  options: FormatOptions = {},
): BatchResult[] {
  const results: BatchResult[] = [];
  for (const source of sources) {
    for (const format of formats) {
      const def = resolveFormat(format);
      if (!def) {
        results.push({
          source: source.name,
          format,
          label: format,
          extension: 'txt',
          code: null,
          error: `Unknown format: ${format}`,
        });
        continue;
      }
      try {
        const result = def.transform(source.json, options);
        results.push({
          source: source.name,
          format: def.format,
          label: result.label,
          extension: def.extension,
          code: result.code,
          error: null,
        });
      } catch (error) {
        results.push({
          source: source.name,
          format: def.format,
          label: def.label,
          extension: def.extension,
          code: null,
          error: (error as Error).message,
        });
      }
    }
  }
  return results;
}
