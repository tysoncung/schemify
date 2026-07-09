// JSON → Zod schema generator.
//
// Infers a type model from an arbitrary JSON value (see `./infer`) and renders
// it as a set of named Zod schema declarations. Nested objects are extracted
// into their own `z.object(...)` consts — emitted children-first so every
// reference is declared before it is used — and the model's arrays, unions,
// nullable values, and optional properties map onto `z.array`, `z.union`,
// `.nullable()`, and `.optional()` respectively.

import type { TransformResult } from '../types';
import { type ObjectNode, type TypeNode, infer } from './infer';
import { camelCase, formatKey, singularize } from './naming';

export interface ZodOptions {
  /** Name used to derive the root schema const. Defaults to `"Root"`. */
  rootName?: string;
  /** Prefix declarations with the `export` keyword. Defaults to `true`. */
  export?: boolean;
}

/** The `import { z } from 'zod';` line prepended to a full transform result. */
const ZOD_IMPORT = "import { z } from 'zod';";

// --- Rendering ---------------------------------------------------------------

function schemaConstName(hint: string): string {
  const base = camelCase(hint) || 'anonymous';
  return `${base}Schema`;
}

function render(root: TypeNode, options: ZodOptions): string {
  const rootName = options.rootName ?? 'Root';
  const exportKeyword = options.export === false ? '' : 'export ';
  const declarations: string[] = [];
  const used = new Set<string>();

  function uniqueName(base: string): string {
    const name = base || 'anonymousSchema';
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

  // Emit an object as its own const and return the const's name. Property
  // expressions are built first so any nested schemas land in `declarations`
  // ahead of this one (Zod consts must be defined before they are referenced).
  function registerSchema(node: ObjectNode, hint: string): string {
    const lines: string[] = [];
    for (const [key, prop] of node.properties) {
      let expr = schemaExpr(prop.type, key);
      if (prop.optional) {
        expr = `${expr}.optional()`;
      }
      lines.push(`  ${formatKey(key)}: ${expr},`);
    }
    const name = uniqueName(schemaConstName(hint));
    const body = lines.length > 0 ? `\n${lines.join('\n')}\n` : '';
    declarations.push(`${exportKeyword}const ${name} = z.object({${body}});`);
    return name;
  }

  function primitiveExpr(name: string): string {
    switch (name) {
      case 'string':
        return 'z.string()';
      case 'number':
        return 'z.number()';
      case 'boolean':
        return 'z.boolean()';
      case 'null':
        return 'z.null()';
      default:
        return 'z.unknown()';
    }
  }

  function schemaExpr(node: TypeNode, hint: string): string {
    switch (node.kind) {
      case 'primitive':
        return primitiveExpr(node.name);
      case 'object':
        if (node.properties.size === 0) {
          return 'z.record(z.string(), z.unknown())';
        }
        return registerSchema(node, hint);
      case 'array':
        return `z.array(${schemaExpr(node.element, singularize(hint))})`;
      case 'union': {
        // A `null` member becomes a trailing `.nullable()` on the rest of the
        // union rather than a `z.null()` arm, matching idiomatic Zod.
        const nonNull = node.types.filter(
          (type) => !(type.kind === 'primitive' && type.name === 'null'),
        );
        const hasNull = nonNull.length !== node.types.length;

        if (nonNull.length === 0) {
          return primitiveExpr('null');
        }
        const parts = [
          ...new Set(nonNull.map((type) => schemaExpr(type, hint))),
        ];
        const inner =
          parts.length === 1 ? parts[0] : `z.union([${parts.join(', ')}])`;
        return hasNull ? `${inner}.nullable()` : inner;
      }
      default:
        return 'z.unknown()';
    }
  }

  if (root.kind === 'object' && root.properties.size > 0) {
    registerSchema(root, rootName);
  } else {
    // Reserve the root const name so nested schemas cannot collide with it,
    // then emit it last once its children have been declared.
    const rootConst = uniqueName(schemaConstName(rootName));
    let hint = rootName;
    if (root.kind === 'array') {
      const singular = singularize(rootName);
      hint = singular === rootName ? `${rootName}Item` : singular;
    }
    const expr = schemaExpr(root, hint);
    declarations.push(`${exportKeyword}const ${rootConst} = ${expr};`);
  }

  return declarations.join('\n\n');
}

// --- Public API --------------------------------------------------------------

/**
 * Generate Zod schema declarations from an already-parsed JSON value.
 *
 * Returns only the `const` declarations — use {@link jsonToZod} for output that
 * also includes the `import { z } from 'zod';` statement.
 */
export function generateZodSchema(
  value: unknown,
  options: ZodOptions = {},
): string {
  return render(infer(value), options);
}

/**
 * Transform a JSON string into a self-contained Zod schema module, including
 * the `zod` import.
 *
 * @throws {SyntaxError} if `json` is not valid JSON.
 */
export function jsonToZod(
  json: string,
  options: ZodOptions = {},
): TransformResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(`Invalid JSON: ${(error as Error).message}`);
  }
  return {
    label: 'Zod',
    code: `${ZOD_IMPORT}\n\n${generateZodSchema(value, options)}`,
  };
}
