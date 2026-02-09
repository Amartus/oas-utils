import { JSONPath } from 'jsonpath-plus';
import { AllOfToOneOfOptions } from './allOfToOneOfInterface.js';
import { refToName, buildInheritanceGraph } from './oasUtils.js';

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
  allChildren: string[];
  warnings: string[];
}

// Type guard helpers to reduce repetition
const isValidObject = (obj: unknown): obj is Record<string, unknown> =>
  obj !== null && typeof obj === 'object' && !Array.isArray(obj);

const isValidSchema = (schema: unknown): schema is SchemaObject =>
  isValidObject(schema);

const hasDiscriminator = (schema: unknown): schema is SchemaObject & { discriminator: DiscriminatorObject } =>
  isValidSchema(schema) &&
  isValidObject(schema.discriminator) &&
  typeof schema.discriminator.propertyName === 'string' &&
  isValidObject(schema.discriminator.mapping);

const isSchemaReference = (obj: unknown): obj is SchemaReference =>
  isValidObject(obj) && typeof obj.$ref === 'string';

/**
 * Step 1: Find all schemas with discriminators.
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
 * Step 3: Check if a schema is referenced outside of allOf contexts (inheritance).
 * References in oneOf/anyOf are considered polymorphic usage and should get wrappers.
 * Uses JSONPath to find all references and filters by context.
 */
function isReferencedOutsideComposition(
  schemaName: string,
  doc: OpenAPIDocument
): boolean {
  const schemaRef = `#/components/schemas/${schemaName}`;
  const usageContexts = new Set(['oneOf', 'anyOf', 'properties', 'items', 'schema']);
  const inheritanceContexts = new Set(['allOf', 'discriminator', 'mapping']);

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

    // Look backwards for context
    let inAllOf = -1;
    let inDiscriminatorMapping = -1;
    let inUsageContext = -1;

    for (let i = pathParts.length - 1; i >= 0; i--) {
      const part = pathParts[i];
      if (inAllOf === -1 && part === 'allOf') {
        inAllOf = i;
      }
      if (inDiscriminatorMapping === -1 && (part === 'discriminator' || part === 'mapping')) {
        inDiscriminatorMapping = i;
      }
      if (inUsageContext === -1 && usageContexts.has(part)) {
        inUsageContext = i;
      }
      if (inAllOf !== -1 && inDiscriminatorMapping !== -1 && inUsageContext !== -1) break;
    }

    // Skip if in allOf (pure inheritance) or in discriminator mapping (metadata)
    if (inAllOf !== -1 || inDiscriminatorMapping !== -1) {
      continue;
    }

    // If in a usage context or neither, it's actual usage
    return true;
  }

  return false;
}

/**
 * Step 4: Validate and get children for a parent.
 * Returns valid inheriting children separately from all mapped children.
 */
function validateAndGetChildren(
  parentName: string,
  mapping: Record<string, string>,
  schemas: Record<string, SchemaObject>,
  inheritanceGraph: Map<string, Set<string>>
): ChildValidationResult {
  const validChildren: string[] = [];
  const allChildren: string[] = [];
  const warnings: string[] = [];
  const descendants = inheritanceGraph.get(parentName) || new Set<string>();

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

    allChildren.push(childName);

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

  return { validChildren, allChildren, warnings };
}

/**
 * Step 4b: Create polymorphic wrappers for parents that are referenced.
 * This is the new type that is oneOf of the valid children. The original parent schema is kept as-is (without discriminator)
 */
function createPolymorphicWrappers(
  schemas: Record<string, SchemaObject>,
  discriminatorParents: Map<string, DiscriminatorInfo>,
  inheritanceGraph: Map<string, Set<string>>,
  doc: OpenAPIDocument,
  opts: AllOfToOneOfOptions
): Map<string, WrapperInfo> {
  const wrappers = new Map<string, WrapperInfo>();
  const allWarnings: string[] = [];

  const wrapperSuffix = 'Polymorphic';

  // First pass: determine which schemas will get wrappers
  const schemasGettingWrappers = new Set<string>();
  for (const [parentName, discInfo] of discriminatorParents.entries()) {
    const { validChildren } = validateAndGetChildren(
      parentName,
      discInfo.mapping,
      schemas,
      inheritanceGraph
    );

    // Only create wrapper if schema is referenced outside allOf (actual usage)
    // If it's only used for inheritance, children handle their own polymorphism
    const isReferencedDirectly = isReferencedOutsideComposition(parentName, doc);

    if (isReferencedDirectly && validChildren.length > 0) {
      if (validChildren.length === 1 && (opts.ignoreSingleSpecialization || validChildren[0] === parentName)) {
        continue;
      }
      schemasGettingWrappers.add(parentName);
    }
  }

  function createWrapper(parentName: string, discInfo: DiscriminatorInfo, validChildren: string[]): SchemaObject | undefined {
    // Only create wrapper if schema is referenced outside allOf (actual usage)
    // If it's only used for inheritance, children handle their own polymorphism
    const isReferencedDirectly = isReferencedOutsideComposition(parentName, doc);

    if (!isReferencedDirectly || validChildren.length === 0) {
      return;
    }
    if (validChildren.length === 1) {
      if (opts.ignoreSingleSpecialization || (validChildren[0] === parentName)) {
        return;
      }
    }

    // Build a map from concrete schema names to their discriminator values BEFORE modifying mapping
    const schemaToDiscriminatorValue = new Map<string, string>();
    for (const [value, ref] of Object.entries(discInfo.mapping)) {
      if (typeof ref === 'string') {
        const schemaName = refToName(ref);
        if (schemaName && validChildren.includes(schemaName)) {
          schemaToDiscriminatorValue.set(schemaName, value);
        }
      }
    }

    // Add const properties (creates wrapper for parent self-reference)
    // Do this BEFORE building oneOf so we can use the updated mapping
    if (opts.addDiscriminatorConst !== false) {
      const result = addDiscriminatorConstToChildren(schemas, validChildren, discInfo, parentName, schemasGettingWrappers);
      // Update the mapping if it changed
      if (result.updatedMapping) {
        discInfo.mapping = result.updatedMapping;
      }
    }

    // Build oneOf using the (potentially updated) mapping values
    const oneOfRefs: SchemaReference[] = validChildren.map(name => {
      // Find the discriminator value for this schema
      const discValue = schemaToDiscriminatorValue.get(name);
      if (discValue && discInfo.mapping[discValue]) {
        // Use the (potentially updated) mapping value
        return { $ref: discInfo.mapping[discValue] };
      }
      // Fallback to direct reference if not found in mapping
      return { $ref: `#/components/schemas/${name}` };
    });

    const wrapperSchema: SchemaObject = {
      oneOf: oneOfRefs,
      discriminator: {
        propertyName: discInfo.propertyName,
        mapping: discInfo.mapping  // Use updated mapping
      }
    };

    return wrapperSchema;
  }

  for (const [parentName, discInfo] of discriminatorParents.entries()) {
    // Validate and get children FIRST
    const { validChildren, warnings } = validateAndGetChildren(
      parentName,
      discInfo.mapping,
      schemas,
      inheritanceGraph
    );

    allWarnings.push(...warnings);

    const wrapperSchema = createWrapper(parentName, discInfo, validChildren);

    if (wrapperSchema) {
      const wrapperName = `${parentName}${wrapperSuffix}`;
      schemas[wrapperName] = wrapperSchema;
      wrappers.set(parentName, { wrapperName, childNames: validChildren });
    }
  }

  if (allWarnings.length > 0) {
    console.warn('Warnings during allOf to oneOf conversion:');
    for (const warning of allWarnings) {
      console.warn(`  - ${warning}`);
    }
  }

  return wrappers;
}

/**
 * Step 5: Add const constraints to children.
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
        isValidSchema(item) &&
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
 * Step 6: Replace references using JSONPath.
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
    JSONPath({
      path: '$..$ref',
      json: obj,
      resultType: 'all',
      callback: (result: JSONPathResult) => {
        const replacement = typeof result.value === 'string' ? replacementMap.get(result.value) : undefined;
        if (replacement) {
          result.parent[result.parentProperty] = replacement;
        }
      }
    });
  };

  // Process schemas separately to preserve allOf/anyOf/oneOf inheritance
  const schemas = doc.components?.schemas;
  if (isValidObject(schemas)) {
    for (const schema of Object.values(schemas)) {
      if (!isValidSchema(schema)) continue;

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
 * Step 7: Chain polymorphic wrappers.
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
 */
function updateExistingOneOfReferences(
  schemas: Record<string, SchemaObject>,
  wrappers: Map<string, WrapperInfo>
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
    if (!isValidSchema(schema) || !Array.isArray(schema.oneOf)) continue;
    if (createdWrappers.has(schemaName)) continue;

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
 * Step 8: Remove discriminators from parent schemas.
 */
function removeDiscriminatorFromParents(
  schemas: Record<string, SchemaObject>,
  wrappers: Map<string, WrapperInfo>,
  doc: OpenAPIDocument
): void {
  // Case 1: Remove from schemas that got wrappers
  for (const parentName of wrappers.keys()) {
    delete schemas[parentName]?.discriminator;
  }

  // Case 2: Remove from schemas that didn't get wrappers but have wrapped children
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!hasDiscriminator(schema) || wrappers.has(schemaName)) continue;
    if (isReferencedOutsideComposition(schemaName, doc)) continue;

    // Check if any child has a wrapper
    const hasWrappedChild = Object.values(schema.discriminator.mapping)
      .some(ref => {
        const childName = typeof ref === 'string' ? refToName(ref) : null;
        return childName && wrappers.has(childName);
      });

    if (hasWrappedChild) {
      // Use Reflect to delete the optional property
      Reflect.deleteProperty(schema, 'discriminator');
    }
  }
}

/**
 * Step 9: Merge nested oneOf schemas (optional).
 */
function mergeNestedOneOfSchemas(schemas: Record<string, SchemaObject>): void {
  if (!isValidObject(schemas)) return;

  // Identify simple oneOf wrappers
  const simpleOneOfSchemas = new Set(
    Object.entries(schemas)
      .filter(([_, schema]) => isSimpleOneOfSchema(schema))
      .map(([name, _]) => name)
  );

  if (simpleOneOfSchemas.size === 0) return;

  // Merge nested oneOf
  for (const schema of Object.values(schemas)) {
    if (!isValidSchema(schema) || !Array.isArray(schema.oneOf)) continue;

    let modified = false;
    const newOneOf: Array<SchemaReference | SchemaObject> = [];
    const mergedMappings: Record<string, string> = {};

    for (const entry of schema.oneOf) {
      const refName = isSchemaReference(entry) ? refToName(entry.$ref) : null;

      if (!refName || !simpleOneOfSchemas.has(refName)) {
        newOneOf.push(entry);
        continue;
      }

      // Inline the referenced oneOf
      const referencedSchema = schemas[refName];
      if (Array.isArray(referencedSchema?.oneOf)) {
        newOneOf.push(...referencedSchema.oneOf);
        Object.assign(mergedMappings, referencedSchema.discriminator?.mapping || {});
        modified = true;
      } else {
        newOneOf.push(entry);
      }
    }

    if (modified) {
      // Remove duplicates by key
      const uniqueRefs = new Map(
        newOneOf.map(entry => [entry?.$ref || JSON.stringify(entry), entry])
      );
      schema.oneOf = Array.from(uniqueRefs.values());

      // Merge discriminator mappings
      if (Object.keys(mergedMappings).length > 0) {
        schema.discriminator = schema.discriminator || { propertyName: 'type', mapping: {} };
        schema.discriminator.mapping = { ...schema.discriminator.mapping, ...mergedMappings };
      }
    }
  }
}

/**
 * Check if a schema is a simple oneOf wrapper.
 */
function isSimpleOneOfSchema(schema: unknown): schema is SchemaObject {
  if (!isValidSchema(schema) || !Array.isArray(schema.oneOf) || schema.oneOf.length === 0) {
    return false;
  }

  const allowedKeys = new Set(['oneOf', 'discriminator', 'description']);
  const disallowedProps = ['allOf', 'anyOf', 'properties', 'type'];

  return Object.keys(schema).every(key => allowedKeys.has(key)) &&
    disallowedProps.every(prop => !schema[prop]);
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
    updateExistingOneOfReferences(schemas, wrappers);
    removeDiscriminatorFromParents(schemas, wrappers, doc);
  }

  if (opts.mergeNestedOneOf) {
    mergeNestedOneOfSchemas(schemas);
  }

  return doc;
}
