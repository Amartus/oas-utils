/**
 * Add const/enum constraints to oneOf children based on discriminator mappings.
 *
 * This module provides both a standalone CLI action and shared helpers
 * used by allOfToOneOfJsonPath.ts for the allOf→oneOf discriminator patterns.
 */

import { getOpenApiVersion, upgradeToOas31 } from './oasUtils.js';
import { addConstraintsToOneOfBranches } from './addDiscriminatorConst.oneOfBranchesStrategy.js';
import { addConstraintsToChildren } from './addDiscriminatorConst.childrenStrategy.js';
import { createConstConstraint, hasConstOrEnumConstraint, type Construct } from './discriminatorConstraintUtils.js';
import type {
  AddDiscriminatorConstOptions,
  AddDiscriminatorConstResult,
  ConstMode,
  ConstPlacement,
  DiscriminatorContext,
} from './addDiscriminatorConst.types.js';

export type {
  AddDiscriminatorConstOptions,
  AddDiscriminatorConstResult,
  ConstMode,
  ConstPlacement,
  Construct,
};

export { createConstConstraint, hasConstOrEnumConstraint };

// Type guards

const isValidObject = (obj: unknown): obj is Record<string, unknown> =>
  obj !== null && typeof obj === 'object' && !Array.isArray(obj);

function resolveConstruct(doc: Record<string, unknown>, mode: ConstMode, result: AddDiscriminatorConstResult): Construct {
  if (mode === 'auto') {
    const version = getOpenApiVersion(doc);
    return version && version.match(/^3\.1\./) ? 'enum' : 'const';
  }

  if (mode === 'enum') {
    return 'enum';
  }

  if (mode === 'adapt') {
    const oldVersion = getOpenApiVersion(doc);
    upgradeToOas31(doc);
    const newVersion = getOpenApiVersion(doc);
    if (oldVersion !== newVersion) {
      result.versionUpgraded = true;
    }
  }

  return 'const';
}

function createDiscriminatorContext(
  schemas: Record<string, unknown>,
  schema: Record<string, unknown>,
  propertyName: string,
  mapping: Record<string, string>,
  construct: Construct,
  compatibilityMode: boolean,
  result: AddDiscriminatorConstResult
): DiscriminatorContext {
  return {
    schemas,
    schema,
    propertyName,
    mapping,
    construct,
    compatibilityMode,
    result,
  };
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
  const placement: ConstPlacement = opts.placement ?? 'oneOf-branches';
  const compatibilityMode = opts.compatibilityMode ?? false;
  const construct = resolveConstruct(doc as Record<string, unknown>, mode, result);

  // Process schemas with oneOf + discriminator.mapping
  for (const [, schema] of Object.entries(schemas)) {
    if (!isValidObject(schema)) continue;

    // Only target schemas with oneOf + discriminator.mapping
    if (!Array.isArray(schema.oneOf) || !isValidObject(schema.discriminator)) continue;

    const discriminator = schema.discriminator as Record<string, unknown>;
    const propertyName = discriminator.propertyName as string;
    const mapping = discriminator.mapping as Record<string, string>;
    
    if (!propertyName || !isValidObject(mapping)) continue;

    const ctx = createDiscriminatorContext(
      schemas,
      schema,
      propertyName,
      mapping,
      construct,
      compatibilityMode,
      result
    );

    const schemaUpdated = placement === 'children'
      ? addConstraintsToChildren(ctx)
      : addConstraintsToOneOfBranches(ctx);

    if (schemaUpdated) {
      result.schemasUpdated++;
    }
  }

  return result;
}
