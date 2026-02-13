import { JSONPath } from 'jsonpath-plus';
import { refToName } from './oasUtils.js';
import { traverseAndTransform } from './schemaTransformUtils.js';

const COMPOSITION_KEYWORDS = ['allOf', 'anyOf', 'oneOf'] as const;

/** Keywords that prevent removal even in aggressive mode */
const PRESERVE_KEYWORDS = ['properties'] as const;

export interface RemoveSingleCompositionOptions {
  /**
   * When true, also removes single-composition schemas that have additional
   * keywords (e.g. `description`, `discriminator`) alongside the composition keyword,
   * unless one of the extra keywords is `properties`.
   *
   * @default false
   */
  aggressive?: boolean;
}

/**
 * Checks if a schema is a single-composition wrapper: a schema whose only content
 * is one composition keyword (allOf/anyOf/oneOf) containing exactly one $ref entry.
 *
 * In aggressive mode, schemas with extra keywords (like `description` or `discriminator`)
 * are also considered removable, unless one of the extra keywords is `properties`.
 *
 * @returns The target $ref string, or undefined if not a single-composition schema
 */
function getSingleCompositionTarget(schema: any, aggressive: boolean = false): string | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;

  const keys = Object.keys(schema);
  if (keys.length === 0) return undefined;

  const keyword = keys.find(k => (COMPOSITION_KEYWORDS as readonly string[]).includes(k));
  if (!keyword) return undefined;

  const otherKeys = keys.filter(k => k !== keyword);
  if (otherKeys.length > 0) {
    if (!aggressive) return undefined;
    if (otherKeys.some(k => (PRESERVE_KEYWORDS as readonly string[]).includes(k))) return undefined;
  }

  const arr = schema[keyword];
  if (!Array.isArray(arr) || arr.length !== 1) return undefined;

  const item = arr[0];
  if (item && typeof item === 'object' && typeof item.$ref === 'string') {
    return item.$ref;
  }

  return undefined;
}

/**
 * Resolves transitive chains in the replacement map.
 * If Foo→Bar and Bar→Baz, resolves Foo→Baz.
 */
function resolveTransitiveChains(replacements: Map<string, string>): void {
  for (const [from, to] of replacements) {
    let resolved = to;
    const visited = new Set<string>([from]);
    while (replacements.has(resolved) && !visited.has(resolved)) {
      visited.add(resolved);
      resolved = replacements.get(resolved)!;
    }
    if (resolved !== to) {
      replacements.set(from, resolved);
    }
  }
}

/**
 * Remove single-composition schemas from an OpenAPI document.
 *
 * A single-composition schema is one whose only content is a single composition keyword
 * (allOf, anyOf, or oneOf) with exactly one $ref entry. Such schemas add indirection
 * without semantic value and can be replaced by their target reference.
 *
 * Mutates the document in place and returns removal statistics.
 */
export function removeSingleComposition(doc: any, options?: RemoveSingleCompositionOptions): {
  schemasRemoved: number;
  removed: string[];
} {
  if (!doc || typeof doc !== 'object') return { schemasRemoved: 0, removed: [] };

  const aggressive = Boolean(options?.aggressive);
  const schemas = doc.components?.schemas;
  if (!schemas || typeof schemas !== 'object') return { schemasRemoved: 0, removed: [] };

  // Step 1: Identify single-composition schemas and build replacement map
  const replacements = new Map<string, string>(); // full ref → full ref
  for (const [name, schema] of Object.entries(schemas)) {
    const targetRef = getSingleCompositionTarget(schema, aggressive);
    if (targetRef) {
      const fromRef = `#/components/schemas/${name}`;
      replacements.set(fromRef, targetRef);
    }
  }

  if (replacements.size === 0) return { schemasRemoved: 0, removed: [] };

  // Step 2: Resolve transitive chains
  resolveTransitiveChains(replacements);

  // Step 3: Replace all $ref occurrences throughout the document
  traverseAndTransform(doc, (node: any) => {
    if (node && typeof node === 'object' && typeof node.$ref === 'string') {
      const replacement = replacements.get(node.$ref);
      if (replacement) {
        node.$ref = replacement;
        return true;
      }
    }
    return false;
  });

  // Step 4: Update discriminator mappings
  for (const schema of Object.values(schemas)) {
    if (!schema || typeof schema !== 'object') continue;
    const mapping = (schema as any).discriminator?.mapping;
    if (!mapping || typeof mapping !== 'object') continue;
    for (const [key, ref] of Object.entries(mapping)) {
      if (typeof ref === 'string' && replacements.has(ref)) {
        mapping[key] = replacements.get(ref);
      }
    }
  }

  // Step 5: Delete the removed schemas
  const removed: string[] = [];
  for (const fromRef of replacements.keys()) {
    const name = refToName(fromRef);
    if (name && schemas[name]) {
      delete schemas[name];
      removed.push(name);
    }
  }

  return { schemasRemoved: removed.length, removed };
}
