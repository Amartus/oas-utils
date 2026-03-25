/**
 * Add const/enum constraints to oneOf children based on discriminator mappings.
 * 
 * This module provides both a standalone CLI action and shared helpers
 * used by allOfToOneOfJsonPath.ts for the allOf→oneOf discriminator patterns.
 */

import { refToName, getOpenApiVersion, upgradeToOas31 } from './oasUtils.js';

// Type definitions

export type Construct = 'const' | 'enum';

export type ConstMode = 'auto' | 'const' | 'enum' | 'adapt';

export interface AddDiscriminatorConstOptions {
  /**
   * Mode for selecting the constraint construct.
   * - 'auto' (default): OAS 3.0.x → const, OAS 3.1.x → enum
   * - 'const': always use { const: value }
   * - 'enum': always use { enum: [value] }
   * - 'adapt': use const and upgrade OAS 3.0.x → 3.1.0
   */
  mode?: ConstMode;
  
  /** Optional callback to receive warnings during transformation. */
  onWarning?: (message: string) => void;
}

export interface AddDiscriminatorConstResult {
  /** Number of schemas with one or more children updated */
  schemasUpdated: number;
  
  /** Total number of discriminator children that received const/enum constraints */
  constAdded: number;
  
  /** Whether OAS version was upgraded (only when mode='adapt') */
  versionUpgraded: boolean;
}

// Type guards

const isValidObject = (obj: unknown): obj is Record<string, unknown> =>
  obj !== null && typeof obj === 'object' && !Array.isArray(obj);

const isSchemaReference = (obj: unknown): obj is { $ref: string } =>
  isValidObject(obj) && typeof obj.$ref === 'string';

// Shared helper functions (used by both addDiscriminatorConst and allOfToOneOfJsonPath)

/**
 * Create a schema constraint fragment with const or enum.
 * Used by both addDiscriminatorConst and allOfToOneOfJsonPath.
 * 
 * @param propName - The discriminator property name
 * @param value - The discriminator value
 * @param construct - 'const' or 'enum'
 * @returns A schema object with the constraint
 */
export function createConstConstraint(
  propName: string,
  value: string,
  construct: Construct = 'const'
): Record<string, unknown> {
  if (construct === 'enum') {
    return {
      type: 'object',
      properties: { [propName]: { enum: [value] } }
    };
  }
  // 'const'
  return {
    type: 'object',
    properties: { [propName]: { const: value } }
  };
}

/**
 * Check if a schema already has a const or enum constraint for a property/value.
 * Used by both addDiscriminatorConst and allOfToOneOfJsonPath.
 * 
 * @param schema - The schema to check
 * @param propName - The discriminator property name
 * @param value - The discriminator value to check for
 * @returns true if constraint already exists
 */
export function hasConstOrEnumConstraint(
  schema: Record<string, unknown>,
  propName: string,
  value: string
): boolean {
  if (!isValidObject(schema) || !Array.isArray(schema.allOf)) {
    return false;
  }

  return (schema.allOf as unknown[]).some(item => {
    if (!isValidObject(item) || !isValidObject(item.properties)) {
      return false;
    }
    
    const propSchema = item.properties[propName];
    if (!isValidObject(propSchema)) {
      return false;
    }

    // Check for const
    if (propSchema.const === value) {
      return true;
    }

    // Check for enum
    if (Array.isArray(propSchema.enum) && propSchema.enum.includes(value)) {
      return true;
    }

    return false;
  });
}

// Main function

/**
 * Add const/enum constraints to oneOf children based on discriminator mappings.
 * 
 * Targets schemas with oneOf + discriminator.mapping. For each mapped child:
 * - Resolves the child schema name from the $ref
 * - Gets the discriminator value from the mapping key
 * - Skips if the child already has the constraint
 * - Adds constraint to child's allOf array (creates if needed)
 * 
 * Mode behavior:
 * - 'auto' (default): examines doc.openapi version; OAS 3.0.x → const, 3.1.x → enum
 * - 'const' or 'enum': explicitly use that construct
 * - 'adapt': use const and upgrade doc.openapi to 3.1.0 (no-op if already ≥ 3.1)
 * 
 * @param doc - The OpenAPI document (will be modified in-place)
 * @param opts - Optional configuration
 * @returns Result summary
 */
export function addDiscriminatorConst(
  doc: any,
  opts: AddDiscriminatorConstOptions = {}
): AddDiscriminatorConstResult {
  const result: AddDiscriminatorConstResult = {
    schemasUpdated: 0,
    constAdded: 0,
    versionUpgraded: false,
  };

  if (!isValidObject(doc) || !isValidObject(doc.components) || !isValidObject(doc.components.schemas)) {
    return result;
  }

  const schemas = doc.components.schemas as Record<string, unknown>;
  const mode: ConstMode = opts.mode ?? 'auto';

  // Determine the construct to use
  let construct: Construct = 'const';
  
  if (mode === 'auto') {
    const version = getOpenApiVersion(doc);
    if (version && version.match(/^3\.1\./)) {
      construct = 'enum';
    } else {
      construct = 'const';
    }
  } else if (mode === 'const') {
    construct = 'const';
  } else if (mode === 'enum') {
    construct = 'enum';
  } else if (mode === 'adapt') {
    construct = 'const';
    // Upgrade version if needed
    const oldVersion = getOpenApiVersion(doc);
    upgradeToOas31(doc);
    const newVersion = getOpenApiVersion(doc);
    if (oldVersion !== newVersion) {
      result.versionUpgraded = true;
    }
  }

  // Process schemas with oneOf + discriminator.mapping
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!isValidObject(schema)) continue;
    
    // Only target schemas with oneOf + discriminator.mapping
    if (!Array.isArray(schema.oneOf) || !isValidObject(schema.discriminator)) continue;

    const discriminator = schema.discriminator as Record<string, unknown>;
    const propertyName = discriminator.propertyName as string;
    const mapping = discriminator.mapping as Record<string, string>;
    
    if (!propertyName || !isValidObject(mapping)) continue;

    let schemaUpdated = false;

    // For each mapped child, add constraint if not already present
    for (const [discriminatorValue, ref] of Object.entries(mapping)) {
      const childName = refToName(ref);
      if (!childName) continue;

      const childSchema = schemas[childName];
      if (!isValidObject(childSchema)) continue;

      // Skip if already has the constraint
      if (hasConstOrEnumConstraint(childSchema, propertyName, discriminatorValue)) {
        continue;
      }

      // Add constraint to child's allOf
      if (!Array.isArray(childSchema.allOf)) {
        childSchema.allOf = [];
      }

      const allOf = childSchema.allOf as unknown[];
      const constraint = createConstConstraint(propertyName, discriminatorValue, construct);
      allOf.push(constraint);

      schemaUpdated = true;
      result.constAdded++;
    }

    if (schemaUpdated) {
      result.schemasUpdated++;
    }
  }

  return result;
}
