import { JSONPath } from 'jsonpath-plus';
import { AllOfToOneOfOptions } from './allOfToOneOfInterface.js';
import { refToName, buildInheritanceGraph, getDescendants, getAncestors } from './oasUtils.js';

/**
 * Third implementation of allOfToOneOf using JSONPath library.
 * 
 * This implementation focuses on using JSONPath queries for:
 * - Finding all allOf relationships
 * - Locating references to schemas
 * - Replacing references throughout the document
 * 
 * Algorithm:
 * 1. Find discriminator parents (schemas with discriminator.mapping with >1 entry)
 * 2. Build inheritance graph using JSONPath to find allOf relationships
 * 3. For each discriminator parent:
 *    - Find all references using JSONPath
 *    - Check if referenced outside composition contexts
 *    - If yes, create polymorphic wrapper
 * 4. Rewire references using JSONPath
 * 5. Remove discriminators from parents
 * 6. Optionally add const constraints to children
 * 7. Handle nested hierarchies (chain wrappers)
 */

// Type definitions
interface SchemaReference {
  $ref: string;
}

interface DiscriminatorObject {
  propertyName: string;
  mapping: Record<string, string>;
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, unknown>;
  allOf?: Array<SchemaReference | SchemaObject>;
  oneOf?: Array<SchemaReference | SchemaObject>;
  anyOf?: Array<SchemaReference | SchemaObject>;
  discriminator?: Partial<DiscriminatorObject>;
  [key: string]: unknown;
}

interface ComponentsObject {
  schemas?: Record<string, SchemaObject>;
  requestBodies?: Record<string, unknown>;
  responses?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  callbacks?: Record<string, unknown>;
  links?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

interface OpenAPIDocument {
  openapi?: string;
  components?: ComponentsObject;
  paths?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
  [key: string]: unknown;
}

interface DiscriminatorInfo {
  propertyName: string;
  mapping: Record<string, string>;
}

interface WrapperInfo {
  wrapperName: string;
  childNames: string[];
}

interface JSONPathResult {
  path: string;
  value: unknown;
  parent: Record<string, unknown>;
  parentProperty: string;
}

interface ChildValidationResult {
  validChildren: string[];
  warnings: string[];
}

// Type guard helpers to reduce repetition
const isValidObject = (obj: unknown): obj is Record<string, unknown> =>
  obj !== null && typeof obj === 'object' && !Array.isArray(obj);

const hasDiscriminator = (schema: unknown): schema is SchemaObject & { discriminator: DiscriminatorObject } =>
  isValidObject(schema) &&
  isValidObject(schema.discriminator) &&
  typeof schema.discriminator.propertyName === 'string' &&
  isValidObject(schema.discriminator.mapping);

const isSchemaReference = (obj: unknown): obj is SchemaReference =>
  isValidObject(obj) && typeof obj.$ref === 'string';

/**
 * Find all schemas with discriminators.
 * Only consider schemas with >1 mapping entry (actual polymorphic schemas).
 * Exclude schemas that are already oneOf wrappers.
 */
function findDiscriminatorParents(schemas: Record<string, SchemaObject>): Map<string, DiscriminatorInfo> {
  const parents = new Map<string, DiscriminatorInfo>();

  if (!isValidObject(schemas)) return parents;

  for (const [name, schema] of Object.entries(schemas)) {
    // Skip invalid schemas or existing oneOf wrappers
    if (!hasDiscriminator(schema) || Array.isArray(schema.oneOf)) continue;

    const { propertyName, mapping } = schema.discriminator;
    const mappingKeys = Object.keys(mapping);

    // Include schemas with >1 mapping entry OR self-referencing single entry
    const isSelfReferencing = mappingKeys.length === 1 &&
      Object.values(mapping).some((ref) => refToName(ref) === name);

    if (mappingKeys.length > 1 || isSelfReferencing) {
      parents.set(name, { propertyName, mapping: { ...mapping } });
    }
  }

  return parents;
}

/**
 * Check if a schema is referenced outside of allOf contexts (inheritance).
 * References in oneOf/anyOf are considered polymorphic usage and should get wrappers.
 * Uses JSONPath to find all references and filters by context.
 */
function isReferencedOutsideComposition(
  schemaName: string,
  doc: OpenAPIDocument
): boolean {
  const schemaRef = `#/components/schemas/${schemaName}`;

  const allRefs = JSONPath({
    path: '$..$ref',
    json: doc,
    resultType: 'all'
  }) as JSONPathResult[];

  for (const refResult of allRefs) {
    if (refResult.value !== schemaRef) continue;

    const pathParts = refResult.path
      .replace(/\['/g, '.')
      .replace(/'\]/g, '')
      .replace(/\[/g, '.')
      .replace(/\]/g, '')
      .split('.')
      .filter(Boolean);

    let inAllOf = false;
    let inDiscriminatorMapping = false;

    for (let i = pathParts.length - 1; i >= 0; i--) {
      const part = pathParts[i];
      if (!inAllOf && part === 'allOf') inAllOf = true;
      if (!inDiscriminatorMapping && (part === 'discriminator' || part === 'mapping')) inDiscriminatorMapping = true;
      if (inAllOf && inDiscriminatorMapping) break;
    }

    // Skip if in allOf (pure inheritance) or in discriminator mapping (metadata)
    if (inAllOf || inDiscriminatorMapping) continue;

    return true;
  }

  return false;
}

/**
 * Validate and get children for a parent.
 * Returns valid inheriting children separately from all mapped children.
 */
function validateAndGetChildren(
  parentName: string,
  mapping: Record<string, string>,
  schemas: Record<string, SchemaObject>,
  inheritanceGraph: Map<string, Set<string>>
): ChildValidationResult {
  const validChildren: string[] = [];
  const warnings: string[] = [];
  const descendants = getDescendants(parentName, inheritanceGraph);

  for (const [discriminatorValue, ref] of Object.entries(mapping)) {
    const childName = refToName(ref);

    if (!childName) {
      warnings.push(`Invalid reference in discriminator mapping for "${parentName}": ${ref}`);
      continue;
    }

    if (!schemas[childName]) {
      warnings.push(`Schema "${childName}" referenced in "${parentName}" discriminator mapping does not exist`);
      continue;
    }

    // Check if child inherits from parent (including self-reference)
    const inheritsFromParent = descendants.has(childName) || childName === parentName;

    if (inheritsFromParent) {
      validChildren.push(childName);
    } else {
      warnings.push(
        `Schema "${childName}" in discriminator mapping does not inherit from "${parentName}". ` +
        `It will be kept in the mapping but not in oneOf.`
      );
    }
  }

  return { validChildren, warnings };
}

/**
 * Create polymorphic wrappers for parents that are referenced.
 * This is the new type that is oneOf of the valid children. The original parent schema is kept as-is (without discriminator)
 */
function isEligibleForWrapper(
  parentName: string,
  validChildren: string[],
  doc: OpenAPIDocument,
  opts: AllOfToOneOfOptions
): boolean {
  if (!isReferencedOutsideComposition(parentName, doc)) return false;
  if (validChildren.length === 0) return false;
  if (validChildren.length === 1 &&
    (opts.ignoreSingleSpecialization || validChildren[0] === parentName)) return false;
  return true;
}

function createPolymorphicWrappers(
  schemas: Record<string, SchemaObject>,
  discriminatorParents: Map<string, DiscriminatorInfo>,
  inheritanceGraph: Map<string, Set<string>>,
  doc: OpenAPIDocument,
  opts: AllOfToOneOfOptions
): Map<string, WrapperInfo> {
  const wrappers = new Map<string, WrapperInfo>();
  const allWarnings: string[] = [];

  // Pass 1: validate children and determine initial wrapper eligibility
  const schemasGettingWrappers = new Set<string>();
  const validatedParents = new Map<string, ChildValidationResult>();

  for (const [parentName, discInfo] of discriminatorParents.entries()) {
    const result = validateAndGetChildren(parentName, discInfo.mapping, schemas, inheritanceGraph);
    validatedParents.set(parentName, result);

    if (isEligibleForWrapper(parentName, result.validChildren, doc, opts)) {
      schemasGettingWrappers.add(parentName);
    }
  }

  // Pass 2: create wrappers for eligible parents.
  // Re-check eligibility for initially-ineligible schemas since prior wrapper
  // creation may add new $refs that make them referenced outside composition.
  for (const [parentName, discInfo] of discriminatorParents.entries()) {
    const { validChildren, warnings } = validatedParents.get(parentName)!;
    allWarnings.push(...warnings);

    if (!schemasGettingWrappers.has(parentName)) {
      if (!isEligibleForWrapper(parentName, validChildren, doc, opts)) continue;
      schemasGettingWrappers.add(parentName);
    }

    // When mergeNestedOneOf is enabled, include only children whose
    // ancestry path to this parent has no intermediate with its own wrapper.
    let childrenForWrapper = validChildren;
    if (opts.mergeNestedOneOf) {
      const included = new Set<string>();
      included.add(parentName); // Always include self-reference if present
      const descendants = getDescendants(parentName, inheritanceGraph);

      for (const childName of validChildren) {
        if (childName === parentName) continue;
        const ancestors = getAncestors(childName, schemas);
        // Only consider intermediates that are between parent and child
        // (must be both a descendant of parent and an ancestor of child)
        const hasIntermediateWrapper = [...ancestors].some(a =>
          a !== parentName && descendants.has(a) && schemasGettingWrappers.has(a)
        );
        if (!hasIntermediateWrapper) {
          included.add(childName);
        }
      }
      childrenForWrapper = validChildren.filter(name => included.has(name));
    }

    // Build reverse map: schema name -> discriminator value (before any mutations)
    const schemaToDiscriminatorValue = new Map<string, string>();
    for (const [value, ref] of Object.entries(discInfo.mapping)) {
      const schemaName = refToName(ref);
      if (schemaName && childrenForWrapper.includes(schemaName)) {
        schemaToDiscriminatorValue.set(schemaName, value);
      }
    }

    // Optionally add const constraints to children (before building oneOf so mapping stays current)
    if (opts.addDiscriminatorConst !== false) {
      const result = addDiscriminatorConstToChildren(schemas, childrenForWrapper, discInfo, parentName, schemasGettingWrappers);
      if (result.updatedMapping) {
        discInfo.mapping = result.updatedMapping;
      }
    }

    // Build oneOf refs using the (potentially updated) mapping
    const oneOfRefs: SchemaReference[] = childrenForWrapper.map(name => {
      const discValue = schemaToDiscriminatorValue.get(name);
      if (discValue && discInfo.mapping[discValue]) {
        return { $ref: discInfo.mapping[discValue] };
      }
      return { $ref: `#/components/schemas/${name}` };
    });

    const wrapperName = `${parentName}Polymorphic`;
    schemas[wrapperName] = {
      oneOf: oneOfRefs,
      discriminator: {
        propertyName: discInfo.propertyName,
        mapping: discInfo.mapping
      }
    };
    wrappers.set(parentName, { wrapperName, childNames: validChildren });
  }

  if (opts.onWarning) {
    for (const warning of allWarnings) {
      opts.onWarning(warning);
    }
  }

  return wrappers;
}

/**
 * Add const constraints to children.
 * For parent self-references, creates a wrapper schema with allOf + const.
 */
function addDiscriminatorConstToChildren(
  schemas: Record<string, SchemaObject>,
  childNames: string[],
  discInfo: DiscriminatorInfo,
  parentName: string,
  schemasGettingWrappers: Set<string>
): { updatedMapping?: Record<string, string> } {
  const updatedMapping: Record<string, string> = { ...discInfo.mapping };
  let mappingChanged = false;

  // Build reverse lookup: childName -> discriminatorValue
  const childToDiscValue = new Map(
    Object.entries(discInfo.mapping)
      .map(([value, ref]) => [refToName(ref), value])
      .filter((pair): pair is [string, string] => pair[0] !== undefined)
  );

  const createConstConstraint = (propName: string, value: string): SchemaObject => ({
    type: 'object',
    properties: { [propName]: { const: value } }
  });

  for (const childName of childNames) {
    const childSchema = schemas[childName];
    const discriminatorValue = childToDiscValue.get(childName);

    if (!childSchema || !discriminatorValue) continue;

    // Special handling for parent self-reference: create wrapper
    if (childName === parentName) {
      const wrapperName = `${parentName}OneOf`;
      schemas[wrapperName] = {
        allOf: [
          { $ref: `#/components/schemas/${parentName}` },
          createConstConstraint(discInfo.propertyName, discriminatorValue)
        ]
      };
      updatedMapping[discriminatorValue] = `#/components/schemas/${wrapperName}`;
      mappingChanged = true;
      continue;
    }

    // Skip adding const to children that will get their own wrappers
    // They will handle their own const via their OneOf wrapper
    if (schemasGettingWrappers.has(childName)) {
      continue;
    }

    // Add const to child's allOf if not already present
    if (!Array.isArray(childSchema.allOf)) {
      childSchema.allOf = [];
    }

    const constExists = childSchema.allOf.some(
      (item): item is SchemaObject =>
        isValidObject(item) &&
        isValidObject(item.properties) &&
        isValidObject(item.properties[discInfo.propertyName]) &&
        (item.properties[discInfo.propertyName] as Record<string, unknown>).const === discriminatorValue
    );

    if (!constExists) {
      childSchema.allOf.push(createConstConstraint(discInfo.propertyName, discriminatorValue));
    }
  }

  return mappingChanged ? { updatedMapping } : {};
}

/**
 * Replace references using JSONPath.
 * Replace all non-composition references from parent to wrapper.
 */
function replaceReferencesWithWrappers(
  doc: OpenAPIDocument,
  wrappers: Map<string, WrapperInfo>
): void {
  const replacementMap = new Map(
    Array.from(wrappers.entries()).map(([parentName, { wrapperName }]) => [
      `#/components/schemas/${parentName}`,
      `#/components/schemas/${wrapperName}`
    ])
  );

  const replaceRefs = (obj: Record<string, unknown>): void => {
    if (!obj) return;
    const results = JSONPath({
      path: '$..$ref',
      json: obj,
      resultType: 'all',
    }) as JSONPathResult[];

    for (const result of results) {
      const replacement = typeof result.value === 'string' ? replacementMap.get(result.value) : undefined;
      if (replacement && result.parent && result.parentProperty !== undefined) {
        (result.parent as Record<string, unknown>)[result.parentProperty as keyof typeof result.parent] = replacement;
      }
    }
  };

  // Process schemas separately to preserve allOf/anyOf/oneOf inheritance
  const schemas = doc.components?.schemas;
  if (isValidObject(schemas)) {
    for (const schema of Object.values(schemas)) {
      if (!isValidObject(schema)) continue;

      // Preserve composition arrays - replace refs only in non-composition parts
      const { allOf, anyOf, oneOf, ...schemaWithoutComposition } = schema;
      replaceRefs(schemaWithoutComposition);
    }
  }

  // Process other sections - replace all refs
  const sections = [
    doc.paths,
    doc.webhooks,
    doc.components?.requestBodies,
    doc.components?.responses,
    doc.components?.parameters,
    doc.components?.callbacks,
    doc.components?.links,
    doc.components?.headers,
  ];

  sections.filter(isValidObject).forEach(replaceRefs);
}

/**
 * Chain polymorphic wrappers.
 * If a wrapper's oneOf references another polymorphic parent, redirect to that parent's wrapper.
 */
function chainPolymorphicWrappers(
  schemas: Record<string, SchemaObject>,
  wrappers: Map<string, WrapperInfo>
): void {
  if (wrappers.size <= 1) return;

  for (const [parentName, { wrapperName }] of wrappers.entries()) {
    const wrapperSchema = schemas[wrapperName];
    if (!Array.isArray(wrapperSchema?.oneOf)) continue;

    wrapperSchema.oneOf = wrapperSchema.oneOf.map((entry): SchemaReference | SchemaObject => {
      if (!isSchemaReference(entry)) return entry;

      const targetName = entry.$ref ? refToName(entry.$ref) : null;
      const nestedWrapper = targetName && targetName !== parentName ? wrappers.get(targetName) : null;

      return nestedWrapper
        ? { $ref: `#/components/schemas/${nestedWrapper.wrapperName}` }
        : entry;
    });
  }
}

/**
 * Update existing oneOf schemas to reference polymorphic wrappers.
 * This handles pre-existing oneOf schemas (not created by this transform) that reference
 * schemas which got polymorphic wrappers.
 * 
 * When mergeNestedOneOf is enabled, skip this step for pre-existing oneOf schemas
 * as they will be handled by post-processing expansion instead.
 */
function updateExistingOneOfReferences(
  schemas: Record<string, SchemaObject>,
  wrappers: Map<string, WrapperInfo>,
  opts: AllOfToOneOfOptions = {}
): void {
  if (wrappers.size === 0) return;

  const createdWrappers = new Set(Array.from(wrappers.values()).map(w => w.wrapperName));

  const updateRef = (ref: unknown): string => {
    if (typeof ref !== 'string') return String(ref);
    if (!ref.startsWith('#/components/schemas/')) return ref;
    const targetName = refToName(ref);
    const wrapper = targetName ? wrappers.get(targetName) : null;
    return wrapper ? `#/components/schemas/${wrapper.wrapperName}` : ref;
  };

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!isValidObject(schema) || !Array.isArray(schema.oneOf)) continue;
    if (createdWrappers.has(schemaName)) continue;

    // When mergeNestedOneOf is enabled, skip updating pre-existing oneOf references
    // They will be expanded with discriminator children in post-processing
    if (opts.mergeNestedOneOf && schema.discriminator?.mapping) continue;

    // Update oneOf references
    schema.oneOf = schema.oneOf.map((entry): SchemaReference | SchemaObject =>
      isSchemaReference(entry) ? { $ref: updateRef(entry.$ref) } : entry
    );

    // Update discriminator mapping if present
    if (schema.discriminator?.mapping) {
      schema.discriminator.mapping = Object.fromEntries(
        Object.entries(schema.discriminator.mapping).map(([key, ref]) => [key, updateRef(ref)])
      );
    }
  }
}

/**
 * Remove discriminators from parent schemas.
 * Preserves discriminators on created wrapper schemas.
 */
function removeDiscriminatorFromParents(
  schemas: Record<string, SchemaObject>,
  wrappers: Map<string, WrapperInfo>,
  doc: OpenAPIDocument
): void {
  // Get names of created wrappers - these keep their discriminators
  const wrapperNames = new Set(Array.from(wrappers.values()).map(w => w.wrapperName));

  // Remove discriminators from original parent schemas that have wrappers
  for (const parentName of wrappers.keys()) {
    delete schemas[parentName]?.discriminator;
  }

  // Collect all children covered by any wrapper
  const allWrapperChildren = new Set<string>();
  for (const info of wrappers.values()) {
    for (const child of info.childNames) {
      allWrapperChildren.add(child);
    }
  }

  // Remove discriminators from non-wrapper schemas that only serve as inheritance
  // (they have wrapped children and aren't directly referenced outside composition)
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!hasDiscriminator(schema) || wrappers.has(schemaName) || wrapperNames.has(schemaName)) continue;
    if (isReferencedOutsideComposition(schemaName, doc)) continue;

    const hasWrappedChild = Object.values(schema.discriminator.mapping).some(ref => {
      const childName = refToName(ref);
      return childName && (wrappers.has(childName) || allWrapperChildren.has(childName));
    });

    if (hasWrappedChild) {
      delete (schema as SchemaObject).discriminator;
    }
  }
}

/**
 * Merge nested oneOf schemas (post-processing).
 * 
 * When mergeNestedOneOf is enabled:
 * 1. Expands pre-existing oneOf arrays to include all discriminator.mapping children
 * 2. Flattens nested oneOf references by replacing wrapper refs with their contents
 *    (only when discriminator propertyNames match)
 */
function mergeNestedOneOfSchemas(schemas: Record<string, SchemaObject>, wrappers: Map<string, WrapperInfo>): void {
  if (!isValidObject(schemas)) return;

  const wrapperNames = new Set(Array.from(wrappers.values()).map(w => w.wrapperName));

  // Step 1: Expand pre-existing oneOf to include discriminator children
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!isValidObject(schema) || !Array.isArray(schema.oneOf) || !schema.discriminator?.mapping) continue;

    const currentRefs = new Set(
      schema.oneOf
        .filter(isSchemaReference)
        .map(ref => refToName(ref.$ref))
        .filter((name): name is string => name !== null)
    );

    const toAdd: string[] = [];

    // Check each referenced schema for additional discriminator children
    for (const entry of schema.oneOf) {
      if (!isSchemaReference(entry)) continue;
      const refName = refToName(entry.$ref);
      if (!refName) continue;

      const refSchema = schemas[refName];
      
      // Only expand from schemas with matching propertyName
      if (refSchema?.discriminator?.propertyName === schema.discriminator?.propertyName && refSchema.discriminator?.mapping) {
        for (const [key, childRef] of Object.entries(refSchema.discriminator.mapping)) {
          if (typeof childRef === 'string') {
            const childName = refToName(childRef);
            if (childName && !currentRefs.has(childName) && schemas[childName]) {
              toAdd.push(childName);
              currentRefs.add(childName);
              // Add to parent's mapping
              if (schema.discriminator?.mapping && !schema.discriminator.mapping[key]) {
                schema.discriminator.mapping[key] = childRef;
              }
            }
          }
        }
      }
    }

    // Add discovered children to oneOf
    for (const name of toAdd) {
      schema.oneOf.push({ $ref: `#/components/schemas/${name}` });
    }
  }

  // Step 2: Flatten nested oneOf references
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!isValidObject(schema) || !Array.isArray(schema.oneOf)) continue;

    const mappingRefs = new Set<string>();
    if (schema.discriminator?.mapping) {
      for (const ref of Object.values(schema.discriminator.mapping)) {
        if (typeof ref === 'string') mappingRefs.add(ref);
      }
    }

    const newOneOf: Array<SchemaReference | SchemaObject> = [];
    const newMappings: Record<string, string> = {};
    let changed = false;

    for (const entry of schema.oneOf) {
      if (!isSchemaReference(entry)) {
        newOneOf.push(entry);
        continue;
      }

      const refName = refToName(entry.$ref);
      if (!refName) {
        newOneOf.push(entry);
        continue;
      }

      const refSchema = schemas[refName];
      
      // Try to flatten if nested schema is a oneOf with matching propertyName
      if (isValidObject(refSchema) && Array.isArray(refSchema.oneOf) &&
          refSchema.discriminator?.propertyName === schema.discriminator?.propertyName) {
        
        // Check if all children from nested schema exist in parent's mapping
        const allChildrenInMapping = (refSchema.discriminator?.mapping
          ? Object.values(refSchema.discriminator.mapping).every(ref => 
              typeof ref === 'string' && mappingRefs.has(ref))
          : refSchema.oneOf.every(child => 
              isSchemaReference(child) && mappingRefs.has(child.$ref)));

        if (allChildrenInMapping) {
          // Promote children
          newOneOf.push(...refSchema.oneOf);
          if (refSchema.discriminator?.mapping) {
            Object.assign(newMappings, refSchema.discriminator.mapping);
          }
          changed = true;
          continue;
        }
      }

      newOneOf.push(entry);
    }

    if (changed) {
      // Remove duplicates
      const unique = new Map(
        newOneOf.map(e => [
          isSchemaReference(e) ? e.$ref : JSON.stringify(e),
          e
        ])
      );
      schema.oneOf = Array.from(unique.values());
      
      // Merge new mappings
      if (Object.keys(newMappings).length > 0 && schema.discriminator) {
        schema.discriminator.mapping = { ...schema.discriminator.mapping, ...newMappings };
      }
    }
  }
}

/**
 * Main transformation function.
 * Converts allOf + discriminator patterns to oneOf wrappers using JSONPath.
 */
export function allOfToOneOf(doc: OpenAPIDocument, opts: AllOfToOneOfOptions = {}): OpenAPIDocument {
  const schemas = doc?.components?.schemas;
  if (!isValidObject(doc) || !isValidObject(schemas)) return doc;

  const discriminatorParents = findDiscriminatorParents(schemas);

  // Early exit if nothing to do
  if (discriminatorParents.size === 0 && !opts.mergeNestedOneOf) return doc;

  const inheritanceGraph = buildInheritanceGraph(schemas);
  const wrappers = createPolymorphicWrappers(schemas, discriminatorParents, inheritanceGraph, doc, opts);

  if (wrappers.size > 0) {
    replaceReferencesWithWrappers(doc, wrappers);
    chainPolymorphicWrappers(schemas, wrappers);
    updateExistingOneOfReferences(schemas, wrappers, opts);
  }

  // Merge nested oneOf BEFORE removing discriminators so mapping info is available
  if (opts.mergeNestedOneOf) {
    mergeNestedOneOfSchemas(schemas, wrappers);
  }

  if (wrappers.size > 0) {
    removeDiscriminatorFromParents(schemas, wrappers, doc);
  }

  return doc;
}
