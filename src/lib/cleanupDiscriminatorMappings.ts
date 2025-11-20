import { refToName } from "./oasUtils.js";
import { updateDiscriminatorMappings } from "./schemaTransformUtils.js";

/**
 * Cleans up discriminator mappings by removing entries that point to non-existent schemas.
 *
 * This function:
 * 1. Iterates through all schemas looking for discriminator definitions
 * 2. For each discriminator mapping entry, checks if the referenced schema exists
 * 3. Removes mapping entries that reference undefined schemas
 * 4. Returns count of cleaned mappings for reporting
 *
 * @param doc - OpenAPI document to clean
 * @returns Object with cleanup statistics
 */
export function cleanupDiscriminatorMappings(doc: any): {
  schemasChecked: number;
  mappingsRemoved: number;
  details: Array<{ schema: string; removed: string[] }>;
} {
  if (!doc || typeof doc !== "object") {
    return { schemasChecked: 0, mappingsRemoved: 0, details: [] };
  }

  const schemas: Record<string, any> | undefined = doc.components?.schemas;
  if (!schemas || typeof schemas !== "object") {
    return { schemasChecked: 0, mappingsRemoved: 0, details: [] };
  }

  // Collect all existing schema names for validation
  const existingSchemas = new Set<string>(Object.keys(schemas));

  let totalMappingsRemoved = 0;
  let schemasChecked = 0;
  const details: Array<{ schema: string; removed: string[] }> = [];

  // Iterate through all schemas
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== "object") continue;

    // Check if schema has discriminator with mapping
    if (schema.discriminator && typeof schema.discriminator === "object") {
      const discriminator = schema.discriminator;

      if (discriminator.mapping && typeof discriminator.mapping === "object") {
        schemasChecked++;
        const removedMappings: string[] = [];

        // Update discriminator mappings, removing invalid references
        const removed = updateDiscriminatorMappings(schema, (key: string, ref: string) => {
          const referencedSchemaName = refToName(ref);
          // Keep this mapping only if the referenced schema exists
          const shouldKeep = !referencedSchemaName || existingSchemas.has(referencedSchemaName);
          if (!shouldKeep) {
            removedMappings.push(key);
          }
          return shouldKeep;
        });

        totalMappingsRemoved += removed;

        if (removedMappings.length > 0) {
          details.push({
            schema: schemaName,
            removed: removedMappings,
          });
        }
      }
    }
  }

  return {
    schemasChecked,
    mappingsRemoved: totalMappingsRemoved,
    details,
  };
}
