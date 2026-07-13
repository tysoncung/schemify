// Web UI core — the headless engine behind Schemify's "paste JSON on the left,
// pick a format, see the result on the right" playground.
//
// This module holds no DOM references: a browser front-end owns the textarea,
// the format picker, and the output pane, and calls these pure functions to
// drive them (see `src/web/main.ts`). Keeping the interaction here means every
// state — empty input, invalid JSON, an unknown format, and a successful
// generation — is unit-testable without a DOM, and the same core can back a
// CLI playground, an editor plugin, or a REPL just as easily.

import {
  type Format,
  type FormatOptions,
  listFormats,
  resolveFormat,
} from './registry';

/** A selectable output format, ready to render as a dropdown `<option>`. */
export interface FormatChoice {
  /** Canonical format name, used as the option's value. */
  format: Format;
  /** Human-readable label shown to the user. */
  label: string;
}

/** The left-pane input plus the selected format and transformer options. */
export interface PlaygroundState {
  /** Raw JSON pasted into the left pane. */
  input: string;
  /** The output format selected in the picker. */
  format: Format;
  /** Options forwarded to the transformer (root name, `export` keyword). */
  options: FormatOptions;
}

/** What the right pane should display for the current state. */
export type PlaygroundOutput =
  /** No input yet — show a placeholder rather than an error. */
  | { status: 'empty' }
  /** Invalid JSON or an unknown format — show `message`. */
  | { status: 'error'; message: string }
  /** A successful transformation — render `code`. */
  | {
      status: 'ok';
      format: Format;
      label: string;
      extension: string;
      code: string;
    };

/** The formats offered by the picker, in display order. */
export function formatChoices(): FormatChoice[] {
  return listFormats().map((def) => ({ format: def.format, label: def.label }));
}

/** The format selected by default (the first registered format). */
export function defaultFormat(): Format {
  return listFormats()[0].format;
}

/** A fresh playground state, with optional overrides applied on top. */
export function createPlaygroundState(
  overrides: Partial<PlaygroundState> = {},
): PlaygroundState {
  return {
    input: '',
    format: defaultFormat(),
    options: { export: true },
    ...overrides,
  };
}

/**
 * Compute the right-pane output for a raw input and format selection.
 *
 * `format` is accepted as a plain string so it can come straight from the
 * picker's value: aliases and casing are resolved here, and an unrecognized
 * name surfaces as an `error` output rather than throwing. Empty or
 * whitespace-only input yields an `empty` output so the UI can show a
 * placeholder, and a JSON parse (or transform) failure yields an `error`.
 */
export function transform(
  input: string,
  format: string,
  options: FormatOptions = {},
): PlaygroundOutput {
  if (input.trim() === '') {
    return { status: 'empty' };
  }
  const def = resolveFormat(format);
  if (!def) {
    return { status: 'error', message: `Unknown format: ${format}` };
  }
  try {
    const result = def.transform(input, options);
    return {
      status: 'ok',
      format: def.format,
      label: result.label,
      extension: def.extension,
      code: result.code,
    };
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
}

/** Compute the right-pane output for a whole {@link PlaygroundState}. */
export function render(state: PlaygroundState): PlaygroundOutput {
  return transform(state.input, state.format, state.options);
}

/** Return a new state with the left-pane input replaced. */
export function setInput(
  state: PlaygroundState,
  input: string,
): PlaygroundState {
  return { ...state, input };
}

/**
 * Return a new state with a different format selected. `name` may be a canonical
 * name or an alias; an unrecognized name leaves the state unchanged (the picker
 * only ever offers known formats).
 */
export function setFormat(
  state: PlaygroundState,
  name: string,
): PlaygroundState {
  const def = resolveFormat(name);
  return def ? { ...state, format: def.format } : state;
}

/** Return a new state with the given transformer options merged in. */
export function setOptions(
  state: PlaygroundState,
  patch: Partial<FormatOptions>,
): PlaygroundState {
  return { ...state, options: { ...state.options, ...patch } };
}
