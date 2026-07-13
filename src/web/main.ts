// Browser entry for the Schemify playground.
//
// This is the thin DOM layer over the framework-agnostic core in
// `../transformers/playground`: it wires the textarea, the format picker, and
// the option controls to state updates, then paints each computed output into
// the right pane. Everything that decides *what* to show lives in the core and
// is unit-tested there; this file only moves values in and out of the DOM.

import {
  type PlaygroundState,
  createPlaygroundState,
  formatChoices,
  render,
  setFormat,
  setInput,
  setOptions,
} from '../transformers/playground';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const input = requireElement<HTMLTextAreaElement>('#input');
const picker = requireElement<HTMLSelectElement>('#format');
const rootName = requireElement<HTMLInputElement>('#root-name');
const exportToggle = requireElement<HTMLInputElement>('#export');
const output = requireElement<HTMLElement>('#output');
const status = requireElement<HTMLElement>('#status');

// Populate the picker from the registry so new formats appear here for free.
for (const choice of formatChoices()) {
  const option = document.createElement('option');
  option.value = choice.format;
  option.textContent = choice.label;
  picker.append(option);
}

let state: PlaygroundState = createPlaygroundState();
picker.value = state.format;

function paint(): void {
  const result = render(state);
  output.classList.toggle('placeholder', result.status === 'empty');
  status.className = `status ${result.status}`;
  switch (result.status) {
    case 'empty':
      output.textContent = 'Paste JSON on the left to see the output here.';
      status.textContent = 'Waiting for input';
      break;
    case 'error':
      output.textContent = result.message;
      status.textContent = 'Invalid input';
      break;
    case 'ok':
      output.textContent = result.code;
      status.textContent = `${result.label} · .${result.extension}`;
      break;
  }
}

input.addEventListener('input', () => {
  state = setInput(state, input.value);
  paint();
});

picker.addEventListener('change', () => {
  state = setFormat(state, picker.value);
  paint();
});

rootName.addEventListener('input', () => {
  const value = rootName.value.trim();
  state = setOptions(state, { rootName: value === '' ? undefined : value });
  paint();
});

exportToggle.addEventListener('change', () => {
  state = setOptions(state, { export: exportToggle.checked });
  paint();
});

paint();
