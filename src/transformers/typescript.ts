// JSON → TypeScript interface generator.
//
// Infers a TypeScript type model from an arbitrary JSON value and renders it as
// a set of named `interface` declarations (plus a root `type` alias when the
// root is not a plain object). Handles nested objects, arrays, unions, nullable
// values, and optional properties (keys that are absent from some elements of an
// array of objects).

import type { TransformResult } from '../types';
import { type ObjectNode, type TypeNode, infer } from './infer';
import { formatKey, pascalCase, singularize } from './naming';

export interface TypeScriptOptions {
  /** Name for the root interface / type alias. Defaults to `"Root"`. */
  rootName?: string;
  /** Prefix declarations with the `export` keyword. Defaults to `true`. */
  export?: boolean;
}

// --- Rendering ---------------------------------------------------------------

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
