import { describe, expect, it } from 'vitest';
import {
  generateMarkdownDocs,
  jsonToMarkdown,
} from '../src/transformers/markdown';

/** Convenience: generate Markdown docs directly from a value. */
function gen(value: unknown, options = {}): string {
  return generateMarkdownDocs(value, options);
}

describe('jsonToMarkdown', () => {
  it('returns a TransformResult with the Markdown label', () => {
    const result = jsonToMarkdown('{"id": 1}');
    expect(result.label).toBe('Markdown');
    expect(result.code).toContain('## Root');
  });

  it('throws a SyntaxError on invalid JSON', () => {
    expect(() => jsonToMarkdown('{ not valid')).toThrow(SyntaxError);
    expect(() => jsonToMarkdown('{ not valid')).toThrow(/Invalid JSON/);
  });
});

describe('object tables', () => {
  it('renders a property table with a header and separator row', () => {
    expect(gen({ id: 1, name: 'a', active: true })).toBe(
      [
        '## Root',
        '| Property | Type | Required |',
        '| --- | --- | --- |',
        '| id | number | Yes |',
        '| name | string | Yes |',
        '| active | boolean | Yes |',
      ].join('\n'),
    );
  });

  it('renders an empty root object as a placeholder note', () => {
    expect(gen({})).toBe('## Root\n\n_No properties._');
  });

  it('renders a nested empty object as a generic object type', () => {
    expect(gen({ meta: {} })).toContain('| meta | object | Yes |');
  });
});

describe('nested objects', () => {
  it('hoists nested objects into their own sections, parent first', () => {
    const doc = gen({ user: { id: 1, address: { city: 'NYC' } } });
    expect(doc).toContain('## Root');
    expect(doc).toContain('| user | [User](#user) | Yes |');
    expect(doc).toContain('| address | [Address](#address) | Yes |');
    expect(doc).toContain('## User');
    expect(doc).toContain('## Address');
    expect(doc).toContain('| city | string | Yes |');
    // Parent sections precede the children they reference.
    expect(doc.indexOf('## Root')).toBeLessThan(doc.indexOf('## User'));
    expect(doc.indexOf('## User')).toBeLessThan(doc.indexOf('## Address'));
  });
});

describe('arrays', () => {
  it('renders arrays of primitives', () => {
    expect(gen({ tags: ['a', 'b'] })).toContain('| tags | string[] | Yes |');
  });

  it('renders an empty array as unknown[]', () => {
    expect(gen({ items: [] })).toContain('| items | unknown[] | Yes |');
  });

  it('links to element sections named from a singularized key', () => {
    const doc = gen({ users: [{ id: 1 }] });
    expect(doc).toContain('| users | [User](#user)[] | Yes |');
    expect(doc).toContain('## User');
    expect(doc).toContain('| id | number | Yes |');
  });

  it('merges objects across an array and marks missing keys optional', () => {
    const doc = gen({
      users: [
        { id: 1, name: 'a' },
        { id: 2, email: 'b@x.com' },
      ],
    });
    expect(doc).toContain('| id | number | Yes |');
    expect(doc).toContain('| name | string | No |');
    expect(doc).toContain('| email | string | No |');
  });
});

describe('unions and nullables', () => {
  it('escapes union pipes inside array element types', () => {
    expect(gen({ mixed: [1, 'a'] })).toContain(
      '| mixed | (number \\| string)[] | Yes |',
    );
  });

  it('renders a null value as null', () => {
    expect(gen({ deleted: null })).toContain('| deleted | null | Yes |');
  });

  it('keeps null at the end of a union', () => {
    expect(gen({ note: ['x', null] })).toContain(
      '| note | (string \\| null)[] | Yes |',
    );
  });
});

describe('property key formatting', () => {
  it('escapes pipe characters in keys', () => {
    expect(gen({ 'a|b': 1 })).toContain('| a\\|b | number | Yes |');
  });

  it('leaves non-identifier keys readable in the table', () => {
    expect(gen({ 'first-name': 'a' })).toContain(
      '| first-name | string | Yes |',
    );
  });
});

describe('top-level values', () => {
  it('renders a top-level primitive as a typed note', () => {
    expect(gen(42)).toBe('## Root\n\nType: number');
    expect(gen('hi')).toBe('## Root\n\nType: string');
  });

  it('describes a top-level array and hoists its element section', () => {
    const doc = gen([{ id: 1 }]);
    expect(doc).toContain('## Root\n\nArray of [RootItem](#rootitem).');
    expect(doc).toContain('## RootItem');
    expect(doc).toContain('| id | number | Yes |');
  });

  it('uses a singular element name derived from rootName', () => {
    const doc = gen([{ id: 1 }], { rootName: 'Users' });
    expect(doc).toContain('Array of [User](#user).');
    expect(doc).toContain('## User');
  });
});

describe('options', () => {
  it('honors a custom rootName', () => {
    expect(gen({ id: 1 }, { rootName: 'Person' })).toContain('## Person');
  });
});

describe('name collisions', () => {
  it('deduplicates section names with a numeric suffix', () => {
    const doc = gen({ a: { thing: { x: 1 } }, b: { thing: { y: 2 } } });
    expect(doc).toContain('## Thing');
    expect(doc).toContain('## Thing2');
    expect(doc).toContain('| x | number | Yes |');
    expect(doc).toContain('| y | number | Yes |');
  });
});
