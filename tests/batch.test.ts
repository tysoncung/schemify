import { describe, expect, it } from 'vitest';
import { type BatchSource, processBatch } from '../src/transformers/batch';

const user: BatchSource = { name: 'user.json', json: '{"id": 1, "name": "a"}' };

describe('processBatch', () => {
  it('transforms a single source into a single format', () => {
    const results = processBatch([user], ['typescript']);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'user.json',
      format: 'typescript',
      label: 'TypeScript',
      extension: 'ts',
      error: null,
    });
    expect(results[0].code).toContain('interface Root');
  });

  it('produces one result per source per format, source-major', () => {
    const other: BatchSource = { name: 'b.json', json: '{"x": true}' };
    const results = processBatch([user, other], ['typescript', 'zod']);
    expect(results.map((result) => [result.source, result.format])).toEqual([
      ['user.json', 'typescript'],
      ['user.json', 'zod'],
      ['b.json', 'typescript'],
      ['b.json', 'zod'],
    ]);
  });

  it('forwards format options to the transformers', () => {
    const [result] = processBatch([user], ['zod'], { rootName: 'Person' });
    expect(result.code).toContain('personSchema');
  });

  it('captures invalid JSON as an error without throwing', () => {
    const results = processBatch(
      [{ name: 'bad.json', json: '{ not valid' }],
      ['typescript'],
    );
    expect(results[0].code).toBeNull();
    expect(results[0].error).toMatch(/Invalid JSON/);
  });

  it('keeps processing later sources after an earlier one fails', () => {
    const results = processBatch(
      [{ name: 'bad.json', json: 'oops' }, user],
      ['typescript'],
    );
    expect(results[0].error).not.toBeNull();
    expect(results[1].error).toBeNull();
    expect(results[1].code).toContain('interface Root');
  });

  it('reports an unknown format as an error result', () => {
    const results = processBatch([user], ['protobuf' as never]);
    expect(results[0]).toMatchObject({
      format: 'protobuf',
      code: null,
      error: 'Unknown format: protobuf',
    });
  });

  it('returns an empty array when there are no sources', () => {
    expect(processBatch([], ['typescript'])).toEqual([]);
  });
});
