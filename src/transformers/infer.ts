// Shared JSON → type-model inference used by Schemify transformers.
//
// Walks an arbitrary parsed JSON value and produces a normalized `TypeNode`
// tree: primitives, arrays, objects, and unions. Distinct shapes seen at the
// same position (e.g. across the elements of an array) are merged, and keys
// that are absent from some objects in an array are marked optional. Each
// transformer (TypeScript, Zod, …) renders this shared model in its own syntax.

export type TypeNode = PrimitiveNode | ArrayNode | ObjectNode | UnionNode;

export interface PrimitiveNode {
  kind: 'primitive';
  name: 'string' | 'number' | 'boolean' | 'null' | 'unknown';
}

export interface ArrayNode {
  kind: 'array';
  element: TypeNode;
}

export interface ObjectNode {
  kind: 'object';
  properties: Map<string, PropertyNode>;
}

export interface UnionNode {
  kind: 'union';
  types: TypeNode[];
}

export interface PropertyNode {
  type: TypeNode;
  optional: boolean;
}

/** Infer a `TypeNode` from an already-parsed JSON value. */
export function infer(value: unknown): TypeNode {
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
export function mergeMany(nodes: TypeNode[]): TypeNode {
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
