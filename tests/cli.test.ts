import { describe, expect, it } from 'vitest';
import {
  type CliOptions,
  formatList,
  outputFileName,
  parseArgs,
  renderResults,
} from '../src/cli';

describe('parseArgs', () => {
  it('defaults to the typescript format and stdin fallback', () => {
    const options = parseArgs([]);
    expect(options.formats).toEqual(['typescript']);
    expect(options.files).toEqual([]);
    expect(options.urls).toEqual([]);
    expect(options.readStdin).toBe(false);
    expect(options.export).toBe(true);
  });

  it('collects positional file arguments', () => {
    const options = parseArgs(['a.json', 'b.json']);
    expect(options.files).toEqual(['a.json', 'b.json']);
  });

  it('parses a comma-separated format list and resolves aliases', () => {
    const options = parseArgs(['-f', 'ts,zod']);
    expect(options.formats).toEqual(['typescript', 'zod']);
  });

  it('accepts repeated --format flags and dedupes formats', () => {
    const options = parseArgs(['--format', 'ts', '--format', 'typescript']);
    expect(options.formats).toEqual(['typescript']);
  });

  it('supports --flag=value syntax', () => {
    const options = parseArgs([
      '--format=zod',
      '--root-name=Person',
      '--out-dir=out',
      '--url=https://example.com/x.json',
    ]);
    expect(options.formats).toEqual(['zod']);
    expect(options.rootName).toBe('Person');
    expect(options.outDir).toBe('out');
    expect(options.urls).toEqual(['https://example.com/x.json']);
  });

  it('collects repeated --url flags', () => {
    const options = parseArgs(['-u', 'https://a', '-u', 'https://b']);
    expect(options.urls).toEqual(['https://a', 'https://b']);
  });

  it('honors --no-export', () => {
    expect(parseArgs(['--no-export']).export).toBe(false);
  });

  it('treats a bare - as an explicit stdin request', () => {
    const options = parseArgs(['-', 'a.json']);
    expect(options.readStdin).toBe(true);
    expect(options.files).toEqual(['a.json']);
  });

  it('sets help, version, and list-formats flags', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--list-formats']).listFormats).toBe(true);
  });

  it('throws on an unknown option', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option: --nope/);
  });

  it('throws on an unknown format', () => {
    expect(() => parseArgs(['-f', 'protobuf'])).toThrow(/Unknown format/);
  });

  it('throws when a flag is missing its value', () => {
    expect(() => parseArgs(['--format'])).toThrow(/Missing value for --format/);
  });
});

describe('outputFileName', () => {
  const ts = { format: 'typescript' as const, extension: 'ts' };
  const zod = { format: 'zod' as const, extension: 'ts' };

  it('uses base name plus extension for a single format', () => {
    expect(outputFileName('user.json', ts, false)).toBe('user.ts');
  });

  it('includes the format name when multiple formats share an extension', () => {
    expect(outputFileName('user.json', ts, true)).toBe('user.typescript.ts');
    expect(outputFileName('user.json', zod, true)).toBe('user.zod.ts');
  });

  it('strips directories from the source name', () => {
    expect(outputFileName('data/nested/user.json', ts, false)).toBe('user.ts');
  });

  it('strips query strings from a URL source', () => {
    expect(outputFileName('https://x.com/users?page=1', ts, false)).toBe(
      'users.ts',
    );
  });

  it('handles a source name with no extension (e.g. stdin)', () => {
    expect(outputFileName('stdin', ts, false)).toBe('stdin.ts');
  });
});

describe('renderResults', () => {
  const base = { extension: 'ts', format: 'typescript' as const };

  it('prints a single successful result bare, with no header', () => {
    const output = renderResults([
      {
        ...base,
        source: 'a.json',
        label: 'TypeScript',
        code: 'A',
        error: null,
      },
    ]);
    expect(output).toBe('A');
  });

  it('adds headers when there is more than one successful result', () => {
    const output = renderResults([
      {
        ...base,
        source: 'a.json',
        label: 'TypeScript',
        code: 'A',
        error: null,
      },
      { ...base, source: 'a.json', label: 'Zod', code: 'B', error: null },
    ]);
    expect(output).toBe(
      '// === a.json -> TypeScript ===\nA\n\n// === a.json -> Zod ===\nB',
    );
  });

  it('omits errored results from the rendered output', () => {
    const output = renderResults([
      {
        ...base,
        source: 'a.json',
        label: 'TypeScript',
        code: 'A',
        error: null,
      },
      {
        ...base,
        source: 'b.json',
        label: 'TypeScript',
        code: null,
        error: 'boom',
      },
    ]);
    expect(output).toBe('A');
  });
});

describe('formatList', () => {
  it('lists every format with its aliases', () => {
    const output = formatList();
    expect(output).toContain('TypeScript');
    expect(output).toContain('typescript, ts, tsx');
    expect(output).toContain('Zod');
  });
});

// Compile-time guard: ensure the exported option shape stays stable.
const _shape: CliOptions = parseArgs([]);
void _shape;
