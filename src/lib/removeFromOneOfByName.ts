import { refToName } from "./oasUtils.js";
import { removeFromCollectionAndUpdateDiscriminator, traverseAndTransform } from "./schemaTransformUtils.js";

/**
 * Remove a schema from all oneOfs in the OAS and update discriminator mappings globally.
 * @param doc OpenAPI document
 * @param removeName Name of the schema to remove from all oneOfs
 * @returns Number of schemas modified
 */
export function removeFromOneOfGlobally(doc: any, removeName: string): number {
  const schemaNames = new Set([removeName]);
  let modified = 0;

  const transformer = (node: any): boolean => {
    return removeFromCollectionAndUpdateDiscriminator(node, "oneOf", schemaNames);
  };

  modified = traverseAndTransform(doc, transformer);
  return modified;
}

/**
 * Remove a schema from oneOf by name and update discriminator mappings.
 * @param doc OpenAPI document
 * @param parentSchemaName Name of the parent schema containing oneOf
 * @param removeName Name of the schema to remove from oneOf
 * @returns true if schema was removed
 */
export function removeFromOneOfByName(doc: any, parentSchemaName: string, removeName: string): boolean {
  if (!doc?.components?.schemas) return false;

  const parentSchema = doc.components.schemas[parentSchemaName];
  if (!parentSchema) return false;

  return removeFromCollectionAndUpdateDiscriminator(parentSchema, "oneOf", new Set([removeName]));
}


