import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { camelCase } from '../src/transformers/naming';
import {
  type ZodOptions,
  generateZodSchema,
  jsonToZod,
} from '../src/transformers/zod';

/** Convenience: generate schema declarations directly from a value. */
function gen(value: unknown, options: ZodOptions = {}): string {
  return generateZodSchema(value, options);
}

/**
 * Compile the generated code and return its root schema, so tests can assert
 * that the emitted Zod is not just the right text but actually parses data.
 */
function compile(json: string, options: ZodOptions = {}): z.ZodType {
  const { code } = jsonToZod(json, options);
  const body = code
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
    .replace(/export const/g, 'const');
  const rootConst = `${camelCase(options.rootName ?? 'Root')}Schema`;
  const factory = new Function('z', `${body}\nreturn ${rootConst};`);
  return factory(z) as z.ZodType;
}

describe('jsonToZod', () => {
  it('returns a TransformResult with the Zod label and import', () => {
    const result = jsonToZod('{"id": 1}');
    expect(result.label).toBe('Zod');
    expect(result.code).toContain("import { z } from 'zod';");
    expect(result.code).toContain('export const rootSchema = z.object({');
  });

  it('throws a SyntaxError on invalid JSON', () => {
    expect(() => jsonToZod('{ not valid')).toThrow(SyntaxError);
    expect(() => jsonToZod('{ not valid')).toThrow(/Invalid JSON/);
  });
});

describe('primitive inference', () => {
  it('infers string, number, and boolean', () => {
    expect(gen({ name: 'a', age: 1, active: true })).toBe(
      'export const rootSchema = z.object({\n  name: z.string(),\n  age: z.number(),\n  active: z.boolean(),\n});',
    );
  });

  it('renders a top-level primitive as a bare schema const', () => {
    expect(gen(42)).toBe('export const rootSchema = z.number();');
    expect(gen('hi')).toBe('export const rootSchema = z.string();');
  });
});

describe('nested objects', () => {
  it('extracts nested objects into their own schemas, children first', () => {
    const code = gen({ user: { id: 1, address: { city: 'NYC' } } });
    expect(code).toBe(
      [
        'export const addressSchema = z.object({\n  city: z.string(),\n});',
        'export const userSchema = z.object({\n  id: z.number(),\n  address: addressSchema,\n});',
        'export const rootSchema = z.object({\n  user: userSchema,\n});',
      ].join('\n\n'),
    );
  });

  it('renders an empty object as z.record', () => {
    expect(gen({ meta: {} })).toBe(
      'export const rootSchema = z.object({\n  meta: z.record(z.string(), z.unknown()),\n});',
    );
  });
});

describe('arrays', () => {
  it('wraps arrays of primitives in z.array', () => {
    expect(gen({ tags: ['a', 'b'] })).toBe(
      'export const rootSchema = z.object({\n  tags: z.array(z.string()),\n});',
    );
  });

  it('renders an empty array as z.array(z.unknown())', () => {
    expect(gen({ items: [] })).toBe(
      'export const rootSchema = z.object({\n  items: z.array(z.unknown()),\n});',
    );
  });

  it('names array element schemas using a singularized key', () => {
    const code = gen({ users: [{ id: 1 }] });
    expect(code).toContain('users: z.array(userSchema)');
    expect(code).toContain(
      'export const userSchema = z.object({\n  id: z.number(),\n});',
    );
  });

  it('merges objects across an array and marks missing keys optional', () => {
    const code = gen({
      users: [
        { id: 1, name: 'a' },
        { id: 2, email: 'b@x.com' },
      ],
    });
    expect(code).toContain('export const userSchema = z.object({');
    expect(code).toContain('  id: z.number(),');
    expect(code).toContain('  name: z.string().optional(),');
    expect(code).toContain('  email: z.string().optional(),');
  });
});

describe('unions and nullables', () => {
  it('unions distinct primitive types with z.union', () => {
    expect(gen({ values: [1, 'a', true] })).toBe(
      'export const rootSchema = z.object({\n  values: z.array(z.union([z.number(), z.string(), z.boolean()])),\n});',
    );
  });

  it('renders a null value as z.null()', () => {
    expect(gen({ deleted: null })).toBe(
      'export const rootSchema = z.object({\n  deleted: z.null(),\n});',
    );
  });

  it('collapses a nullable primitive to .nullable()', () => {
    expect(gen({ note: ['x', null] })).toBe(
      'export const rootSchema = z.object({\n  note: z.array(z.string().nullable()),\n});',
    );
  });

  it('applies .nullable() to a union of multiple non-null types', () => {
    expect(gen({ mixed: [1, 'a', null] })).toBe(
      'export const rootSchema = z.object({\n  mixed: z.array(z.union([z.number(), z.string()]).nullable()),\n});',
    );
  });

  it('makes an extracted object schema nullable across an array', () => {
    const code = gen({ rows: [{ id: 1 }, null] });
    expect(code).toContain('rows: z.array(rowSchema.nullable())');
    expect(code).toContain(
      'export const rowSchema = z.object({\n  id: z.number(),\n});',
    );
  });
});

describe('property key formatting', () => {
  it('quotes keys that are not valid identifiers', () => {
    const code = gen({ 'first-name': 'a', valid_key: 'b' });
    expect(code).toContain('"first-name": z.string(),');
    expect(code).toContain('valid_key: z.string(),');
  });
});

describe('top-level arrays', () => {
  it('emits an item schema plus a root array schema', () => {
    const code = gen([{ id: 1 }]);
    expect(code).toBe(
      [
        'export const rootItemSchema = z.object({\n  id: z.number(),\n});',
        'export const rootSchema = z.array(rootItemSchema);',
      ].join('\n\n'),
    );
  });

  it('derives a singular element name from rootName', () => {
    const code = gen([{ id: 1 }], { rootName: 'Users' });
    expect(code).toContain(
      'export const userSchema = z.object({\n  id: z.number(),\n});',
    );
    expect(code).toContain('export const usersSchema = z.array(userSchema);');
  });
});

describe('options', () => {
  it('honors a custom rootName', () => {
    expect(gen({ id: 1 }, { rootName: 'Person' })).toBe(
      'export const personSchema = z.object({\n  id: z.number(),\n});',
    );
  });

  it('omits the export keyword when export is false', () => {
    const code = gen({ id: 1 }, { export: false });
    expect(code).toBe('const rootSchema = z.object({\n  id: z.number(),\n});');
    expect(code).not.toContain('export');
  });
});

describe('name collisions', () => {
  it('deduplicates schema names with a numeric suffix', () => {
    const code = gen({ a: { thing: { x: 1 } }, b: { thing: { y: 2 } } });
    expect(code).toContain(
      'export const thingSchema = z.object({\n  x: z.number(),\n});',
    );
    expect(code).toContain(
      'export const thingSchema2 = z.object({\n  y: z.number(),\n});',
    );
  });
});

describe('executable schemas', () => {
  it('parses valid data and rejects the wrong primitive type', () => {
    const schema = compile('{"id": 1, "name": "a"}');
    expect(schema.parse({ id: 1, name: 'a' })).toEqual({ id: 1, name: 'a' });
    expect(() => schema.parse({ id: 'nope', name: 'a' })).toThrow();
  });

  it('treats merged-array keys as genuinely optional', () => {
    const schema = compile('{"users":[{"id":1,"name":"a"},{"id":2}]}');
    expect(schema.parse({ users: [{ id: 1 }, { id: 2, name: 'b' }] })).toEqual({
      users: [{ id: 1 }, { id: 2, name: 'b' }],
    });
    // `id` is required — present in every element — so a missing id fails.
    expect(() => schema.parse({ users: [{ name: 'a' }] })).toThrow();
  });

  it('accepts null and non-null values for a nullable field', () => {
    const schema = compile('{"note":["x", null]}');
    expect(schema.parse({ note: ['x', null] })).toEqual({ note: ['x', null] });
    expect(() => schema.parse({ note: [1] })).toThrow();
  });

  it('validates a union of primitive types', () => {
    const schema = compile('{"values":[1, "a", true]}');
    expect(schema.parse({ values: [1, 'a', true] })).toEqual({
      values: [1, 'a', true],
    });
    expect(() => schema.parse({ values: [{}] })).toThrow();
  });

  it('accepts arbitrary keys for an empty object via z.record', () => {
    const schema = compile('{"meta":{}}');
    expect(schema.parse({ meta: { anything: 1, more: 'x' } })).toEqual({
      meta: { anything: 1, more: 'x' },
    });
  });
});
