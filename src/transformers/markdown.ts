// JSON → Markdown documentation generator.
//
// Infers a type model from an arbitrary JSON value (see `./infer`) and renders
// it as Markdown reference documentation: one `##` section per object shape,
// each containing a `| Property | Type | Required |` table. Nested objects are
// hoisted into their own sections — emitted parent-first — and referenced from
// the type column with an anchor link (e.g. `[User](#user)`), mirroring how the
// TypeScript, Zod, and OpenAPI transformers hoist nested objects into named
// declarations. Arrays, unions, nullable values, and optional properties map
// onto `Type[]`, `A \| B`, a trailing `null` arm, and a `No` in the required
// column respectively.

import type { TransformResult } from '../types';
import { type ObjectNode, type TypeNode, infer } from './infer';
import { pascalCase, singularize } from './naming';

export interface MarkdownOptions {
  /** Name for the root section / type. Defaults to `"Root"`. */
  rootName?: string;
}

// --- Rendering ---------------------------------------------------------------

/** GitHub-style heading anchor: lowercase, non-alphanumerics to hyphens. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Escape a value for use inside a Markdown table cell. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function render(root: TypeNode, options: MarkdownOptions): string {
  const rootName = pascalCase(options.rootName ?? 'Root') || 'Root';
  const sections: string[] = [];
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

  /** A Markdown link to a hoisted object type's section. */
  function link(name: string): string {
    return `[${name}](#${slug(name)})`;
  }

  // Hoist an object into its own `##` section with a property table and return
  // its name. The slot is reserved up front (before building rows) so parents
  // are emitted ahead of the children they reference.
  function registerTable(node: ObjectNode, hint: string): string {
    const name = uniqueName(pascalCase(hint) || 'Anonymous');
    const slot = sections.length;
    sections.push('');

    const rows: string[] = [];
    for (const [key, prop] of node.properties) {
      const type = escapeCell(typeString(prop.type, key));
      const required = prop.optional ? 'No' : 'Yes';
      rows.push(`| ${escapeCell(key)} | ${type} | ${required} |`);
    }

    sections[slot] = [
      `## ${name}`,
      '| Property | Type | Required |',
      '| --- | --- | --- |',
      ...rows,
    ].join('\n');
    return name;
  }

  function typeString(node: TypeNode, hint: string): string {
    switch (node.kind) {
      case 'primitive':
        return node.name;
      case 'object':
        // An object with no observed keys accepts arbitrary properties.
        return node.properties.size === 0
          ? 'object'
          : link(registerTable(node, hint));
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

  // One-line body for a root that has no property table of its own.
  function describeRoot(node: TypeNode, hint: string): string {
    if (node.kind === 'array') {
      return `Array of ${typeString(node.element, hint)}.`;
    }
    if (node.kind === 'object') {
      // An empty root object — no observed keys.
      return '_No properties._';
    }
    return `Type: ${typeString(node, hint)}`;
  }

  if (root.kind === 'object' && root.properties.size > 0) {
    registerTable(root, rootName);
  } else {
    // Reserve the root section so nested tables cannot collide with its name,
    // then fill it in place. Arrays/objects register their children as a side
    // effect of `typeString`, and the reserved slot keeps the root section
    // ahead of them.
    const name = uniqueName(rootName);
    const slot = sections.length;
    sections.push('');
    let hint = name;
    if (root.kind === 'array') {
      const singular = singularize(name);
      hint = singular === name ? `${name}Item` : singular;
    }
    sections[slot] = `## ${name}\n\n${describeRoot(root, hint)}`;
  }

  return sections.join('\n\n');
}

// --- Public API --------------------------------------------------------------

/** Generate Markdown documentation from an already-parsed JSON value. */
export function generateMarkdownDocs(
  value: unknown,
  options: MarkdownOptions = {},
): string {
  return render(infer(value), options);
}

/**
 * Transform a JSON string into Markdown documentation tables.
 *
 * @throws {SyntaxError} if `json` is not valid JSON.
 */
export function jsonToMarkdown(
  json: string,
  options: MarkdownOptions = {},
): TransformResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(`Invalid JSON: ${(error as Error).message}`);
  }
  return {
    label: 'Markdown',
    code: generateMarkdownDocs(value, options),
  };
}
