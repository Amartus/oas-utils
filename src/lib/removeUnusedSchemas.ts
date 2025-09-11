import { OpenAPI } from "openapi-types";

export type OASDoc = OpenAPI.Document;

export interface RemoveOptions {
  /** If true, also remove unused parameters, responses, headers, requestBodies, etc. */
  aggressive?: boolean;
  /** Keep schemas by name regardless of usage */
  keep?: string[];
  /** Ignore these schemas as allOf parents (do not promote children via these) */
  ignoreParents?: string[];
}


import { refToName } from './oasUtils.js';

/**
 * Remove unused components.schemas from an OpenAPI document (for CLI command).
 * Mutates and returns the same object for convenience.
 */
export function removeUnusedSchemas(doc: any, opts: RemoveOptions = {}): any {
  if (!doc || typeof doc !== "object") return doc;
  const keepSet = new Set((opts.keep ?? []).map((s) => String(s)));

  const schemas: Record<string, any> | undefined = doc.components?.schemas;
  if (!schemas || typeof schemas !== "object") return doc;


  // 1) Collect $ref targets starting ONLY from the paths section
  // Follow $ref to non-schema components to discover schemas nested within them.
  const used = new Set<string>();
  const queue: string[] = [];
  const visitedComponents = new Set<string>(); // key: section:name
  const usedComponents = new Map<string, Set<string>>(); // section -> names

  const markUsedComponent = (section: string, name: string) => {
    if (!usedComponents.has(section)) usedComponents.set(section, new Set());
    usedComponents.get(section)!.add(name);
  };

  const visitCollectFromPaths = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visitCollectFromPaths);
    if (typeof (node as any).$ref === "string") {
      const refStr = (node as any).$ref as string;
      const n = refToName(refStr);
      if (n && !used.has(n)) {
        used.add(n);
        queue.push(n);
      } else {
        // Resolve other components references like #/components/requestBodies/Name
        const m = refStr.match(/^#\/components\/([^\/]+)\/([^#\/]+)$/);
        if (m) {
          const section = m[1];
          const name = decodeURIComponent(m[2]);
          const key = section + ":" + name;
          if (!visitedComponents.has(key)) {
            visitedComponents.add(key);
            markUsedComponent(section, name);
            const target = doc?.components?.[section]?.[name];
            if (target) visitCollectFromPaths(target);
          }
        }
      }
    }
    for (const k of Object.keys(node)) visitCollectFromPaths((node as any)[k]);
  };

  if (doc.paths) visitCollectFromPaths(doc.paths);

  // 2) Follow transitive references among schemas (downward closure via $ref in schema bodies)

  const collectRefsInSchema = (schema: any, add: (name: string) => void) => {
    if (!schema || typeof schema !== "object") return;
    if (Array.isArray(schema)) return schema.forEach((x) => collectRefsInSchema(x, add));
    if (typeof (schema as any).$ref === "string") {
      const maybe = refToName((schema as any).$ref);
      if (maybe) add(maybe);
    }
    for (const k of Object.keys(schema)) collectRefsInSchema((schema as any)[k], add);
  };

  while (queue.length) {
    const name = queue.pop()!;
    const schema = schemas[name];
    if (!schema) continue;
    collectRefsInSchema(schema, (n) => {
      if (!used.has(n)) {
        used.add(n);
        queue.push(n);
      }
    });
  }

  // 3) Special rule: if a schema has an allOf that references any used schema, it is also considered used.
  // Implement as an upward closure using a reverse map from base->composers. Find allOf anywhere inside the schema.
  const reverseAllOf = new Map<string, Set<string>>();
  const collectAllOfRefs = (node: any, add: (refName: string) => void) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node))
      return node.forEach((x) => collectAllOfRefs(x, add));
    if (Array.isArray((node as any).allOf)) {
      for (const part of (node as any).allOf as any[]) {
        if (
          part &&
          typeof part === "object" &&
          typeof (part as any).$ref === "string"
        ) {
          const base = refToName((part as any).$ref);
          if (base) add(base);
        }
      }
    }
    for (const k of Object.keys(node)) collectAllOfRefs((node as any)[k], add);
  };

  for (const [name, schema] of Object.entries(schemas)) {
    collectAllOfRefs(schema, (base) => {
      if (!reverseAllOf.has(base)) reverseAllOf.set(base, new Set());
      reverseAllOf.get(base)!.add(name);
    });
  }

  // Only promote via allOf if the "parent" is already referenced (in used set)
  const ignoreParentsSet = new Set((opts.ignoreParents ?? []).map(String));
  const upQueue: string[] = Array.from(used);
  const promoted = new Set<string>();
  while (upQueue.length) {
    const base = upQueue.pop()!;
    if (!used.has(base)) continue; // Only promote if parent is referenced
    if (ignoreParentsSet.has(base)) continue; // Do not promote children via ignored parents
    const parents = reverseAllOf.get(base);
    if (!parents) continue;
    for (const parent of parents) {
      if (!used.has(parent)) {
        used.add(parent);
        promoted.add(parent);
        upQueue.push(parent);
      }
    }
  }

  // After promoting via allOf, include their transitive refs as well.
  const queue2: string[] = Array.from(promoted);
  while (queue2.length) {
    const name = queue2.pop()!;
    const schema = schemas[name];
    if (!schema) continue;
    collectRefsInSchema(schema, (n) => {
      if (!used.has(n)) {
        used.add(n);
        queue2.push(n);
      }
    });
  }

  // 4) Remove unused schemas unless explicitly kept
  for (const name of Object.keys(schemas)) {
    if (keepSet.has(name)) continue;
    if (!used.has(name)) delete schemas[name];
  }

  if (opts.aggressive && doc.components) {
    pruneUnusedComponents(doc, usedComponents);
  }

  return doc;
}

function pruneUnusedComponents(
  doc: any,
  usedComponents?: Map<string, Set<string>>
) {
  const c = doc.components ?? {};
  const sections = [
    "parameters",
    "responses",
    "headers",
    "requestBodies",
    "examples",
    "links",
    "callbacks",
    "securitySchemes",
  ];

  if (usedComponents) {
    for (const section of sections) {
      const map = c[section];
      if (!map || typeof map !== "object") continue;
      const usedSet = usedComponents.get(section) ?? new Set<string>();
      for (const name of Object.keys(map)) {
        if (!usedSet.has(name)) delete map[name];
      }
      if (Object.keys(map).length === 0) delete c[section];
    }
  }

  // Finally, delete empty components object
  if (Object.keys(c).length === 0) delete doc.components;
}
