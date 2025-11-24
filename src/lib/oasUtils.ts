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

/**
 * Extracts the OpenAPI version from a document.
 * 
 * @param doc - The OpenAPI document
 * @returns The OpenAPI version string (e.g., "3.0.0", "3.1.0") or undefined
 */
export function getOpenApiVersion(doc: any): string | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  if (typeof doc.openapi === "string") return doc.openapi;
  if (typeof doc.swagger === "string") return doc.swagger;
  return undefined;
}

/**
 * Extracts the JSON Schema version from a document or schema.
 * 
 * @param doc - The JSON Schema document
 * @returns The JSON Schema version URI or undefined
 */
export function getJsonSchemaVersion(doc: any): string | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  if (typeof doc.$schema === "string") return doc.$schema;
  return undefined;
}

/**
 * Checks if a JSON Schema version supports unevaluatedProperties.
 * unevaluatedProperties is supported in draft 2019-09 and later.
 * 
 * @param schemaVersion - The $schema URI (e.g., "http://json-schema.org/draft-07/schema#")
 * @returns true if unevaluatedProperties is supported
 */
export function supportsUnevaluatedProperties(schemaVersion: string): boolean {
  if (!schemaVersion) return false;
  
  // Check for 2019-09, 2020-12, or later drafts
  if (schemaVersion.includes("2019-09") || 
      schemaVersion.includes("2020-12") ||
      schemaVersion.includes("/next/")) {
    return true;
  }
  
  // Draft-07 and earlier don't support unevaluatedProperties
  // We explicitly return false for these versions
  return false;
}

/**
 * Checks if an OpenAPI version supports unevaluatedProperties.
 * unevaluatedProperties is supported in OpenAPI 3.1 and later.
 * 
 * @param oasVersion - The OpenAPI version (e.g., "3.0.0", "3.1.0")
 * @returns true if unevaluatedProperties is supported
 */
export function oasSupportsUnevaluatedProperties(oasVersion: string): boolean {
  if (!oasVersion) return false;
  
  // Parse version
  const versionMatch = oasVersion.match(/^(\d+)\.(\d+)/);
  if (!versionMatch) return false;
  
  const major = parseInt(versionMatch[1], 10);
  const minor = parseInt(versionMatch[2], 10);
  
  // OpenAPI 3.1+ supports unevaluatedProperties (uses JSON Schema 2020-12)
  if (major === 3 && minor >= 1) return true;
  if (major > 3) return true;
  
  return false;
}

/**
 * Checks if a document (OpenAPI or JSON Schema) supports unevaluatedProperties.
 * 
 * @param doc - The document to check
 * @returns true if unevaluatedProperties is supported
 */
export function documentSupportsUnevaluatedProperties(doc: any): boolean {
  if (!doc || typeof doc !== "object") return false;
  
  // Check for OpenAPI version
  const oasVersion = getOpenApiVersion(doc);
  if (oasVersion) {
    return oasSupportsUnevaluatedProperties(oasVersion);
  }
  
  // Check for JSON Schema version
  const schemaVersion = getJsonSchemaVersion(doc);
  if (schemaVersion) {
    return supportsUnevaluatedProperties(schemaVersion);
  }
  
  // If no version specified, assume it doesn't support unevaluatedProperties
  return false;
}

/**
 * Upgrades the OpenAPI version to 3.1.0 to support unevaluatedProperties.
 * 
 * @param doc - The OpenAPI document to upgrade
 * @returns The upgraded document
 */
export function upgradeToOas31(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  
  // Only upgrade if it's OpenAPI 3.0.x
  const currentVersion = getOpenApiVersion(doc);
  if (!currentVersion || !currentVersion.match(/^3\.0\./)) {
    return doc;
  }
  
  // Upgrade to 3.1.0
  doc.openapi = "3.1.0";
  
  return doc;
}

/**
 * Upgrades the JSON Schema version to draft 2020-12 to support unevaluatedProperties.
 * 
 * @param doc - The JSON Schema document to upgrade
 * @returns The upgraded document
 */
export function upgradeJsonSchemaToDraft202012(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  
  // Set $schema to draft 2020-12
  doc.$schema = "https://json-schema.org/draft/2020-12/schema";
  
  return doc;
}
