import { refToName } from "./oasUtils.js";

// Dynamically require JSONPath for optional, per-schema value queries
let JSONPath: any | undefined = undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  JSONPath = require("jsonpath-plus").JSONPath;
} catch (e) {
  JSONPath = undefined;
}

/**
 * Optimize allOf composition globally across an OpenAPI document.
 *
 * Rule: within any schema S that has an allOf array containing $ref items, if one referenced
 * schema (e.g., A) is already included transitively via another referenced schema (e.g., B
 * where B.allOf includes A, possibly via deeper chains), then the direct reference to A in S.allOf
 * is redundant and can be removed.
 *
 * Only $ref entries inside top-level allOf arrays of components.schemas are considered for removal.
 * Inline constraints in allOf are preserved.
 */
export function optimizeAllOfComposition(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  const schemas: Record<string, any> | undefined = doc.components?.schemas;
  if (!schemas || typeof schemas !== "object") return doc;

  // Build direct allOf graph: name -> Set<direct base names>
  const directAllOf = new Map<string, Set<string>>();

  const getDirectAllOf = (name: string): Set<string> => {
    if (directAllOf.has(name)) return directAllOf.get(name)!;
    const bases = new Set<string>();
    const schema = schemas[name];
    // Try JSONPath per-schema to get allOf $ref values
    if (JSONPath) {
      try {
        const path = `$.components.schemas.${name}.allOf[*].$ref`;
        const refs = JSONPath({ path, json: { components: { schemas } }, resultType: "value" }) as any[];
        if (Array.isArray(refs)) {
          for (const r of refs) {
            if (typeof r === "string") {
              const base = refToName(r);
              if (base) bases.add(base);
            }
          }
        }
      } catch (e) {
        // fall back to manual traversal below
      }
    }

    if (bases.size === 0 && schema) {
      const allOf = schema?.allOf;
      if (Array.isArray(allOf)) {
        for (const part of allOf) {
          if (part && typeof part === "object" && typeof (part as any).$ref === "string") {
            const base = refToName((part as any).$ref);
            if (base) bases.add(base);
          }
        }
      }
    }
    directAllOf.set(name, bases);
    return bases;
  };

  // Compute transitive closure for a schema name using DFS with memoization.
  const transitiveMemo = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const getTransitiveAllOf = (name: string): Set<string> => {
    if (transitiveMemo.has(name)) return transitiveMemo.get(name)!;
    if (visiting.has(name)) return new Set(); // break cycles
    visiting.add(name);
    const acc = new Set<string>();
    for (const base of getDirectAllOf(name)) {
      if (!acc.has(base)) acc.add(base);
      // Merge base's transitive
      const t = getTransitiveAllOf(base);
      for (const x of t) acc.add(x);
    }
    visiting.delete(name);
    transitiveMemo.set(name, acc);
    return acc;
  };

  // For each schema with allOf, drop redundant $ref items
  for (const [name, schema] of Object.entries(schemas)) {
    const allOf = (schema as any)?.allOf;
    if (!Array.isArray(allOf)) continue;

    // Collect indices of $ref parts and their names
    const refItems: Array<{ idx: number; name: string }> = [];
    for (let i = 0; i < allOf.length; i++) {
      const part = allOf[i];
      if (part && typeof part === "object" && typeof (part as any).$ref === "string") {
        const base = refToName((part as any).$ref);
        if (base) refItems.push({ idx: i, name: base });
      }
    }
    if (refItems.length < 2) continue; // nothing to optimize

    const toDrop = new Set<number>();
    // For each pair (A,B) among refs in this allOf, if B transitively includes A, drop A.
    for (let i = 0; i < refItems.length; i++) {
      const a = refItems[i];
      for (let j = 0; j < refItems.length; j++) {
        if (i === j) continue;
        const b = refItems[j];
        // Check if b includes a transitively
        const trans = getTransitiveAllOf(b.name);
        if (trans.has(a.name)) {
          toDrop.add(a.idx);
        }
      }
    }

    if (toDrop.size > 0) {
      (schema as any).allOf = allOf.filter((_, idx) => !toDrop.has(idx));
    }
  }

  return doc;
}
