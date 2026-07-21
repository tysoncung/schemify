import { describe, expect, it } from 'vitest';
import {
  type ApiDiff,
  type ApiDiffOptions,
  compareApiSchemas,
  jsonToApiDiff,
  renderApiDiff,
} from '../src/transformers/apidiff';

/** Find the diff entry for a given field path. */
function entry(diff: ApiDiff, path: string) {
  return diff.entries.find((e) => e.path === path);
}

/** Compare two payloads treating them as request schemas. */
function asRequest(
  before: unknown,
  after: unknown,
  options: ApiDiffOptions = {},
): ApiDiff {
  return compareApiSchemas(before, after, { ...options, direction: 'request' });
}

describe('jsonToApiDiff', () => {
  it('returns a TransformResult with the API Diff label and verdict', () => {
    const result = jsonToApiDiff('{"id": 1}', '{"id": 1}');
    expect(result.label).toBe('API Diff');
    expect(result.code).toContain('## API Diff: Before → After');
    expect(result.code).toContain('**Verdict: IDENTICAL**');
  });

  it('throws a SyntaxError naming the invalid side', () => {
    expect(() => jsonToApiDiff('{ bad', '{}')).toThrow(SyntaxError);
    expect(() => jsonToApiDiff('{ bad', '{}')).toThrow(
      /Invalid JSON \(Before\)/,
    );
    expect(() => jsonToApiDiff('{}', '{ bad')).toThrow(
      /Invalid JSON \(After\)/,
    );
  });

  it('passes options through to the comparison and renderer', () => {
    const result = jsonToApiDiff('{"id": 1}', '{}', {
      beforeName: 'v1',
      afterName: 'v2',
    });
    expect(result.code).toContain('## API Diff: v1 → v2');
    expect(result.code).toContain('**Verdict: BREAKING**');
  });
});

describe('response compatibility (default direction)', () => {
  it('flags a removed field as breaking', () => {
    const diff = compareApiSchemas({ id: 1, email: 'a@b.c' }, { id: 1 });
    expect(entry(diff, 'email')).toMatchObject({
      status: 'removed',
      breaking: true,
      detail: 'Field removed',
    });
    expect(diff.compatibility).toBe('breaking');
    expect(diff.summary.breaking).toBe(1);
  });

  it('treats an added field as compatible', () => {
    const diff = compareApiSchemas({ id: 1 }, { id: 1, avatar: 'url' });
    expect(entry(diff, 'avatar')).toMatchObject({
      status: 'added',
      breaking: false,
      detail: 'Field added',
    });
    expect(diff.compatibility).toBe('compatible');
    expect(diff.summary.compatible).toBe(1);
  });

  it('flags a type change as breaking and names both types', () => {
    const diff = compareApiSchemas({ id: 1 }, { id: '1' });
    expect(entry(diff, 'id')).toMatchObject({
      status: 'changed',
      breaking: true,
      detail: 'Type changed from `number` to `string`',
    });
    expect(diff.compatibility).toBe('breaking');
  });

  it('flags a field becoming optional as breaking', () => {
    const before = { users: [{ id: 1, name: 'a' }] };
    const after = { users: [{ id: 1, name: 'a' }, { id: 2 }] };
    const diff = compareApiSchemas(before, after);
    expect(entry(diff, 'users[].name')).toMatchObject({
      before: 'string',
      after: 'string?',
      breaking: true,
      detail: 'Field became optional (may now be absent)',
    });
  });

  it('treats a field becoming required as compatible', () => {
    const before = { users: [{ id: 1, name: 'a' }, { id: 2 }] };
    const after = { users: [{ id: 1, name: 'a' }] };
    const diff = compareApiSchemas(before, after);
    expect(entry(diff, 'users[].name')).toMatchObject({
      before: 'string?',
      after: 'string',
      breaking: false,
      detail: 'Field became required (always present now)',
    });
    expect(diff.compatibility).toBe('compatible');
  });

  it('reports identical schemas as identical', () => {
    const diff = compareApiSchemas({ id: 1, name: 'a' }, { id: 2, name: 'b' });
    expect(diff.compatibility).toBe('identical');
    expect(diff.summary).toEqual({ breaking: 0, compatible: 0, unchanged: 2 });
  });

  it('carries breaking analysis down nested paths', () => {
    const diff = compareApiSchemas(
      { user: { id: 1, email: 'a@b.c' } },
      { user: { id: 1 } },
    );
    expect(entry(diff, 'user.email')).toMatchObject({
      status: 'removed',
      breaking: true,
    });
    expect(diff.compatibility).toBe('breaking');
  });
});

describe('verdict precedence', () => {
  it('is breaking when any change breaks, even alongside compatible ones', () => {
    const diff = compareApiSchemas(
      { id: 1, legacy: true },
      { id: 1, added: 'x' },
    );
    expect(entry(diff, 'legacy')?.breaking).toBe(true);
    expect(entry(diff, 'added')?.breaking).toBe(false);
    expect(diff.summary).toEqual({ breaking: 1, compatible: 1, unchanged: 1 });
    expect(diff.compatibility).toBe('breaking');
  });
});

describe('request compatibility (direction: request)', () => {
  it('flags a new required field as breaking', () => {
    const diff = asRequest({ id: 1 }, { id: 1, token: 'x' });
    expect(entry(diff, 'token')).toMatchObject({
      breaking: true,
      detail: 'Required field added',
    });
    expect(diff.compatibility).toBe('breaking');
  });

  it('treats a new optional field as compatible', () => {
    const before = { users: [{ id: 1 }, { id: 2 }] };
    const after = { users: [{ id: 1, note: 'x' }, { id: 2 }] };
    const diff = asRequest(before, after);
    expect(entry(diff, 'users[].note')).toMatchObject({
      after: 'string?',
      breaking: false,
      detail: 'Optional field added',
    });
    expect(diff.compatibility).toBe('compatible');
  });

  it('treats a removed field as compatible', () => {
    const diff = asRequest({ id: 1, legacy: true }, { id: 1 });
    expect(entry(diff, 'legacy')).toMatchObject({
      breaking: false,
      detail: 'Field removed',
    });
    expect(diff.compatibility).toBe('compatible');
  });

  it('flips optionality verdicts relative to responses', () => {
    const data = {
      before: { users: [{ id: 1, name: 'a' }] },
      after: { users: [{ id: 1, name: 'a' }, { id: 2 }] },
    };
    // required → optional is compatible for a request payload...
    const becameOptional = asRequest(data.before, data.after);
    expect(entry(becameOptional, 'users[].name')).toMatchObject({
      breaking: false,
      detail: 'Field became optional',
    });
    // ...while optional → required breaks callers that omit it.
    const becameRequired = asRequest(data.after, data.before);
    expect(entry(becameRequired, 'users[].name')).toMatchObject({
      breaking: true,
      detail: 'Field became required',
    });
  });
});

describe('renderApiDiff', () => {
  it('groups changes under breaking and compatible sections', () => {
    const diff = compareApiSchemas(
      { id: 1, legacy: true },
      { id: 1, added: 'x' },
    );
    const report = renderApiDiff(diff);
    expect(report).toContain(
      '**Verdict: BREAKING** — 1 breaking, 1 compatible, 1 unchanged',
    );
    expect(report).toContain('### Breaking changes');
    expect(report).toContain('| Field | Before | After | Change |');
    expect(report).toContain('| legacy | boolean | — | Field removed |');
    expect(report).toContain('### Compatible changes');
    expect(report).toContain('| added | — | string | Field added |');
  });

  it('omits the unchanged section by default and includes it on request', () => {
    const diff = compareApiSchemas({ id: 1 }, { id: 1, added: 'x' });
    expect(renderApiDiff(diff)).not.toContain('### Unchanged');
    const withUnchanged = renderApiDiff(diff, { includeUnchanged: true });
    expect(withUnchanged).toContain('### Unchanged');
    expect(withUnchanged).toContain('| id | number | number | Unchanged |');
  });

  it('drops empty sections', () => {
    const diff = compareApiSchemas({ id: 1 }, { id: 1, added: 'x' });
    const report = renderApiDiff(diff);
    expect(report).not.toContain('### Breaking changes');
    expect(report).toContain('### Compatible changes');
  });

  it('honors custom column names', () => {
    const diff = compareApiSchemas({ id: 1 }, { id: 1 });
    const report = renderApiDiff(diff, { beforeName: 'v1', afterName: 'v2' });
    expect(report).toContain('## API Diff: v1 → v2');
  });

  it('escapes pipe characters in union types', () => {
    const diff = compareApiSchemas({ note: 'x' }, { note: ['x', null] });
    const report = renderApiDiff(diff);
    expect(report).toContain('(string \\| null)[]');
  });
});
