import { JSONPath } from 'jsonpath-plus';
import { refToName } from './oasUtils.js';

export interface RemoveDanglingOptions {
  /** If true, remove external refs (not just components) */
  aggressive?: boolean;
}

/**
 * Remove dangling $ref entries that point to non-existent component schemas.
 * Mutates the document and returns number of removed references.
 */
export function removeDanglingRefs(doc: any, opts: RemoveDanglingOptions = {}): { removed: number } {
  if (!doc || typeof doc !== 'object') return { removed: 0 };

  const refs = JSONPath({ path: '$..$ref', json: doc, resultType: 'all' }) as any[];
  if (!Array.isArray(refs)) return { removed: 0 };

  const schemas = doc.components?.schemas ?? {};
  const existing = new Set(Object.keys(schemas));

  let removed = 0;

  // Build set of dangling ref strings. By default only refs that point to component schemas
  // are considered; with aggressive=true we also treat external / non-components refs as dangling.
  const allRefValues = JSONPath({ path: '$..$ref', json: doc, resultType: 'value' }) as string[];
  const danglingRefs = new Set<string>();
  for (const refStr of allRefValues ?? []) {
    const name = refToName(refStr);
    if (name) {
      if (!existing.has(name)) danglingRefs.add(refStr);
    } else if (opts.aggressive) {
      // treat non-local refs as dangling in aggressive mode
      danglingRefs.add(refStr);
    }
  }

  if (danglingRefs.size === 0) return { removed: 0 };

  // Recursive traversal to remove nodes whose $ref points to a dangling ref
  const walk = (parent: any, key: any, node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string' && danglingRefs.has(node.$ref)) {
      if (Array.isArray(parent)) {
        parent.splice(key, 1);
      } else if (parent && typeof parent === 'object') {
        delete parent[key];
      }
      removed++;
      return;
    }
    if (Array.isArray(node)) {
      // iterate backwards when removing
      for (let i = node.length - 1; i >= 0; i--) walk(node, i, node[i]);
    } else {
      for (const k of Object.keys(node)) walk(node, k, node[k]);
      // If after removals the object becomes empty, caller may choose to prune, but keep for safety
    }
  };

  walk(undefined as any, undefined as any, doc);

  return { removed };
}
