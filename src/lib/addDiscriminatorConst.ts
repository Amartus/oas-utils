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
  DiscriminatorMappingTarget,
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

function resolveConstruct(
  doc: Record<string, unknown>,
  mode: ConstMode,
  forceUplift: boolean,
  result: AddDiscriminatorConstResult,
  onWarning?: (message: string) => void
): Construct {
  const oldVersion = getOpenApiVersion(doc);

  if ((mode === 'adapt' || forceUplift) && mode !== 'enum') {
    const oldVersion = getOpenApiVersion(doc);
    upgradeToOas31(doc);
    const newVersion = getOpenApiVersion(doc);
    if (oldVersion !== newVersion) {
      result.versionUpgraded = true;
    }
  }

  const version = getOpenApiVersion(doc);
  const supportsConst = Boolean(version?.match(/^3\.1\./));

  if (mode === 'enum') {
    return 'enum';
  }

  if (mode === 'adapt') {
    return 'const';
  }

  if (mode === 'auto') {
    return supportsConst ? 'const' : 'enum';
  }

  if (supportsConst) {
    return 'const';
  }

  if (oldVersion && !forceUplift) {
    onWarning?.(`mode='const' requested for OpenAPI ${oldVersion}; using enum because const is only emitted for OpenAPI 3.1.x unless forceUplift is enabled.`);
  }

  return 'enum';
}

function groupDiscriminatorMapping(mapping: Record<string, string>): DiscriminatorMappingTarget[] {
  const grouped = new Map<string, string[]>();

  for (const [discriminatorValue, ref] of Object.entries(mapping)) {
    if (typeof ref !== 'string') {
      continue;
    }

    const values = grouped.get(ref) ?? [];
    values.push(discriminatorValue);
    grouped.set(ref, values);
  }

  return [...grouped.entries()].map(([ref, values]) => ({
    ref,
    values: [...new Set(values)],
  }));
}

/**
 * Resolve the JSON Schema `type` of a discriminator property from the parent schema.
 *
 * Checks:
 * 1. `schema.properties[propertyName].type`
 * 2. Each `allOf` member of the schema for the same
 */
function resolveDiscriminatorPropertyType(
  schema: Record<string, unknown>,
  propertyName: string
): string | undefined {
  // Check direct properties
  if (isValidObject(schema.properties)) {
    const propSchema = schema.properties[propertyName];
    if (isValidObject(propSchema) && typeof propSchema.type === 'string') {
      return propSchema.type;
    }
  }

  // Check allOf members
  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      if (!isValidObject(member) || !isValidObject(member.properties)) continue;
      const propSchema = member.properties[propertyName];
      if (isValidObject(propSchema) && typeof propSchema.type === 'string') {
        return propSchema.type;
      }
    }
  }

  return undefined;
}

function createDiscriminatorContext(
  schemas: Record<string, unknown>,
  schema: Record<string, unknown>,
  propertyName: string,
  mapping: Record<string, string>,
  mappingTargets: DiscriminatorMappingTarget[],
  construct: Construct,
  compatibilityMode: boolean,
  result: AddDiscriminatorConstResult
): DiscriminatorContext {
  return {
    schemas,
    schema,
    propertyName,
    discriminatorPropertyType: resolveDiscriminatorPropertyType(schema, propertyName),
    mapping,
    mappingTargets,
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
 * - Groups discriminator values by target $ref
 * - Skips if the child already has the constraint
 * - Adds one constraint fragment per target branch or child schema
 * 
 * Mode behavior:
 * - 'auto' (default): examines doc.openapi version; OAS 3.0.x → enum, OAS 3.1.x → const
 * - 'const': emit const only on OAS 3.1.x; otherwise fall back to enum unless `forceUplift` is enabled
 * - 'enum': explicitly use enum
 * - 'adapt': use const and upgrade doc.openapi to 3.1.0 (no-op if already ≥ 3.1)
 * - multi-value mappings always use enum, regardless of mode
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
  const forceUplift = opts.forceUplift ?? false;
  const construct = resolveConstruct(doc as Record<string, unknown>, mode, forceUplift, result, opts.onWarning);

  // Process schemas with oneOf + discriminator.mapping
  for (const [, schema] of Object.entries(schemas)) {
    if (!isValidObject(schema)) continue;

    // Only target schemas with oneOf + discriminator.mapping
    if (!Array.isArray(schema.oneOf) || !isValidObject(schema.discriminator)) continue;

    const discriminator = schema.discriminator as Record<string, unknown>;
    const propertyName = discriminator.propertyName as string;
    const mapping = discriminator.mapping as Record<string, string>;
    
    if (!propertyName || !isValidObject(mapping)) continue;

    const mappingTargets = groupDiscriminatorMapping(mapping);
    if (mappingTargets.length === 0) continue;

    const ctx = createDiscriminatorContext(
      schemas,
      schema,
      propertyName,
      mapping,
      mappingTargets,
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
