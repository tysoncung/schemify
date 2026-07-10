// JSON → OpenAPI 3.1 schema generator.
//
// Infers a type model from an arbitrary JSON value (see `./infer`) and renders
// it as OpenAPI 3.1 Schema Objects, wrapped in a `components.schemas` document
// fragment. Nested objects are extracted into their own named component schemas
// and referenced with `$ref: '#/components/schemas/…'`, mirroring how the
// TypeScript and Zod transformers hoist nested objects into named declarations.
//
// OpenAPI 3.1 aligns its Schema Object with JSON Schema 2020-12, so this output
// uses `type: 'null'`, type-array unions (`type: ['string', 'null']`), and
// `anyOf` for unions of dissimilar shapes rather than the 3.0-era `nullable`.

import type { TransformResult } from '../types';
import {
  type ObjectNode,
  type PrimitiveNode,
  type TypeNode,
  type UnionNode,
  infer,
} from './infer';
import { pascalCase, singularize } from './naming';

export interface OpenApiOptions {
  /** Name for the root schema component. Defaults to `"Root"`. */
  rootName?: string;
}

/** A JSON-serializable OpenAPI Schema Object (or `$ref` wrapper). */
type SchemaObject = Record<string, unknown>;

// --- Rendering ---------------------------------------------------------------

function render(root: TypeNode, options: OpenApiOptions): string {
  const rootName = pascalCase(options.rootName ?? 'Root') || 'Root';
  const schemas: Record<string, SchemaObject> = {};
  const used = new Set<string>();

  function uniqueName(base: string): string {
    const name = base || 'Schema';
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

  // Hoist an object into its own named component schema and return that name.
  // The slot is reserved up front (before building properties) so parents are
  // emitted ahead of the children they reference.
  function registerSchema(node: ObjectNode, hint: string): string {
    const name = uniqueName(pascalCase(hint) || 'Schema');
    schemas[name] = {};
    schemas[name] = buildObject(node);
    return name;
  }

  function buildObject(node: ObjectNode): SchemaObject {
    const properties: Record<string, SchemaObject> = {};
    const required: string[] = [];
    for (const [key, prop] of node.properties) {
      properties[key] = schemaFor(prop.type, key);
      if (!prop.optional) {
        required.push(key);
      }
    }
    const result: SchemaObject = { type: 'object', properties };
    if (required.length > 0) {
      result.required = required;
    }
    return result;
  }

  function primitiveSchema(name: PrimitiveNode['name']): SchemaObject {
    switch (name) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'null':
        return { type: 'null' };
      default:
        // `unknown` maps to the empty schema, which permits any value.
        return {};
    }
  }

  function unionSchema(node: UnionNode, hint: string): SchemaObject {
    const isNull = (t: TypeNode) => t.kind === 'primitive' && t.name === 'null';
    const hasNull = node.types.some(isNull);
    const nonNull = node.types.filter((t) => !isNull(t));

    if (nonNull.length === 0) {
      return { type: 'null' };
    }

    // A union of only primitives collapses to a JSON Schema type array
    // (e.g. `type: ['string', 'number', 'null']`).
    if (nonNull.every((t): t is PrimitiveNode => t.kind === 'primitive')) {
      const names = nonNull.map((t) => t.name);
      // An `unknown` arm makes the whole union permissive — emit the any schema.
      if (names.includes('unknown')) {
        return {};
      }
      const types = [...new Set(hasNull ? [...names, 'null'] : names)];
      return { type: types.length === 1 ? types[0] : types };
    }

    // Otherwise the members differ in shape — fall back to `anyOf`, with a
    // `null` arm appended when the value is nullable.
    const members = nonNull.map((t) => schemaFor(t, hint));
    if (hasNull) {
      members.push({ type: 'null' });
    }
    return { anyOf: members };
  }

  function schemaFor(node: TypeNode, hint: string): SchemaObject {
    switch (node.kind) {
      case 'primitive':
        return primitiveSchema(node.name);
      case 'object':
        if (node.properties.size === 0) {
          // An object with no observed keys accepts arbitrary properties.
          return { type: 'object', additionalProperties: true };
        }
        return { $ref: `#/components/schemas/${registerSchema(node, hint)}` };
      case 'array':
        return {
          type: 'array',
          items: schemaFor(node.element, singularize(hint)),
        };
      case 'union':
        return unionSchema(node, hint);
      default:
        return {};
    }
  }

  if (root.kind === 'object' && root.properties.size > 0) {
    registerSchema(root, rootName);
  } else {
    // Reserve the root name so nested schemas cannot collide with it, then
    // build it in place (arrays/objects register their children as a side
    // effect of `schemaFor`).
    const name = uniqueName(rootName);
    schemas[name] = {};
    let hint = rootName;
    if (root.kind === 'array') {
      const singular = singularize(rootName);
      hint = singular === rootName ? `${rootName}Item` : singular;
    }
    schemas[name] = schemaFor(root, hint);
  }

  return JSON.stringify({ components: { schemas } }, null, 2);
}

// --- Public API --------------------------------------------------------------

/**
 * Generate an OpenAPI 3.1 `components.schemas` document from an already-parsed
 * JSON value, returned as pretty-printed JSON.
 */
export function generateOpenApiSchema(
  value: unknown,
  options: OpenApiOptions = {},
): string {
  return render(infer(value), options);
}

/**
 * Transform a JSON string into an OpenAPI 3.1 schema-components document.
 *
 * @throws {SyntaxError} if `json` is not valid JSON.
 */
export function jsonToOpenApi(
  json: string,
  options: OpenApiOptions = {},
): TransformResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(`Invalid JSON: ${(error as Error).message}`);
  }
  return {
    label: 'OpenAPI',
    code: generateOpenApiSchema(value, options),
  };
}
