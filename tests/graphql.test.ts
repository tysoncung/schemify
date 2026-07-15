import { describe, expect, it } from 'vitest';
import {
  generateGraphQLTypes,
  jsonToGraphql,
} from '../src/transformers/graphql';

/** Convenience: generate SDL directly from a value. */
function gen(value: unknown, options = {}): string {
  return generateGraphQLTypes(value, options);
}

describe('jsonToGraphql', () => {
  it('returns a TransformResult with the GraphQL label', () => {
    const result = jsonToGraphql('{"id": 1}');
    expect(result.label).toBe('GraphQL');
    expect(result.code).toContain('type Root');
  });

  it('throws a SyntaxError on invalid JSON', () => {
    expect(() => jsonToGraphql('{ not valid')).toThrow(SyntaxError);
    expect(() => jsonToGraphql('{ not valid')).toThrow(/Invalid JSON/);
  });
});

describe('primitive inference', () => {
  it('infers string, number, and boolean, marking required fields non-null', () => {
    expect(gen({ name: 'a', age: 1, active: true })).toBe(
      'type Root {\n  name: String!\n  age: Float!\n  active: Boolean!\n}',
    );
  });

  it('maps JSON numbers to Float', () => {
    expect(gen({ ratio: 1.5, count: 3 })).toBe(
      'type Root {\n  ratio: Float!\n  count: Float!\n}',
    );
  });

  it('wraps a top-level primitive in a single-field container type', () => {
    expect(gen(42)).toBe('type Root {\n  value: Float!\n}');
    expect(gen('hi')).toBe('type Root {\n  value: String!\n}');
  });
});

describe('nested objects', () => {
  it('extracts nested objects into their own types, parent first', () => {
    const code = gen({ user: { id: 1, address: { city: 'NYC' } } });
    expect(code).toBe(
      [
        'type Root {\n  user: User!\n}',
        'type User {\n  id: Float!\n  address: Address!\n}',
        'type Address {\n  city: String!\n}',
      ].join('\n\n'),
    );
  });

  it('renders an empty object as the JSON scalar', () => {
    expect(gen({ meta: {} })).toBe(
      'scalar JSON\n\ntype Root {\n  meta: JSON!\n}',
    );
  });
});

describe('arrays', () => {
  it('infers lists of primitives with non-null items', () => {
    expect(gen({ tags: ['a', 'b'] })).toBe(
      'type Root {\n  tags: [String!]!\n}',
    );
  });

  it('renders an empty array as a nullable JSON list', () => {
    expect(gen({ items: [] })).toBe(
      'scalar JSON\n\ntype Root {\n  items: [JSON]!\n}',
    );
  });

  it('names array element types using a singularized key', () => {
    const code = gen({ users: [{ id: 1 }] });
    expect(code).toContain('users: [User!]!');
    expect(code).toContain('type User {\n  id: Float!\n}');
  });

  it('merges objects across an array and leaves missing keys nullable', () => {
    const code = gen({
      users: [
        { id: 1, name: 'a' },
        { id: 2, email: 'b@x.com' },
      ],
    });
    expect(code).toContain('type User {');
    expect(code).toContain('  id: Float!');
    expect(code).toContain('  name: String');
    expect(code).toContain('  email: String');
    expect(code).not.toContain('name: String!');
    expect(code).not.toContain('email: String!');
  });
});

describe('unions and nullables', () => {
  it('falls back to the JSON scalar for a union of dissimilar scalars', () => {
    expect(gen({ mixed: [1, 'a'] })).toBe(
      'scalar JSON\n\ntype Root {\n  mixed: [JSON!]!\n}',
    );
  });

  it('renders an always-null value as a nullable JSON scalar', () => {
    expect(gen({ deleted: null })).toBe(
      'scalar JSON\n\ntype Root {\n  deleted: JSON\n}',
    );
  });

  it('keeps a nullable list item nullable', () => {
    expect(gen({ note: ['x', null] })).toBe(
      'type Root {\n  note: [String]!\n}',
    );
  });

  it('unions an object shape with null across an array', () => {
    const code = gen({ rows: [{ id: 1 }, null] });
    expect(code).toContain('rows: [Row]!');
    expect(code).toContain('type Row {\n  id: Float!\n}');
  });

  it('declares the JSON scalar only once even when used repeatedly', () => {
    const code = gen({ a: null, b: null });
    expect(code.match(/scalar JSON/g)).toHaveLength(1);
  });
});

describe('field name sanitization', () => {
  it('coerces keys that are not valid GraphQL names', () => {
    const code = gen({ 'first-name': 'a', valid_key: 'b' });
    expect(code).toContain('firstName: String!');
    expect(code).toContain('valid_key: String!');
    expect(code).not.toContain('"first-name"');
  });
});

describe('top-level arrays', () => {
  it('emits the element type for an array of records', () => {
    expect(gen([{ id: 1 }])).toBe('type RootItem {\n  id: Float!\n}');
  });

  it('uses a singular element name derived from rootName', () => {
    expect(gen([{ id: 1 }], { rootName: 'Users' })).toBe(
      'type User {\n  id: Float!\n}',
    );
  });

  it('wraps a top-level array of scalars in a container type', () => {
    expect(gen([1, 2, 3])).toBe('type Root {\n  value: [Float!]!\n}');
  });
});

describe('options', () => {
  it('honors a custom rootName', () => {
    expect(gen({ id: 1 }, { rootName: 'Person' })).toContain('type Person {');
  });
});

describe('name collisions', () => {
  it('deduplicates type names with a numeric suffix', () => {
    const code = gen({ a: { thing: { x: 1 } }, b: { thing: { y: 2 } } });
    expect(code).toContain('type Thing {\n  x: Float!\n}');
    expect(code).toContain('type Thing2 {\n  y: Float!\n}');
  });
});
