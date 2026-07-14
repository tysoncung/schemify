import { describe, expect, it } from 'vitest';
import {
  FORMATS,
  listFormats,
  resolveFormat,
} from '../src/transformers/registry';

describe('resolveFormat', () => {
  it('resolves canonical format names', () => {
    expect(resolveFormat('typescript')?.format).toBe('typescript');
    expect(resolveFormat('zod')?.format).toBe('zod');
    expect(resolveFormat('openapi')?.format).toBe('openapi');
    expect(resolveFormat('markdown')?.format).toBe('markdown');
  });

  it('resolves aliases to their canonical definition', () => {
    expect(resolveFormat('ts')?.format).toBe('typescript');
    expect(resolveFormat('tsx')?.format).toBe('typescript');
    expect(resolveFormat('oas')?.format).toBe('openapi');
    expect(resolveFormat('oas3')?.format).toBe('openapi');
    expect(resolveFormat('md')?.format).toBe('markdown');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveFormat('  TypeScript ')?.format).toBe('typescript');
    expect(resolveFormat('TS')?.format).toBe('typescript');
  });

  it('returns undefined for an unknown format', () => {
    expect(resolveFormat('graphql')).toBeUndefined();
    expect(resolveFormat('')).toBeUndefined();
  });
});

describe('listFormats', () => {
  it('returns every registered format', () => {
    expect(listFormats().map((def) => def.format)).toEqual([
      'typescript',
      'zod',
      'openapi',
      'markdown',
    ]);
  });
});

describe('format definitions', () => {
  it('transform produces the expected label and code', () => {
    for (const def of FORMATS) {
      const result = def.transform('{"id": 1}');
      expect(result.label).toBe(def.label);
      expect(result.code.length).toBeGreaterThan(0);
    }
  });

  it('forwards options through to the underlying transformer', () => {
    const ts = resolveFormat('ts')?.transform('{"id": 1}', {
      rootName: 'Person',
    });
    expect(ts?.code).toContain('interface Person');

    const zod = resolveFormat('zod')?.transform('{"id": 1}', {
      export: false,
    });
    expect(zod?.code).not.toContain('export const');
  });
});
