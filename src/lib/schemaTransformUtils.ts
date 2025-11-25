/**
 * Common patterns and utilities for schema traversal and transformation algorithms.
 * Provides reusable building blocks for schema manipulation operations.
 */

import { refToName } from "./oasUtils.js";

// Dynamically require JSONPath to avoid top-level dependency changes in environments
let JSONPath: any | undefined = undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  JSONPath = require("jsonpath-plus").JSONPath;
} catch (e) {
  JSONPath = undefined;
}

/**
 * Callback for schema transformation during traversal.
 * Return true if schema was modified.
 */
export type SchemaTransformer = (node: any) => boolean;

/**
 * Predicate to filter schemas during traversal
 */
export type SchemaPredicate = (node: any) => boolean;

/**
 * Traverses all nodes in an OAS document recursively (depth-first).
 * Applies transformer callback to each node, counts modifications.
 *
 * @param node - Root node to traverse
 * @param transformer - Function called on each node, returns true if modified
 * @returns Number of nodes modified
 */
export function traverseAndTransform(node: any, transformer: SchemaTransformer): number {
  if (!node || typeof node !== "object") return 0;

  let modified = 0;

  if (transformer(node)) {
    modified++;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      modified += traverseAndTransform(item, transformer);
    }
  } else {
    for (const value of Object.values(node)) {
      modified += traverseAndTransform(value, transformer);
    }
  }

  return modified;
}

/**
 * Collects all schemas matching a predicate during traversal.
 *
 * @param node - Root node to traverse
 * @param predicate - Function to test each node
 * @returns Array of matching nodes
 */
export function collectMatching(node: any, predicate: SchemaPredicate): any[] {
  const results: any[] = [];

  function traverse(n: any) {
    if (!n || typeof n !== "object") return;

    if (predicate(n)) {
      results.push(n);
    }

    if (Array.isArray(n)) {
      for (const item of n) traverse(item);
    } else {
      for (const value of Object.values(n)) traverse(value);
    }
  }

  traverse(node);
  return results;
}

/**
 * Updates discriminator mappings in a schema node.
 * Removes mapping entries where the predicate returns false.
 *
 * @param node - Schema node with discriminator
 * @param keepPredicate - Returns true if mapping entry should be kept
 * @returns Number of mappings removed
 */
export function updateDiscriminatorMappings(
  node: any,
  keepPredicate: (key: string, ref: string) => boolean
): number {
  if (!node?.discriminator?.mapping || typeof node.discriminator.mapping !== "object") {
    return 0;
  }

  let removed = 0;
  const mapping = node.discriminator.mapping;

  for (const [key, ref] of Object.entries(mapping)) {
    if (typeof ref === "string" && !keepPredicate(key, ref)) {
      delete (mapping as any)[key];
      removed++;
    }
  }

  return removed;
}

/**
 * Filters a collection within a schema node by predicate.
 * Mutates the array in place.
 *
 * @param node - Schema node with collection property
 * @param propertyName - Name of array property (e.g., 'oneOf', 'anyOf')
 * @param keepPredicate - Returns true if item should be kept
 * @returns Number of items removed
 */
export function filterSchemaCollection(
  node: any,
  propertyName: string,
  keepPredicate: (item: any) => boolean
): number {
  if (!node || !Array.isArray(node[propertyName])) {
    return 0;
  }

  const before = node[propertyName].length;
  node[propertyName] = node[propertyName].filter(keepPredicate);
  return before - node[propertyName].length;
}

/**
 * Extracts schema name from a $ref string in a collection item.
 * Returns undefined if item is not a $ref or is invalid.
 *
 * @param item - Item from schema collection (e.g., from oneOf, anyOf)
 * @returns Schema name or undefined
 */
export function getRefFromCollectionItem(item: any): string | undefined {
  if (item && typeof item === "object" && typeof (item as any).$ref === "string") {
    return refToName((item as any).$ref);
  }
  return undefined;
}

/**
 * Removes items from a schema collection that reference specific schemas.
 * Also updates discriminator mappings for the removed schema names.
 *
 * @param node - Parent schema node
 * @param propertyName - Collection property name (e.g., 'oneOf')
 * @param schemaNames - Set of schema names to remove
 * @returns true if any modifications were made
 */
export function removeFromCollectionAndUpdateDiscriminator(
  node: any,
  propertyName: string,
  schemaNames: Set<string>
): boolean {
  let changed = false;

  // Remove from collection
  if (Array.isArray(node[propertyName])) {
    const before = node[propertyName].length;
    node[propertyName] = node[propertyName].filter((item: any) => {
      const refName = getRefFromCollectionItem(item);
      return !refName || !schemaNames.has(refName);
    });
    if (before !== node[propertyName].length) {
      changed = true;
    }
  }

  // Update discriminator mappings
  if (node.discriminator?.mapping && typeof node.discriminator.mapping === "object") {
    const mapping = node.discriminator.mapping;
    for (const schemaName of schemaNames) {
      for (const [key, ref] of Object.entries(mapping)) {
        const refName = refToName(ref as string);
        if (refName === schemaName) {
          delete (mapping as any)[key];
          changed = true;
        }
      }
    }
  }

  return changed;
}

/**
 * Clones a schema object with all its nested properties.
 *
 * @param schema - Schema to clone
 * @returns Deep clone of schema
 */
export function cloneSchema<T extends any>(schema: T): T {
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(cloneSchema) as any;
  }

  const clone: any = {};
  for (const [key, value] of Object.entries(schema)) {
    clone[key] = cloneSchema(value);
  }
  return clone;
}

/**
 * Gets all schemas that reference a given schema name via $ref.
 *
 * @param schemas - Map of schemas
 * @param targetName - Name of schema to find references to
 * @returns Set of schema names that reference the target
 */
export function getSchemaReferencers(schemas: Record<string, any>, targetName: string): Set<string> {
  const targetRef = `#/components/schemas/${targetName}`;
  const referencers = new Set<string>();

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== "object") continue;

    let hasRef = false;

    if (JSONPath) {
      try {
        // Query all $ref values under this schema and check for the targetRef
        const path = `$.components.schemas.${schemaName}..$ref`;
        const refs = JSONPath({ path, json: { components: { schemas } }, resultType: "value" }) as any[];
        hasRef = Array.isArray(refs) && refs.includes(targetRef);
      } catch (e) {
        hasRef = false;
      }
    }

    if (!hasRef) {
      // Fallback to original traversal-based detection
      const found = collectMatching(schema, (node: any) => {
        return (
          node &&
          typeof node === "object" &&
          ((node as any).$ref === targetRef || (Array.isArray(node) && node.some((item: any) => item?.$ref === targetRef)))
        );
      }).length > 0;
      hasRef = found;
    }

    if (hasRef) referencers.add(schemaName);
  }

  return referencers;
}
