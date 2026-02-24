import { JSONPath } from 'jsonpath-plus';
import { refToName, buildInheritanceGraph, getAncestors } from './oasUtils.js';

export interface InlineSchemaOptions {
  /** The composition keyword to target (default: 'allOf') */
  combiner?: 'allOf' | 'oneOf' | 'anyOf';
  /** If true, inline transitively (chain mode) */
  chain?: boolean;
  /** If true, warn when inlined schema is in discriminator mapping */
  warnDiscriminator?: boolean;
  /** Optional callback for discriminator warnings */
  onDiscriminatorWarning?: (params: {
    schemaName: string;
    parentName: string;
    discriminatorProperty: string;
  }) => void;
}

export interface InlineSchemaResult {
  /** Number of inlining operations performed */
  inlined: number;
  /** Schemas that were inlined */
  inlinedSchemas: string[];
  /** Schemas affected by inlining */
  affectedSchemas: string[];
  /** Discriminator warnings encountered */
  discriminatorWarnings: Array<{
    schemaName: string;
    parentName: string;
    discriminatorProperty: string;
  }>;
}

/**
 * Inline a schema by replacing $ref to it with its body content.
 * 
 * If A has allOf: [B, ...] and B has allOf: [C, ...], inlining B means:
 * - Regular mode: A gets the body of B with C still as $ref
 * - Chain mode: First inline C into B, then inline B into A
 * 
 * @param doc - OpenAPI document to modify
 * @param schemaName - Name of the schema to inline
 * @param options - Inlining options
 * @returns Result with counts and affected schemas
 */
export function inlineSchema(
  doc: any,
  schemaName: string,
  options: InlineSchemaOptions = {}
): InlineSchemaResult {
  const combiner = options.combiner || 'allOf';
  const chain = options.chain || false;
  const warnDiscriminator = options.warnDiscriminator !== false;

  const result: InlineSchemaResult = {
    inlined: 0,
    inlinedSchemas: [],
    affectedSchemas: [],
    discriminatorWarnings: [],
  };

  if (!doc || typeof doc !== 'object') return result;
  const schemas: Record<string, any> | undefined = doc.components?.schemas;
  if (!schemas || typeof schemas !== 'object') return result;

  const targetSchema = schemas[schemaName];
  if (!targetSchema || typeof targetSchema !== 'object') {
    return result;
  }

  // Check for discriminator usage
  if (warnDiscriminator) {
    checkDiscriminatorUsage(doc, schemaName, result, options.onDiscriminatorWarning);
  }

  // If chain mode, inline transitively first
  if (chain) {
    inlineTransitively(doc, schemaName, combiner);
  }

  // Find all schemas that reference the target schema via the specified combiner
  const affected = findReferencingSchemas(schemas, schemaName, combiner);

  for (const parentName of affected) {
    const parentSchema = schemas[parentName];
    const compositions = parentSchema[combiner];
    
    if (!Array.isArray(compositions)) continue;

    let replacements = 0;
    parentSchema[combiner] = compositions.flatMap((item: any) => {
      if (
        item &&
        typeof item === 'object' &&
        item.$ref === `#/components/schemas/${schemaName}`
      ) {
        replacements++;
        return inlineSchemaBody(targetSchema, combiner);
      }
      return [item];
    });

    if (replacements > 0) {
      result.inlined += replacements;
      result.affectedSchemas.push(parentName);
      if (!result.inlinedSchemas.includes(schemaName)) {
        result.inlinedSchemas.push(schemaName);
      }
    }
  }

  return result;
}

/**
 * Batch inline: inline a schema in all places where it's used via the combiner.
 * This is an alias for inlineSchema with the same behavior.
 */
export function batchInlineSchemas(
  doc: any,
  schemaNames: string[],
  options: InlineSchemaOptions = {}
): InlineSchemaResult {
  const aggregateResult: InlineSchemaResult = {
    inlined: 0,
    inlinedSchemas: [],
    affectedSchemas: [],
    discriminatorWarnings: [],
  };

  for (const schemaName of schemaNames) {
    const result = inlineSchema(doc, schemaName, options);
    aggregateResult.inlined += result.inlined;
    
    for (const s of result.inlinedSchemas) {
      if (!aggregateResult.inlinedSchemas.includes(s)) {
        aggregateResult.inlinedSchemas.push(s);
      }
    }
    
    for (const s of result.affectedSchemas) {
      if (!aggregateResult.affectedSchemas.includes(s)) {
        aggregateResult.affectedSchemas.push(s);
      }
    }
    
    aggregateResult.discriminatorWarnings.push(...result.discriminatorWarnings);
  }

  return aggregateResult;
}

/**
 * Inline schema body, expanding it into individual elements.
 * If the schema has the combiner keyword, return its elements.
 * Otherwise, return the schema as a single element.
 */
function inlineSchemaBody(schema: any, combiner: string): any[] {
  if (!schema || typeof schema !== 'object') return [];

  // If the schema has the same combiner, extract its elements
  if (Array.isArray(schema[combiner])) {
    return schema[combiner];
  }

  // Otherwise, return the schema itself (without the combiner)
  const schemaCopy = { ...schema };
  delete schemaCopy[combiner];
  return [schemaCopy];
}

/**
 * Find all schemas that reference the target schema via the specified combiner.
 * Uses the inheritance graph to efficiently find all children of the target schema.
 */
function findReferencingSchemas(
  schemas: Record<string, any>,
  targetName: string,
  combiner: 'allOf' | 'oneOf' | 'anyOf'
): string[] {
  const graph = buildInheritanceGraph(schemas, combiner);
  return Array.from(graph.get(targetName) || []);
}

/**
 * Expand a single schema's combiner array one level: replace each $ref item with
 * the body of the referenced schema.  Only $refs that resolve to a known schema
 * are expanded; unresolvable $refs are left untouched.
 */
function inlineSingleStep(
  schemas: Record<string, any>,
  schemaName: string,
  combiner: string
): void {
  const schema = schemas[schemaName];
  if (!schema || !Array.isArray(schema[combiner])) return;

  schema[combiner] = schema[combiner].flatMap((item: any) => {
    if (item && typeof item === 'object' && item.$ref) {
      const refName = refToName(item.$ref);
      if (refName && schemas[refName]) {
        return inlineSchemaBody(schemas[refName], combiner);
      }
    }
    return [item];
  });
}

/**
 * Inline transitively (chain mode): expand all ancestor schemas bottom-up so that
 * the target schema ends up fully flattened.
 *
 * getAncestors returns ancestors in BFS order (direct parents first).  Reversing
 * that gives bottom-up (deepest / most-foundational ancestors first), which
 * guarantees each schema is fully expanded before it is used to expand its parent.
 */
function inlineTransitively(
  doc: any,
  schemaName: string,
  combiner: 'allOf' | 'oneOf' | 'anyOf'
): void {
  const schemas = doc.components?.schemas;
  if (!schemas) return;

  // BFS order → reverse → deepest ancestors first
  const bottomUp = [...getAncestors(schemaName, schemas, combiner)].reverse();

  for (const ancestor of bottomUp) {
    inlineSingleStep(schemas, ancestor, combiner);
  }
  inlineSingleStep(schemas, schemaName, combiner);
}

/**
 * Check if the schema being inlined is referenced in any discriminator mappings.
 */
function checkDiscriminatorUsage(
  doc: any,
  schemaName: string,
  result: InlineSchemaResult,
  callback?: (params: {
    schemaName: string;
    parentName: string;
    discriminatorProperty: string;
  }) => void
): void {
  const schemas = doc.components?.schemas;
  if (!schemas) return;

  try {
    // Find all discriminators in schemas
    for (const [parentName, schema] of Object.entries(schemas)) {
      if (!schema || typeof schema !== 'object') continue;

      const discriminator = (schema as any).discriminator;
      if (!discriminator || typeof discriminator !== 'object') continue;

      const mapping = discriminator.mapping;
      if (!mapping || typeof mapping !== 'object') continue;

      const propertyName = discriminator.propertyName || 'type';

      // Check if this schema is in the mapping
      for (const [key, ref] of Object.entries(mapping)) {
        if (typeof ref !== 'string') continue;
        const refName = refToName(ref);
        if (refName === schemaName) {
          const warning = {
            schemaName,
            parentName,
            discriminatorProperty: propertyName,
          };

          result.discriminatorWarnings.push(warning);

          if (callback) {
            callback(warning);
          }
        }
      }
    }
  } catch (error) {
    // Ignore errors
  }
}
