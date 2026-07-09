// Shared identifier/naming helpers used when rendering generated source code.

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Render an object key, quoting it when it is not a bare identifier. */
export function formatKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** Convert an arbitrary string to `PascalCase`, prefixing a leading digit. */
export function pascalCase(input: string): string {
  const parts = input.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

/** Convert an arbitrary string to `camelCase`. */
export function camelCase(input: string): string {
  const pascal = pascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Best-effort singularization for naming an array element declaration. */
export function singularize(word: string): string {
  if (/ies$/i.test(word)) {
    return word.replace(/ies$/i, 'y');
  }
  if (/(ss|us|is)$/i.test(word)) {
    return word;
  }
  if (/(ch|sh|x|z|s)es$/i.test(word)) {
    return word.replace(/es$/i, '');
  }
  if (/s$/i.test(word) && !/ss$/i.test(word)) {
    return word.replace(/s$/i, '');
  }
  return word;
}
