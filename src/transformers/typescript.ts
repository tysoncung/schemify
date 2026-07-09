// JSON → TypeScript interface generator.
//
// Infers a TypeScript type model from an arbitrary JSON value and renders it as
// a set of named `interface` declarations (plus a root `type` alias when the
// root is not a plain object). Handles nested objects, arrays, unions, nullable
// values, and optional properties (keys that are absent from some elements of an
// array of objects).

import type { TransformResult } from '../types';

export interface TypeScriptOptions {
  /** Name for the root interface / type alias. Defaults to `"Root"`. */
  rootName?: string;
  /** Prefix declarations with the `export` keyword. Defaults to `true`. */
  export?: boolean;
}

// --- Internal type model -----------------------------------------------------

type TypeNode = PrimitiveNode | ArrayNode | ObjectNode | UnionNode;

interface PrimitiveNode {
  kind: 'primitive';
  name: 'string' | 'number' | 'boolean' | 'null' | 'unknown';
}

interface ArrayNode {
  kind: 'array';
  element: TypeNode;
}

interface ObjectNode {
  kind: 'object';
  properties: Map<string, PropertyNode>;
}

interface UnionNode {
  kind: 'union';
  types: TypeNode[];
}

interface PropertyNode {
  type: TypeNode;
  optional: boolean;
}

// --- Inference ---------------------------------------------------------------

function infer(value: unknown): TypeNode {
  if (value === null || value === undefined) {
    return { kind: 'primitive', name: 'null' };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { kind: 'array', element: { kind: 'primitive', name: 'unknown' } };
    }
    return { kind: 'array', element: mergeMany(value.map(infer)) };
  }
  switch (typeof value) {
    case 'string':
      return { kind: 'primitive', name: 'string' };
    case 'number':
      return { kind: 'primitive', name: 'number' };
    case 'boolean':
      return { kind: 'primitive', name: 'boolean' };
    case 'object': {
      const properties = new Map<string, PropertyNode>();
      for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
      )) {
        properties.set(key, { type: infer(child), optional: false });
      }
      return { kind: 'object', properties };
    }
    default:
      return { kind: 'primitive', name: 'unknown' };
  }
}

/** Collapse a list of type nodes into a single node, unioning distinct shapes. */
function mergeMany(nodes: TypeNode[]): TypeNode {
  const flat: TypeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'union') {
      flat.push(...node.types);
    } else {
      flat.push(node);
    }
  }

  const objects = flat.filter((n): n is ObjectNode => n.kind === 'object');
  const arrays = flat.filter((n): n is ArrayNode => n.kind === 'array');
  const primitives = flat.filter(
    (n): n is PrimitiveNode => n.kind === 'primitive',
  );

  const result: TypeNode[] = [];

  if (objects.length > 0) {
    result.push(mergeObjects(objects));
  }
  if (arrays.length > 0) {
    result.push({
      kind: 'array',
      element: mergeMany(arrays.map((a) => a.element)),
    });
  }

  const seen = new Set<string>();
  for (const primitive of primitives) {
    if (!seen.has(primitive.name)) {
      seen.add(primitive.name);
      result.push(primitive);
    }
  }

  if (result.length === 0) {
    return { kind: 'primitive', name: 'unknown' };
  }
  if (result.length === 1) {
    return result[0];
  }
  return { kind: 'union', types: result };
}

/**
 * Merge object shapes seen at the same position. The union of all keys is used;
 * a key that is missing from (or already optional in) any object becomes
 * optional, and its type is the merge of every type observed for that key.
 */
function mergeObjects(objects: ObjectNode[]): ObjectNode {
  const total = objects.length;
  const order: string[] = [];
  const collected = new Map<
    string,
    { types: TypeNode[]; count: number; optional: boolean }
  >();

  for (const object of objects) {
    for (const [key, prop] of object.properties) {
      let entry = collected.get(key);
      if (!entry) {
        entry = { types: [], count: 0, optional: false };
        collected.set(key, entry);
        order.push(key);
      }
      entry.types.push(prop.type);
      entry.count += 1;
      if (prop.optional) {
        entry.optional = true;
      }
    }
  }

  const properties = new Map<string, PropertyNode>();
  for (const key of order) {
    const entry = collected.get(key);
    if (!entry) {
      continue;
    }
    properties.set(key, {
      type: mergeMany(entry.types),
      optional: entry.optional || entry.count < total,
    });
  }
  return { kind: 'object', properties };
}

// --- Rendering ---------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function formatKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function pascalCase(input: string): string {
  const parts = input.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

/** Best-effort singularization for naming an array element interface. */
function singularize(word: string): string {
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

function render(root: TypeNode, options: TypeScriptOptions): string {
  const rootName = pascalCase(options.rootName ?? 'Root') || 'Root';
  const exportKeyword = options.export === false ? '' : 'export ';
  const declarations: string[] = [];
  const used = new Set<string>();

  function uniqueName(base: string): string {
    const name = base || 'Anonymous';
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    let suffix = 2;
    while (used.has(`${name}${suffix}`)) {
      suffix += 1;
    }
    const unique = `${name}${suffix}`;
    used.add(unique);
    return unique;
  }

  function registerInterface(node: ObjectNode, hint: string): string {
    const name = uniqueName(pascalCase(hint) || 'Anonymous');
    // Reserve a slot up front so parents are emitted before their children.
    const slot = declarations.length;
    declarations.push('');

    const lines: string[] = [];
    for (const [key, prop] of node.properties) {
      const optional = prop.optional ? '?' : '';
      lines.push(
        `  ${formatKey(key)}${optional}: ${typeString(prop.type, key)};`,
      );
    }
    const body = lines.length > 0 ? `\n${lines.join('\n')}\n` : '';
    declarations[slot] = `${exportKeyword}interface ${name} {${body}}`;
    return name;
  }

  function typeString(node: TypeNode, hint: string): string {
    switch (node.kind) {
      case 'primitive':
        return node.name;
      case 'object':
        if (node.properties.size === 0) {
          return 'Record<string, unknown>';
        }
        return registerInterface(node, hint);
      case 'array': {
        const element = typeString(node.element, singularize(hint));
        return node.element.kind === 'union'
          ? `(${element})[]`
          : `${element}[]`;
      }
      case 'union': {
        const parts = [
          ...new Set(node.types.map((type) => typeString(type, hint))),
        ];
        // Keep `null` at the end for readability (e.g. `string | null`).
        parts.sort((a, b) => (a === 'null' ? 1 : 0) - (b === 'null' ? 1 : 0));
        return parts.join(' | ');
      }
      default:
        return 'unknown';
    }
  }

  if (root.kind === 'object' && root.properties.size > 0) {
    registerInterface(root, rootName);
  } else {
    used.add(rootName);
    let hint = rootName;
    if (root.kind === 'array') {
      const singular = singularize(rootName);
      hint = singular === rootName ? `${rootName}Item` : singular;
    }
    const body = typeString(root, hint);
    declarations.push(`${exportKeyword}type ${rootName} = ${body};`);
  }

  return declarations.join('\n\n');
}

// --- Public API --------------------------------------------------------------

/** Generate TypeScript interface source from an already-parsed JSON value. */
export function generateTypescriptInterfaces(
  value: unknown,
  options: TypeScriptOptions = {},
): string {
  return render(infer(value), options);
}

/**
 * Transform a JSON string into TypeScript interfaces.
 *
 * @throws {SyntaxError} if `json` is not valid JSON.
 */
export function jsonToTypescript(
  json: string,
  options: TypeScriptOptions = {},
): TransformResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(`Invalid JSON: ${(error as Error).message}`);
  }
  return {
    label: 'TypeScript',
    code: generateTypescriptInterfaces(value, options),
  };
}
