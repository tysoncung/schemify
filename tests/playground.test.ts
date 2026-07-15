import { describe, expect, it } from 'vitest';
import {
  createPlaygroundState,
  defaultFormat,
  formatChoices,
  render,
  setFormat,
  setInput,
  setOptions,
  transform,
} from '../src/transformers/playground';

describe('formatChoices', () => {
  it('offers every registered format with its label, in display order', () => {
    expect(formatChoices()).toEqual([
      { format: 'typescript', label: 'TypeScript' },
      { format: 'zod', label: 'Zod' },
      { format: 'graphql', label: 'GraphQL' },
      { format: 'openapi', label: 'OpenAPI' },
      { format: 'markdown', label: 'Markdown' },
    ]);
  });
});

describe('defaultFormat', () => {
  it('is the first registered format', () => {
    expect(defaultFormat()).toBe('typescript');
  });
});

describe('transform', () => {
  it('reports empty for blank or whitespace-only input', () => {
    expect(transform('', 'typescript')).toEqual({ status: 'empty' });
    expect(transform('   \n\t ', 'zod')).toEqual({ status: 'empty' });
  });

  it('produces ok output with code, label, and extension on success', () => {
    const output = transform('{"id": 1}', 'typescript');
    expect(output.status).toBe('ok');
    if (output.status !== 'ok') return;
    expect(output.format).toBe('typescript');
    expect(output.label).toBe('TypeScript');
    expect(output.extension).toBe('ts');
    expect(output.code).toContain('interface Root');
  });

  it('resolves aliases and casing from the picker value', () => {
    const output = transform('{"id": 1}', '  TS ');
    expect(output.status).toBe('ok');
    if (output.status !== 'ok') return;
    expect(output.format).toBe('typescript');
  });

  it('reports an error for invalid JSON without throwing', () => {
    const output = transform('{ not valid', 'typescript');
    expect(output.status).toBe('error');
    if (output.status !== 'error') return;
    expect(output.message).toMatch(/Invalid JSON/);
  });

  it('reports an error for an unknown format', () => {
    const output = transform('{"id": 1}', 'protobuf');
    expect(output).toEqual({
      status: 'error',
      message: 'Unknown format: protobuf',
    });
  });

  it('forwards transformer options', () => {
    const output = transform('{"id": 1}', 'zod', { rootName: 'Person' });
    expect(output.status).toBe('ok');
    if (output.status !== 'ok') return;
    expect(output.code).toContain('personSchema');
  });
});

describe('playground state', () => {
  it('starts empty on the default format with export enabled', () => {
    const state = createPlaygroundState();
    expect(state).toEqual({
      input: '',
      format: 'typescript',
      options: { export: true },
    });
    expect(render(state)).toEqual({ status: 'empty' });
  });

  it('applies overrides to the initial state', () => {
    const state = createPlaygroundState({ format: 'zod' });
    expect(state.format).toBe('zod');
    expect(state.input).toBe('');
  });

  it('renders the selected format from the current input', () => {
    const state = setInput(
      createPlaygroundState({ format: 'zod' }),
      '{"id": 1}',
    );
    const output = render(state);
    expect(output.status).toBe('ok');
    if (output.status !== 'ok') return;
    expect(output.format).toBe('zod');
    expect(output.code).toContain('z.object');
  });

  it('setInput and setFormat return new states without mutating the original', () => {
    const original = createPlaygroundState();
    const withInput = setInput(original, '{"id": 1}');
    const withFormat = setFormat(withInput, 'openapi');

    expect(original.input).toBe('');
    expect(original.format).toBe('typescript');
    expect(withInput.input).toBe('{"id": 1}');
    expect(withFormat.format).toBe('openapi');
    expect(withFormat.input).toBe('{"id": 1}');
  });

  it('setFormat resolves aliases and ignores unknown formats', () => {
    const state = createPlaygroundState();
    expect(setFormat(state, 'oas').format).toBe('openapi');
    expect(setFormat(state, 'nonsense').format).toBe('typescript');
  });

  it('setOptions merges into the existing options', () => {
    const state = setOptions(createPlaygroundState({ input: '{"id": 1}' }), {
      export: false,
    });
    expect(state.options).toEqual({ export: false });
    const output = render(state);
    expect(output.status).toBe('ok');
    if (output.status !== 'ok') return;
    expect(output.code).not.toContain('export ');
  });
});
