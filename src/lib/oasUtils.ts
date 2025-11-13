// Common OpenAPI schema utilities

/**
 * Helper to extract a components/schemas ref name from a $ref string.
 */
export function refToName(ref: string): string | undefined {
  const m = ref.match(/^#\/(?:components\/)?schemas\/([^#/]+)$/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/**
 * Builds an inheritance/composition graph from OpenAPI schemas.
 * 
 * Returns a Map where:
 * - Key: schema name (parent type)
 * - Value: Set of schema names that extend/compose this parent via allOf
 * 
 * @param schemas - The components.schemas object from an OpenAPI document
 * @returns Map<string, Set<string>> - Parent schema to child schemas mapping
 */
export function buildInheritanceGraph(schemas: Record<string, any>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  if (!schemas || typeof schemas !== "object") {
    return graph;
  }

  // Iterate through all schemas
  for (const [childName, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== "object") continue;

    // Look for allOf references in this schema
    if (Array.isArray(schema.allOf)) {
      for (const item of schema.allOf) {
        if (item && typeof item === "object" && typeof (item as any).$ref === "string") {
          const parentName = refToName((item as any).$ref);
          if (parentName) {
            // Add this child to the parent's set
            if (!graph.has(parentName)) {
              graph.set(parentName, new Set());
            }
            graph.get(parentName)!.add(childName);
          }
        }
      }
    }
  }

  return graph;
}

/**
 * Gets all descendants (direct and transitive) of a schema in the inheritance graph.
 * 
 * @param parentName - The schema name to find descendants for
 * @param graph - The inheritance graph from buildInheritanceGraph()
 * @returns Set<string> - All descendant schema names
 */
export function getDescendants(parentName: string, graph: Map<string, Set<string>>): Set<string> {
  const descendants = new Set<string>();
  const queue = [parentName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = graph.get(current);

    if (children) {
      for (const child of children) {
        if (!descendants.has(child)) {
          descendants.add(child);
          queue.push(child);
        }
      }
    }
  }

  return descendants;
}

/**
 * Gets all ancestors (direct and transitive) of a schema in the inheritance hierarchy.
 * 
 * @param childName - The schema name to find ancestors for
 * @param schemas - The components.schemas object from an OpenAPI document
 * @returns Set<string> - All ancestor schema names
 */
export function getAncestors(childName: string, schemas: Record<string, any>): Set<string> {
  const ancestors = new Set<string>();
  const queue = [childName];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const schema = schemas[current];
    if (!schema || typeof schema !== "object" || !Array.isArray(schema.allOf)) continue;

    for (const item of schema.allOf) {
      if (item && typeof item === "object" && typeof (item as any).$ref === "string") {
        const parentName = refToName((item as any).$ref);
        if (parentName && !ancestors.has(parentName)) {
          ancestors.add(parentName);
          queue.push(parentName);
        }
      }
    }
  }

  return ancestors;
}
