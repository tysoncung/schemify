import { describe, expect, it } from 'vitest';
import {
  type SchemaDiff,
  compareSchemas,
  jsonToSchemaDiff,
  renderSchemaDiff,
} from '../src/transformers/diff';

/** Find the diff entry for a given field path. */
function entry(diff: SchemaDiff, path: string) {
  return diff.entries.find((e) => e.path === path);
}

describe('jsonToSchemaDiff', () => {
  it('returns a TransformResult with the Schema Diff label', () => {
    const result = jsonToSchemaDiff('{"id": 1}', '{"id": 1}');
    expect(result.label).toBe('Schema Diff');
    expect(result.code).toContain('## Schema Diff: Before → After');
  });

  it('throws a SyntaxError naming the invalid side', () => {
    expect(() => jsonToSchemaDiff('{ bad', '{}')).toThrow(SyntaxError);
    expect(() => jsonToSchemaDiff('{ bad', '{}')).toThrow(
      /Invalid JSON \(Before\)/,
    );
    expect(() => jsonToSchemaDiff('{}', '{ bad')).toThrow(
      /Invalid JSON \(After\)/,
    );
  });
});

describe('field-level status', () => {
  it('marks unchanged fields', () => {
    const diff = compareSchemas({ id: 1, name: 'a' }, { id: 2, name: 'b' });
    expect(entry(diff, 'id')).toMatchObject({
      status: 'unchanged',
      before: 'number',
      after: 'number',
    });
    expect(diff.summary.unchanged).toBe(2);
  });

  it('marks added fields', () => {
    const diff = compareSchemas({ id: 1 }, { id: 1, email: 'x@y.z' });
    const added = entry(diff, 'email');
    expect(added).toMatchObject({ status: 'added', after: 'string' });
    expect(added?.before).toBeUndefined();
    expect(diff.summary.added).toBe(1);
  });

  it('marks removed fields', () => {
    const diff = compareSchemas({ id: 1, legacy: true }, { id: 1 });
    const removed = entry(diff, 'legacy');
    expect(removed).toMatchObject({ status: 'removed', before: 'boolean' });
    expect(removed?.after).toBeUndefined();
    expect(diff.summary.removed).toBe(1);
  });

  it('marks fields whose type changed', () => {
    const diff = compareSchemas({ id: 1 }, { id: '1' });
    expect(entry(diff, 'id')).toMatchObject({
      status: 'changed',
      before: 'number',
      after: 'string',
    });
    expect(diff.summary.changed).toBe(1);
  });
});

describe('optionality', () => {
  it('treats a field becoming optional as a change', () => {
    const before = { users: [{ id: 1, name: 'a' }] };
    const after = { users: [{ id: 1, name: 'a' }, { id: 2 }] };
    const diff = compareSchemas(before, after);
    expect(entry(diff, 'users[].name')).toMatchObject({
      status: 'changed',
      before: 'string',
      after: 'string?',
    });
  });
});

describe('nested objects', () => {
  it('compares nested fields by dotted path', () => {
    const diff = compareSchemas(
      { user: { id: 1, address: { city: 'NYC' } } },
      { user: { id: 1, address: { city: 'LA', zip: '90001' } } },
    );
    expect(entry(diff, 'user.id')?.status).toBe('unchanged');
    expect(entry(diff, 'user.address.city')?.status).toBe('unchanged');
    expect(entry(diff, 'user.address.zip')).toMatchObject({
      status: 'added',
      after: 'string',
    });
  });
});

describe('arrays of records', () => {
  it('compares element fields with a [] path marker', () => {
    const diff = compareSchemas(
      { items: [{ sku: 'a', price: 1 }] },
      { items: [{ sku: 'a', price: '1' }] },
    );
    expect(entry(diff, 'items')).toMatchObject({
      status: 'unchanged',
      before: 'object[]',
    });
    expect(entry(diff, 'items[].price')).toMatchObject({
      status: 'changed',
      before: 'number',
      after: 'string',
    });
  });

  it('compares a top-level array of records field by field', () => {
    const diff = compareSchemas([{ id: 1 }], [{ id: 1, name: 'a' }]);
    expect(entry(diff, '[].id')?.status).toBe('unchanged');
    expect(entry(diff, '[].name')?.status).toBe('added');
  });
});

describe('scalar and array types', () => {
  it('describes arrays of primitives', () => {
    const diff = compareSchemas({ tags: ['a'] }, { tags: [1] });
    expect(entry(diff, 'tags')).toMatchObject({
      before: 'string[]',
      after: 'number[]',
      status: 'changed',
    });
  });

  it('describes unions with null kept last', () => {
    const diff = compareSchemas({ note: 'x' }, { note: ['x', null] });
    expect(entry(diff, 'note')).toMatchObject({
      before: 'string',
      after: '(string | null)[]',
      status: 'changed',
    });
  });

  it('compares top-level primitives as a synthetic root entry', () => {
    const diff = compareSchemas(42, 'hi');
    expect(entry(diff, '(root)')).toMatchObject({
      before: 'number',
      after: 'string',
      status: 'changed',
    });
  });
});

describe('renderSchemaDiff', () => {
  it('renders a summary line and a side-by-side table', () => {
    const diff = compareSchemas({ id: 1, old: true }, { id: 1, new: 'x' });
    const table = renderSchemaDiff(diff);
    expect(table).toContain('**1 added, 1 removed, 0 changed, 1 unchanged**');
    expect(table).toContain('| Field | Before | After | Status |');
    expect(table).toContain('| --- | --- | --- | --- |');
    expect(table).toContain('| id | number | number | unchanged |');
  });

  it('uses an em dash placeholder for a missing side', () => {
    const diff = compareSchemas({ id: 1 }, { id: 1, email: 'x' });
    const table = renderSchemaDiff(diff);
    expect(table).toContain('| email | — | string | added |');
  });

  it('honors custom column names', () => {
    const diff = compareSchemas({ id: 1 }, { id: 1 });
    const table = renderSchemaDiff(diff, { beforeName: 'v1', afterName: 'v2' });
    expect(table).toContain('## Schema Diff: v1 → v2');
    expect(table).toContain('| Field | v1 | v2 | Status |');
  });

  it('can omit unchanged rows', () => {
    const diff = compareSchemas({ id: 1, name: 'a' }, { id: 1, name: 'b' });
    const table = renderSchemaDiff(diff, { includeUnchanged: false });
    expect(table).not.toContain('| id |');
    expect(table).not.toContain('| name |');
  });

  it('escapes pipe characters in field paths and types', () => {
    const diff = compareSchemas({ 'a|b': 1 }, { 'a|b': [1, 'x'] });
    const table = renderSchemaDiff(diff);
    expect(table).toContain(
      '| a\\|b | number | (number \\| string)[] | changed |',
    );
  });
});
