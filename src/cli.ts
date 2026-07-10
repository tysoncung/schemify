#!/usr/bin/env node
// Schemify command-line interface.
//
// Reads JSON from files, URLs, or stdin and prints (or writes) generated code
// in one or more formats. The argument parser and the pure rendering/naming
// helpers are exported so they can be unit-tested without touching the
// filesystem or the network; `main()` wires them to real I/O.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { VERSION } from './index';
import {
  type BatchSource,
  type Format,
  type FormatOptions,
  listFormats,
  processBatch,
  resolveFormat,
} from './transformers';

/** A CLI invocation parsed into its constituent options. */
export interface CliOptions {
  /** Positional file paths to read JSON from. */
  files: string[];
  /** URLs to fetch JSON from. */
  urls: string[];
  /** Output formats to generate (defaults to `["typescript"]`). */
  formats: Format[];
  /** Directory to write results into, or `null` to print to stdout. */
  outDir: string | null;
  /** Root type / schema name override, or `null` for the default. */
  rootName: string | null;
  /** Whether declarations are prefixed with `export`. */
  export: boolean;
  /** Whether stdin was explicitly requested with a `-` argument. */
  readStdin: boolean;
  help: boolean;
  version: boolean;
  listFormats: boolean;
}

const HELP = `schemify — JSON to TypeScript, Zod, and more.

Usage:
  schemify [options] [files...]

Reads JSON from files, URLs, or stdin and prints the generated code. With no
file, URL, or "-" argument, JSON is read from stdin.

Options:
  -f, --format <list>     Comma-separated output formats (default: typescript).
  -u, --url <url>         Fetch JSON from a URL (repeatable).
  -o, --out-dir <dir>     Write each result to a file in <dir> instead of stdout.
  -r, --root-name <name>  Name for the root type / schema (default: Root).
      --no-export         Omit the "export" keyword from declarations.
      --list-formats      List the available output formats and exit.
  -h, --help              Show this help and exit.
  -v, --version           Show the version and exit.
  -                       Read JSON from stdin (alongside any files/URLs).

Examples:
  schemify user.json
  schemify -f ts,zod user.json
  cat user.json | schemify --format zod
  schemify -u https://api.example.com/user.json -f zod
  schemify -f ts,zod -o generated a.json b.json`;

// --- Argument parsing --------------------------------------------------------

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveFormats(raw: string[]): Format[] {
  const seen = new Set<Format>();
  const formats: Format[] = [];
  for (const name of raw) {
    const def = resolveFormat(name);
    if (!def) {
      const available = listFormats()
        .map((format) => format.format)
        .join(', ');
      throw new Error(`Unknown format: ${name} (available: ${available})`);
    }
    if (!seen.has(def.format)) {
      seen.add(def.format);
      formats.push(def.format);
    }
  }
  return formats.length > 0 ? formats : ['typescript'];
}

/**
 * Parse `process.argv.slice(2)`-style arguments into {@link CliOptions}.
 *
 * @throws {Error} on an unknown option, a missing flag value, or an
 *   unrecognized format name.
 */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    urls: [],
    formats: [],
    outDir: null,
    rootName: null,
    export: true,
    readStdin: false,
    help: false,
    version: false,
    listFormats: false,
  };
  const rawFormats: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.version = true;
        break;
      case '--list-formats':
        options.listFormats = true;
        break;
      case '--no-export':
        options.export = false;
        break;
      case '--export':
        options.export = true;
        break;
      case '-f':
      case '--format':
        i += 1;
        rawFormats.push(...splitList(requireValue(arg, argv[i])));
        break;
      case '-u':
      case '--url':
        i += 1;
        options.urls.push(requireValue(arg, argv[i]));
        break;
      case '-o':
      case '--out-dir':
        i += 1;
        options.outDir = requireValue(arg, argv[i]);
        break;
      case '-r':
      case '--root-name':
        i += 1;
        options.rootName = requireValue(arg, argv[i]);
        break;
      case '-':
        options.readStdin = true;
        break;
      default: {
        if (arg.startsWith('--format=')) {
          rawFormats.push(...splitList(arg.slice('--format='.length)));
        } else if (arg.startsWith('--url=')) {
          options.urls.push(arg.slice('--url='.length));
        } else if (arg.startsWith('--out-dir=')) {
          options.outDir = arg.slice('--out-dir='.length);
        } else if (arg.startsWith('--root-name=')) {
          options.rootName = arg.slice('--root-name='.length);
        } else if (arg.startsWith('-') && arg !== '-') {
          throw new Error(`Unknown option: ${arg}`);
        } else {
          options.files.push(arg);
        }
      }
    }
  }

  options.formats = resolveFormats(rawFormats);
  return options;
}

// --- Pure output helpers -----------------------------------------------------

/** Strip directory, query/hash, and extension from a source name. */
function baseName(name: string): string {
  const segment = name.split(/[\\/]/).pop() ?? name;
  const withoutQuery = segment.split(/[?#]/)[0];
  return withoutQuery.replace(/\.[^.]+$/, '') || withoutQuery || 'output';
}

/**
 * Derive an output filename for a result. When more than one format is being
 * generated, the format name is included to avoid collisions between formats
 * that share an extension (e.g. TypeScript and Zod both emit `.ts`).
 */
export function outputFileName(
  source: string,
  def: { format: Format; extension: string },
  includeFormat: boolean,
): string {
  const base = baseName(source);
  return includeFormat
    ? `${base}.${def.format}.${def.extension}`
    : `${base}.${def.extension}`;
}

/**
 * Render successful batch results for stdout. When more than one result is
 * present each block gets a `// === source -> label ===` header so the outputs
 * stay distinguishable; a single result is printed bare. Errored results are
 * omitted (the caller reports those on stderr).
 */
export function renderResults(
  results: {
    source: string;
    label: string;
    code: string | null;
    error: string | null;
  }[],
): string {
  const ok = results.filter(
    (result) => result.error === null && result.code !== null,
  );
  const withHeaders = ok.length > 1;
  return ok
    .map((result) =>
      withHeaders
        ? `// === ${result.source} -> ${result.label} ===\n${result.code}`
        : (result.code as string),
    )
    .join('\n\n');
}

/** Human-readable listing of the available formats and their aliases. */
export function formatList(): string {
  const lines = listFormats().map((def) => {
    const names = [def.format, ...def.aliases].join(', ');
    return `  ${def.label.padEnd(12)} (${names})`;
  });
  return `Available formats:\n${lines.join('\n')}`;
}

// --- I/O ---------------------------------------------------------------------

async function readFileSource(file: string): Promise<BatchSource> {
  return { name: file, json: await readFile(file, 'utf8') };
}

async function readUrlSource(url: string): Promise<BatchSource> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return { name: url, json: await response.text() };
}

async function readStdinSource(): Promise<BatchSource> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return { name: 'stdin', json: Buffer.concat(chunks).toString('utf8') };
}

// --- Entry point -------------------------------------------------------------

/**
 * Run the CLI. Reads inputs, generates output, and returns a process exit code
 * (`0` on success, `1` if any input or transformation failed). All output is
 * written through `process.stdout` / `process.stderr`.
 */
export async function main(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`schemify: ${(error as Error).message}\n`);
    return 1;
  }

  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (options.listFormats) {
    process.stdout.write(`${formatList()}\n`);
    return 0;
  }

  const formatOptions: FormatOptions = { export: options.export };
  if (options.rootName) {
    formatOptions.rootName = options.rootName;
  }

  const sources: BatchSource[] = [];
  const errors: string[] = [];

  for (const file of options.files) {
    try {
      sources.push(await readFileSource(file));
    } catch (error) {
      errors.push(`${file}: ${(error as Error).message}`);
    }
  }
  for (const url of options.urls) {
    try {
      sources.push(await readUrlSource(url));
    } catch (error) {
      errors.push(`${url}: ${(error as Error).message}`);
    }
  }

  // Fall back to stdin when no other input was named — the usual pipe idiom.
  const wantStdin =
    options.readStdin ||
    (options.files.length === 0 && options.urls.length === 0);
  if (wantStdin) {
    try {
      sources.push(await readStdinSource());
    } catch (error) {
      errors.push(`stdin: ${(error as Error).message}`);
    }
  }

  const results = processBatch(sources, options.formats, formatOptions);

  if (options.outDir) {
    const includeFormat = options.formats.length > 1;
    for (const result of results) {
      if (result.error !== null || result.code === null) {
        errors.push(`${result.source} -> ${result.label}: ${result.error}`);
        continue;
      }
      const target = join(
        options.outDir,
        outputFileName(result.source, result, includeFormat),
      );
      try {
        await mkdir(options.outDir, { recursive: true });
        await writeFile(target, `${result.code}\n`, 'utf8');
        process.stdout.write(`${target}\n`);
      } catch (error) {
        errors.push(`${target}: ${(error as Error).message}`);
      }
    }
  } else {
    const rendered = renderResults(results);
    if (rendered) {
      process.stdout.write(`${rendered}\n`);
    }
    for (const result of results) {
      if (result.error !== null) {
        errors.push(`${result.source} -> ${result.label}: ${result.error}`);
      }
    }
  }

  for (const message of errors) {
    process.stderr.write(`schemify: ${message}\n`);
  }
  return errors.length > 0 ? 1 : 0;
}

// Run only when executed directly (not when imported by tests or the library).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
