import { describe, expect, it } from 'vitest';
import {
  generateTypescriptInterfaces,
  jsonToTypescript,
} from '../src/transformers/typescript';

/** Convenience: generate interfaces directly from a value. */
function gen(value: unknown, options = {}): string {
  return generateTypescriptInterfaces(value, options);
}

describe('jsonToTypescript', () => {
  it('returns a TransformResult with the TypeScript label', () => {
    const result = jsonToTypescript('{"id": 1}');
    expect(result.label).toBe('TypeScript');
    expect(result.code).toContain('export interface Root');
  });

  it('throws a SyntaxError on invalid JSON', () => {
    expect(() => jsonToTypescript('{ not valid')).toThrow(SyntaxError);
    expect(() => jsonToTypescript('{ not valid')).toThrow(/Invalid JSON/);
  });
});

describe('primitive inference', () => {
  it('infers string, number, and boolean', () => {
    expect(gen({ name: 'a', age: 1, active: true })).toBe(
      'export interface Root {\n  name: string;\n  age: number;\n  active: boolean;\n}',
    );
  });

  it('renders a top-level primitive as a type alias', () => {
    expect(gen(42)).toBe('export type Root = number;');
    expect(gen('hi')).toBe('export type Root = string;');
  });
});

describe('nested objects', () => {
  it('extracts nested objects into their own interfaces, parent first', () => {
    const code = gen({ user: { id: 1, address: { city: 'NYC' } } });
    expect(code).toBe(
      [
        'export interface Root {\n  user: User;\n}',
        'export interface User {\n  id: number;\n  address: Address;\n}',
        'export interface Address {\n  city: string;\n}',
      ].join('\n\n'),
    );
  });

  it('renders an empty object as Record<string, unknown>', () => {
    expect(gen({ meta: {} })).toBe(
      'export interface Root {\n  meta: Record<string, unknown>;\n}',
    );
  });
});

describe('arrays', () => {
  it('infers arrays of primitives', () => {
    expect(gen({ tags: ['a', 'b'] })).toBe(
      'export interface Root {\n  tags: string[];\n}',
    );
  });

  it('renders an empty array as unknown[]', () => {
    expect(gen({ items: [] })).toBe(
      'export interface Root {\n  items: unknown[];\n}',
    );
  });

  it('names array element interfaces using a singularized key', () => {
    const code = gen({ users: [{ id: 1 }] });
    expect(code).toContain('users: User[];');
    expect(code).toContain('export interface User {\n  id: number;\n}');
  });

  it('merges objects across an array and marks missing keys optional', () => {
    const code = gen({
      users: [
        { id: 1, name: 'a' },
        { id: 2, email: 'b@x.com' },
      ],
    });
    expect(code).toContain('export interface User {');
    expect(code).toContain('  id: number;');
    expect(code).toContain('  name?: string;');
    expect(code).toContain('  email?: string;');
  });

  it('parenthesizes unions inside array element types', () => {
    expect(gen({ mixed: [1, 'a'] })).toBe(
      'export interface Root {\n  mixed: (number | string)[];\n}',
    );
  });
});

describe('unions and nullables', () => {
  it('unions distinct primitive types in an array', () => {
    expect(gen({ values: [1, 'a', true] })).toContain(
      'values: (number | string | boolean)[];',
    );
  });

  it('renders a null value as null', () => {
    expect(gen({ deleted: null })).toBe(
      'export interface Root {\n  deleted: null;\n}',
    );
  });

  it('keeps null at the end of a union', () => {
    expect(gen({ note: ['x', null] })).toBe(
      'export interface Root {\n  note: (string | null)[];\n}',
    );
  });

  it('unions object shapes with null across an array', () => {
    const code = gen({ rows: [{ id: 1 }, null] });
    expect(code).toContain('rows: (Row | null)[];');
    expect(code).toContain('export interface Row {\n  id: number;\n}');
  });
});

describe('property key formatting', () => {
  it('quotes keys that are not valid identifiers', () => {
    const code = gen({ 'first-name': 'a', valid_key: 'b' });
    expect(code).toContain('"first-name": string;');
    expect(code).toContain('valid_key: string;');
  });
});

describe('top-level arrays', () => {
  it('emits an item interface plus a root type alias', () => {
    const code = gen([{ id: 1 }]);
    expect(code).toContain('export interface RootItem {\n  id: number;\n}');
    expect(code).toContain('export type Root = RootItem[];');
  });

  it('uses a singular element name derived from rootName', () => {
    const code = gen([{ id: 1 }], { rootName: 'Users' });
    expect(code).toContain('export interface User {\n  id: number;\n}');
    expect(code).toContain('export type Users = User[];');
  });
});

describe('options', () => {
  it('honors a custom rootName', () => {
    expect(gen({ id: 1 }, { rootName: 'Person' })).toContain(
      'export interface Person {',
    );
  });

  it('omits the export keyword when export is false', () => {
    const code = gen({ id: 1 }, { export: false });
    expect(code).toBe('interface Root {\n  id: number;\n}');
    expect(code).not.toContain('export');
  });
});

describe('name collisions', () => {
  it('deduplicates interface names with a numeric suffix', () => {
    const code = gen({ a: { thing: { x: 1 } }, b: { thing: { y: 2 } } });
    expect(code).toContain('export interface Thing {\n  x: number;\n}');
    expect(code).toContain('export interface Thing2 {\n  y: number;\n}');
  });
});
