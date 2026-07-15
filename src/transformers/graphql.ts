// JSON → GraphQL Schema Definition Language (SDL) generator.
//
// Infers a type model from an arbitrary JSON value (see `./infer`) and renders
// it as GraphQL `type` definitions. Nested objects are hoisted into their own
// named types and referenced by name — parents emitted before children — the
// same way the TypeScript, Zod, and OpenAPI transformers hoist nested shapes.
//
// GraphQL's type system is narrower than JSON's, so a few mappings are worth
// calling out:
//   * JSON numbers become `Float`. JSON does not distinguish integers from
//     floating-point numbers, so `Float` is the safe, lossless choice.
//   * A required, non-nullable field is marked non-null with a trailing `!`;
//     optional keys and values that are sometimes `null` stay nullable.
//   * Shapes GraphQL cannot express as an object type — an empty object, an
//     `unknown`/mixed value, or a union of dissimilar scalars — fall back to a
//     custom `scalar JSON`, declared once at the top when it is used.

import type { TransformResult } from '../types';
import { type ObjectNode, type TypeNode, type UnionNode, infer } from './infer';
import { camelCase, pascalCase, singularize } from './naming';

export interface GraphQLOptions {
  /** Name for the root type. Defaults to `"Root"`. */
  rootName?: string;
}

/** Custom scalar used for values GraphQL's type system cannot describe. */
const JSON_SCALAR = 'JSON';

/** GraphQL name grammar: a letter or underscore, then word characters. */
const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;

/** The GraphQL type reference for a node, plus whether the value may be null. */
interface GqlType {
  /** Type reference, e.g. `String`, `[User!]`, or `JSON` (no trailing `!`). */
  ref: string;
  /** Whether the value itself may be null, which suppresses a non-null `!`. */
  nullable: boolean;
}

/** Render a field name, sanitizing keys that are not valid GraphQL names. */
function fieldName(key: string): string {
  if (GRAPHQL_NAME.test(key)) {
    return key;
  }
  // GraphQL, unlike JSON/TS, cannot quote a field name — coerce it to a valid
  // identifier, prefixing `_` when the camelCased form is empty or digit-led.
  const camel = camelCase(key);
  return GRAPHQL_NAME.test(camel) ? camel : `_${camel || 'field'}`;
}

/** Derive the element type name for a top-level array from its root name. */
function arrayItemHint(name: string): string {
  const singular = singularize(name);
  return singular === name ? `${name}Item` : singular;
}

// --- Rendering ---------------------------------------------------------------

function render(root: TypeNode, options: GraphQLOptions): string {
  const rootName = pascalCase(options.rootName ?? 'Root') || 'Root';
  const types: string[] = [];
  const used = new Set<string>();
  let usesJson = false;

  function uniqueName(base: string): string {
    const name = base || 'Type';
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

  function jsonType(nullable: boolean): GqlType {
    usesJson = true;
    return { ref: JSON_SCALAR, nullable };
  }

  // Hoist an object into its own named type and return that name. The slot is
  // reserved before building fields so parents are emitted ahead of children.
  function registerType(node: ObjectNode, hint: string): string {
    const name = uniqueName(pascalCase(hint) || 'Type');
    const slot = types.length;
    types.push('');
    const lines: string[] = [];
    for (const [key, prop] of node.properties) {
      const { ref, nullable } = typeRef(prop.type, key);
      const nonNull = !prop.optional && !nullable;
      lines.push(`  ${fieldName(key)}: ${ref}${nonNull ? '!' : ''}`);
    }
    types[slot] = `type ${name} {\n${lines.join('\n')}\n}`;
    return name;
  }

  function scalarRef(name: string): GqlType {
    switch (name) {
      case 'string':
        return { ref: 'String', nullable: false };
      case 'number':
        return { ref: 'Float', nullable: false };
      case 'boolean':
        return { ref: 'Boolean', nullable: false };
      default:
        // `null` and `unknown` have no scalar — use the permissive JSON scalar.
        return jsonType(true);
    }
  }

  function unionRef(node: UnionNode, hint: string): GqlType {
    const isNull = (t: TypeNode) => t.kind === 'primitive' && t.name === 'null';
    const hasNull = node.types.some(isNull);
    const nonNull = node.types.filter((t) => !isNull(t));

    if (nonNull.length === 0) {
      return jsonType(true);
    }
    if (nonNull.length === 1) {
      // A single non-null arm plus `null` is just that arm, made nullable.
      const inner = typeRef(nonNull[0], hint);
      return { ref: inner.ref, nullable: inner.nullable || hasNull };
    }
    // Dissimilar members (e.g. `string | number`) have no GraphQL equivalent —
    // fall back to the permissive JSON scalar, nullable only if `null` appeared.
    return jsonType(hasNull);
  }

  function typeRef(node: TypeNode, hint: string): GqlType {
    switch (node.kind) {
      case 'primitive':
        return scalarRef(node.name);
      case 'object':
        if (node.properties.size === 0) {
          // An object with no observed keys accepts arbitrary properties.
          return jsonType(false);
        }
        return { ref: registerType(node, hint), nullable: false };
      case 'array': {
        const item = typeRef(node.element, singularize(hint));
        const inner = item.nullable ? item.ref : `${item.ref}!`;
        return { ref: `[${inner}]`, nullable: false };
      }
      case 'union':
        return unionRef(node, hint);
      default:
        return jsonType(true);
    }
  }

  if (root.kind === 'object' && root.properties.size > 0) {
    registerType(root, rootName);
  } else if (
    root.kind === 'array' &&
    root.element.kind === 'object' &&
    root.element.properties.size > 0
  ) {
    // A top-level array of records: emit the element type. GraphQL has no way to
    // name a bare list, so the element type is the useful, nameable output.
    registerType(root.element, arrayItemHint(rootName));
  } else {
    // Anything else (a bare scalar, an array of scalars, an empty object) is
    // wrapped in a single-field container so the output is always valid SDL.
    const name = uniqueName(rootName);
    const slot = types.length;
    types.push('');
    const { ref, nullable } = typeRef(root, arrayItemHint(rootName));
    types[slot] = `type ${name} {\n  value: ${ref}${nullable ? '' : '!'}\n}`;
  }

  const body = types.join('\n\n');
  return usesJson ? `scalar ${JSON_SCALAR}\n\n${body}` : body;
}

// --- Public API --------------------------------------------------------------

/** Generate GraphQL SDL type definitions from an already-parsed JSON value. */
export function generateGraphQLTypes(
  value: unknown,
  options: GraphQLOptions = {},
): string {
  return render(infer(value), options);
}

/**
 * Transform a JSON string into GraphQL SDL type definitions.
 *
 * @throws {SyntaxError} if `json` is not valid JSON.
 */
export function jsonToGraphql(
  json: string,
  options: GraphQLOptions = {},
): TransformResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(`Invalid JSON: ${(error as Error).message}`);
  }
  return {
    label: 'GraphQL',
    code: generateGraphQLTypes(value, options),
  };
}
