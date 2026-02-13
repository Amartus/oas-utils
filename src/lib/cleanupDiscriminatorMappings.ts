import { refToName } from "./oasUtils.js";
import { updateDiscriminatorMappings } from "./schemaTransformUtils.js";

export interface CleanupDiscriminatorOptions {
  /**
   * Patterns for schema names where discriminators should be removed entirely.
   * Supports glob-style patterns with wildcards (*).
   * Example: ["*_RES", "*Response"] will remove discriminators from schemas ending with _RES or Response
   */
  removeDiscriminatorPatterns?: string[];
}

/**
 * Cleans up discriminator mappings by removing entries that point to non-existent schemas.
 *
 * This function:
 * 1. Iterates through all schemas looking for discriminator definitions
 * 2. For each discriminator mapping entry, checks if the referenced schema exists
 * 3. Removes mapping entries that reference undefined schemas
 * 4. Optionally removes entire discriminators from schemas matching specified patterns
 * 5. Returns count of cleaned mappings for reporting
 *
 * @param doc - OpenAPI document to clean
 * @param options - Configuration options for discriminator cleanup
 * @returns Object with cleanup statistics
 */
export function cleanupDiscriminatorMappings(doc: any, options?: CleanupDiscriminatorOptions): {
  schemasChecked: number;
  mappingsRemoved: number;
  discriminatorsRemoved: number;
  details: Array<{ schema: string; removed: string[] }>;
  removedDiscriminators: string[];
} {
  if (!doc || typeof doc !== "object") {
    return { schemasChecked: 0, mappingsRemoved: 0, discriminatorsRemoved: 0, details: [], removedDiscriminators: [] };
  }

  const schemas: Record<string, any> | undefined = doc.components?.schemas;
  if (!schemas || typeof schemas !== "object") {
    return { schemasChecked: 0, mappingsRemoved: 0, discriminatorsRemoved: 0, details: [], removedDiscriminators: [] };
  }

  // Helper function to match schema name against glob-style patterns
  const matchesPattern = (schemaName: string, patterns: string[]): boolean => {
    return patterns.some(pattern => {
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
        .replace(/\*/g, '.*'); // Convert * to .*
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(schemaName);
    });
  };

  // Collect all existing schema names for validation
  const existingSchemas = new Set<string>(Object.keys(schemas));

  let totalMappingsRemoved = 0;
  let schemasChecked = 0;
  let discriminatorsRemoved = 0;
  const details: Array<{ schema: string; removed: string[] }> = [];
  const removedDiscriminators: string[] = [];

  // Iterate through all schemas
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== "object") continue;

    // Check if schema has discriminator
    if (schema.discriminator && typeof schema.discriminator === "object") {
      // Check if discriminator should be removed based on patterns
      if (options?.removeDiscriminatorPatterns && 
          options.removeDiscriminatorPatterns.length > 0 &&
          matchesPattern(schemaName, options.removeDiscriminatorPatterns)) {
        delete schema.discriminator;
        discriminatorsRemoved++;
        removedDiscriminators.push(schemaName);
        continue; // Skip to next schema since discriminator is removed
      }

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
    discriminatorsRemoved,
    details,
    removedDiscriminators,
  };
}
