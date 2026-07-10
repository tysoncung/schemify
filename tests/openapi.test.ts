import { describe, expect, it } from 'vitest';
import {
  type OpenApiOptions,
  generateOpenApiSchema,
  jsonToOpenApi,
} from '../src/transformers/openapi';

/** Generate and parse the schema document, returning `components.schemas`. */
function schemas(
  value: unknown,
  options: OpenApiOptions = {},
): Record<string, Record<string, unknown>> {
  const doc = JSON.parse(generateOpenApiSchema(value, options));
  return doc.components.schemas;
}

/** Convenience: the single root schema for the given value. */
function root(
  value: unknown,
  options: OpenApiOptions = {},
): Record<string, unknown> {
  return schemas(value, options)[options.rootName ?? 'Root'];
}

describe('jsonToOpenApi', () => {
  it('returns a TransformResult with the OpenAPI label', () => {
    const result = jsonToOpenApi('{"id": 1}');
    expect(result.label).toBe('OpenAPI');
  });

  it('wraps output in a components.schemas document fragment', () => {
    const doc = JSON.parse(jsonToOpenApi('{"id": 1}').code);
    expect(doc).toHaveProperty('components.schemas.Root');
    expect(doc.components.schemas.Root.type).toBe('object');
  });

  it('emits pretty-printed JSON', () => {
    expect(jsonToOpenApi('{"id": 1}').code).toContain('\n  ');
  });

  it('throws a SyntaxError on invalid JSON', () => {
    expect(() => jsonToOpenApi('{ not valid')).toThrow(SyntaxError);
    expect(() => jsonToOpenApi('{ not valid')).toThrow(/Invalid JSON/);
  });
});

describe('primitive inference', () => {
  it('maps string, number, and boolean to OpenAPI types', () => {
    expect(root({ name: 'a', age: 1, active: true })).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        active: { type: 'boolean' },
      },
      required: ['name', 'age', 'active'],
    });
  });

  it('renders a top-level primitive as the root schema', () => {
    expect(root(42)).toEqual({ type: 'number' });
    expect(root('hi')).toEqual({ type: 'string' });
  });
});

describe('nested objects', () => {
  it('hoists nested objects into named components with $ref, parent first', () => {
    const all = schemas({ user: { id: 1, address: { city: 'NYC' } } });
    expect(Object.keys(all)).toEqual(['Root', 'User', 'Address']);
    expect(all.Root.properties).toEqual({
      user: { $ref: '#/components/schemas/User' },
    });
    expect(all.User.properties).toEqual({
      id: { type: 'number' },
      address: { $ref: '#/components/schemas/Address' },
    });
    expect(all.Address).toEqual({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    });
  });

  it('renders an empty object as additionalProperties', () => {
    expect(root({ meta: {} }).properties).toEqual({
      meta: { type: 'object', additionalProperties: true },
    });
  });
});

describe('arrays', () => {
  it('wraps arrays of primitives with type array and items', () => {
    expect(root({ tags: ['a', 'b'] }).properties).toEqual({
      tags: { type: 'array', items: { type: 'string' } },
    });
  });

  it('renders an empty array as items: {} (any)', () => {
    expect(root({ items: [] }).properties).toEqual({
      items: { type: 'array', items: {} },
    });
  });

  it('names array element schemas using a singularized key', () => {
    const all = schemas({ users: [{ id: 1 }] });
    expect(all.Root.properties).toEqual({
      users: { type: 'array', items: { $ref: '#/components/schemas/User' } },
    });
    expect(all.User).toEqual({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    });
  });

  it('merges objects across an array and only requires universal keys', () => {
    const all = schemas({
      users: [
        { id: 1, name: 'a' },
        { id: 2, email: 'b@x.com' },
      ],
    });
    expect(all.User.properties).toEqual({
      id: { type: 'number' },
      name: { type: 'string' },
      email: { type: 'string' },
    });
    // `id` appears in every element; `name`/`email` do not, so are optional.
    expect(all.User.required).toEqual(['id']);
  });
});

describe('unions and nullables', () => {
  it('collapses a union of primitives into a JSON Schema type array', () => {
    expect(root({ values: [1, 'a', true] }).properties).toEqual({
      values: {
        type: 'array',
        items: { type: ['number', 'string', 'boolean'] },
      },
    });
  });

  it('renders a null value as type: null', () => {
    expect(root({ deleted: null }).properties).toEqual({
      deleted: { type: 'null' },
    });
  });

  it('adds null to the type array for a nullable primitive', () => {
    expect(root({ note: ['x', null] }).properties).toEqual({
      note: { type: 'array', items: { type: ['string', 'null'] } },
    });
  });

  it('uses anyOf with a null arm for a nullable object', () => {
    const all = schemas({ rows: [{ id: 1 }, null] });
    expect(all.Root.properties.rows).toEqual({
      type: 'array',
      items: {
        anyOf: [{ $ref: '#/components/schemas/Row' }, { type: 'null' }],
      },
    });
    expect(all.Row).toEqual({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    });
  });

  it('uses anyOf for a union of dissimilar shapes', () => {
    const all = schemas({ mixed: [{ id: 1 }, 'a'] });
    expect(all.Root.properties.mixed).toEqual({
      type: 'array',
      items: {
        anyOf: [{ $ref: '#/components/schemas/Mixed' }, { type: 'string' }],
      },
    });
  });
});

describe('required', () => {
  it('omits the required array entirely when every key is optional', () => {
    const all = schemas({ rows: [{ id: 1 }, {}] });
    expect(all.Row.properties).toEqual({ id: { type: 'number' } });
    expect(all.Row).not.toHaveProperty('required');
  });
});

describe('top-level arrays', () => {
  it('emits an item component plus a root array schema', () => {
    const all = schemas([{ id: 1 }]);
    expect(all.Root).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/RootItem' },
    });
    expect(all.RootItem).toEqual({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    });
  });

  it('derives a singular element name from rootName', () => {
    const all = schemas([{ id: 1 }], { rootName: 'Users' });
    expect(all.Users.items).toEqual({ $ref: '#/components/schemas/User' });
    expect(all.User.type).toBe('object');
  });
});

describe('options', () => {
  it('honors a custom rootName', () => {
    expect(Object.keys(schemas({ id: 1 }, { rootName: 'Person' }))).toContain(
      'Person',
    );
  });
});

describe('name collisions', () => {
  it('deduplicates component names with a numeric suffix', () => {
    const all = schemas({ a: { thing: { x: 1 } }, b: { thing: { y: 2 } } });
    expect(all.Thing.properties).toEqual({ x: { type: 'number' } });
    expect(all.Thing2.properties).toEqual({ y: { type: 'number' } });
  });
});
