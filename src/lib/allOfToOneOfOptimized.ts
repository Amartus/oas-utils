import { JSONPath } from 'jsonpath-plus';
import { refToName, buildInheritanceGraph, getAncestors } from "./oasUtils.js";
import { collectMatching } from "./schemaTransformUtils.js";

export interface AllOfToOneOfOptions {
  /** If true, add const property with discriminator value to specialization schemas (default: true) */
  addDiscriminatorConst?: boolean;
  /** If true, skip oneOf transformation if only one specialization is found (default: false) */
  ignoreSingleSpecialization?: boolean;
  /** If true, merge nested oneOf schemas by inlining references to schemas that only contain oneOf (default: false) */
  mergeNestedOneOf?: boolean;
  /** Suffix for polymorphic wrapper schema names (default: "Polymorphic") */
  wrapperSuffix?: string;
}

/**
 * Information about a schema reference location.
 */
interface ReferenceLocation {
  /** The schema or path that contains the reference */
  path: string;
  /** Context: 'allOf', 'anyOf', 'oneOf', 'direct' */
  context: 'allOf' | 'anyOf' | 'oneOf' | 'direct';
}

/**
 * Build a comprehensive reference index for the entire document.
 * This is done once to avoid repeated traversals.
 */
function buildReferenceIndex(doc: any): Map<string, ReferenceLocation[]> {
  const index = new Map<string, ReferenceLocation[]>();
  
  if (!doc || typeof doc !== 'object') return index;

  // Helper to add a reference to the index
  const addRef = (ref: string, path: string, context: ReferenceLocation['context']) => {
    if (!index.has(ref)) {
      index.set(ref, []);
    }
    index.get(ref)!.push({ path, context });
  };

  // Index schemas for allOf/anyOf/oneOf context
  const schemas = doc.components?.schemas;
  if (schemas && typeof schemas === 'object') {
    for (const [schemaName, schema] of Object.entries(schemas)) {
      if (!schema || typeof schema !== 'object') continue;
      
      const schemaPath = `#/components/schemas/${schemaName}`;
      const schemaObj = schema as any;
      
      // Index allOf, anyOf, oneOf references
      for (const compositionType of ['allOf', 'anyOf', 'oneOf'] as const) {
        if (Array.isArray(schemaObj[compositionType])) {
          for (const item of schemaObj[compositionType]) {
            if (item?.$ref) {
              addRef(item.$ref, schemaPath, compositionType);
            }
          }
        }
      }
      
      // Index other references in schema (properties, items, etc.) - these are "direct" usage
      const { allOf, anyOf, oneOf, ...schemaWithoutComposition } = schemaObj;
      const directRefs = collectMatching(schemaWithoutComposition, (node) => 
        node && typeof node === 'object' && typeof node.$ref === 'string'
      );
      
      for (const refNode of directRefs) {
        addRef(refNode.$ref, schemaPath, 'direct');
      }
    }
  }

  // Index references in paths, webhooks, components (excluding schemas)
  const sectionsToIndex = [
    { obj: doc.paths, name: 'paths' },
    { obj: doc.webhooks, name: 'webhooks' },
    { obj: doc.components?.requestBodies, name: 'components.requestBodies' },
    { obj: doc.components?.responses, name: 'components.responses' },
    { obj: doc.components?.parameters, name: 'components.parameters' },
    { obj: doc.components?.callbacks, name: 'components.callbacks' },
    { obj: doc.components?.links, name: 'components.links' },
    { obj: doc.components?.headers, name: 'components.headers' },
  ];

  for (const section of sectionsToIndex) {
    if (!section.obj) continue;
    
    const refs = collectMatching(section.obj, (node) => 
      node && typeof node === 'object' && typeof node.$ref === 'string'
    );
    
    for (const refNode of refs) {
      addRef(refNode.$ref, section.name, 'direct');
    }
  }

  return index;
}

/**
 * Check if a schema is referenced outside of composition contexts (allOf/anyOf/oneOf).
 * Uses the pre-built reference index for O(1) lookup.
 */
function isReferencedOutsideComposition(
  schemaRef: string,
  refIndex: Map<string, ReferenceLocation[]>
): boolean {
  const locations = refIndex.get(schemaRef) || [];
  return locations.some(loc => loc.context === 'direct');
}

/**
 * Step 1: Identify all schemas with discriminators that have more than one mapping entry.
 * Only consider schemas that are NOT already oneOf wrappers (those are handled by mergeNestedOneOf).
 */
function findDiscriminatorParents(
  schemas: Record<string, any>
): Map<string, { propertyName: string; mapping: Record<string, string> }> {
  const parents = new Map();
  
  if (!schemas || typeof schemas !== 'object') return parents;

  for (const [name, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== 'object') continue;
    
    // Skip schemas that are already oneOf wrappers - they're pre-existing, not bases to convert
    if (Array.isArray(schema.oneOf)) {
      continue;
    }
    
    const disc = schema.discriminator;
    if (!disc || !disc.propertyName || !disc.mapping) continue;
    if (typeof disc.mapping !== 'object') continue;
    
    // Only keep schemas that actually discriminate (more than 1 mapping entry)
    const mappingKeys = Object.keys(disc.mapping);
    if (mappingKeys.length > 1) {
      parents.set(name, {
        propertyName: disc.propertyName,
        mapping: { ...disc.mapping }
      });
    }
  }

  return parents;
}

/**
 * Step 4.1 & 4.2: Find and validate children for a polymorphic parent.
 * 
 * For each child in the mapping:
 * - Check if it directly or indirectly inherits from the parent
 * - Warn if a child doesn't inherit from parent
 * - Include all children in the result, but track which ones are valid
 * 
 * @returns Array of all child schema names, plus count of valid inheriting children
 */
function validateAndGetChildren(
  parentName: string,
  mapping: Record<string, string>,
  schemas: Record<string, any>,
  inheritanceGraph: Map<string, Set<string>>
): { allChildren: string[]; validChildrenCount: number; warnings: string[] } {
  const allChildren: string[] = [];
  let validChildrenCount = 0;
  const warnings: string[] = [];
  
  // Get all descendants (transitive closure) of the parent
  const allDescendants = new Set<string>();
  const queue = [parentName];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = inheritanceGraph.get(current);
    
    if (children) {
      for (const child of children) {
        if (!allDescendants.has(child)) {
          allDescendants.add(child);
          queue.push(child);
        }
      }
    }
  }
  
  // Check each mapping entry
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
    
    // Check if child inherits from parent (directly or indirectly)
    const inheritsFromParent = allDescendants.has(childName) || childName === parentName;
    
    if (!inheritsFromParent) {
      warnings.push(
        `Schema "${childName}" in discriminator mapping does not inherit from "${parentName}". ` +
        `It will be kept in the mapping but may cause validation issues.`
      );
    } else {
      validChildrenCount++;
    }
    
    // Include all children, both valid and invalid
    allChildren.push(childName);
  }
  
  return { allChildren, validChildrenCount, warnings };
}

/**
 * Add const constraint to each concrete schema matching the discriminator value.
 */
function addDiscriminatorConstToChildren(
  schemas: Record<string, any>,
  childNames: string[],
  discInfo: { mapping: Record<string, string>; propertyName: string }
): void {
  for (const childName of childNames) {
    const childSchema = schemas[childName];
    if (!childSchema) continue;

    // Find the discriminator value for this child
    let discriminatorValue: string | undefined;
    for (const [value, ref] of Object.entries(discInfo.mapping)) {
      if (typeof ref === 'string' && refToName(ref) === childName) {
        discriminatorValue = value;
        break;
      }
    }

    if (!discriminatorValue) continue;

    // Ensure allOf exists
    if (!Array.isArray(childSchema.allOf)) {
      childSchema.allOf = [];
    }

    // Check if const constraint already exists
    const constExists = childSchema.allOf.some(
      (item: any) =>
        item &&
        typeof item === 'object' &&
        item.type === 'object' &&
        item.properties?.[discInfo.propertyName]?.const === discriminatorValue
    );

    if (!constExists) {
      // Add const as a separate allOf constraint
      childSchema.allOf.push({
        type: 'object',
        properties: {
          [discInfo.propertyName]: {
            const: discriminatorValue
          }
        }
      });
    }
  }
}

/**
 * Step 4.3: Create polymorphic wrapper schemas for parents that are actually used.
 */
function createPolymorphicWrappers(
  schemas: Record<string, any>,
  discriminatorParents: Map<string, { propertyName: string; mapping: Record<string, string> }>,
  inheritanceGraph: Map<string, Set<string>>,
  refIndex: Map<string, ReferenceLocation[]>,
  opts: AllOfToOneOfOptions
): Map<string, { wrapperName: string; childNames: string[] }> {
  const wrappers = new Map<string, { wrapperName: string; childNames: string[] }>();
  const allWarnings: string[] = [];
  
  const wrapperSuffix = opts.wrapperSuffix || 'Polymorphic';

  for (const [parentName, discInfo] of discriminatorParents.entries()) {
    const parentRef = `#/components/schemas/${parentName}`;
    
    // Step 3: Check if parent is referenced outside composition contexts
    const isUsed = isReferencedOutsideComposition(parentRef, refIndex);
    
    if (!isUsed) {
      // Parent is only used for inheritance, no polymorphic wrapper needed
      continue;
    }

    // Step 4.1 & 4.2: Find and validate children
    const { allChildren, validChildrenCount, warnings } = validateAndGetChildren(
      parentName,
      discInfo.mapping,
      schemas,
      inheritanceGraph
    );
    
    allWarnings.push(...warnings);
    
    // Don't create wrapper if no valid inheriting children exist
    if (validChildrenCount === 0) {
      continue;
    }
    
    if (opts.ignoreSingleSpecialization && validChildrenCount === 1) {
      continue;
    }
    
    if (allChildren.length === 0) {
      continue;
    }

    // Step 4.3: Create wrapper (include all children, even non-inheriting ones with warnings)
    const wrapperName = `${parentName}${wrapperSuffix}`;
    
    const wrapperSchema: any = {
      oneOf: allChildren.map(name => ({ $ref: `#/components/schemas/${name}` })),
      discriminator: {
        propertyName: discInfo.propertyName,
        mapping: discInfo.mapping
      }
    };

    // Preserve description from base
    const baseSchema = schemas[parentName];
    if (baseSchema?.description) {
      wrapperSchema.description = `Polymorphic ${parentName}. Use the "${discInfo.propertyName}" property to identify the concrete schema.`;
    }

    schemas[wrapperName] = wrapperSchema;
    wrappers.set(parentName, { wrapperName, childNames: allChildren });

    // Add const properties to children if requested
    if (opts.addDiscriminatorConst !== false) {
      addDiscriminatorConstToChildren(schemas, allChildren, discInfo);
    }
  }

  // Print warnings if any
  if (allWarnings.length > 0) {
    console.warn('Warnings during allOf to oneOf conversion:');
    for (const warning of allWarnings) {
      console.warn(`  - ${warning}`);
    }
  }

  return wrappers;
}

/**
 * Replace all references to parent schemas with wrapper schemas,
 * except in composition contexts (allOf/anyOf/oneOf).
 */
function replaceReferencesWithWrappers(
  doc: any,
  wrappers: Map<string, { wrapperName: string; childNames: string[] }>
): void {
  if (!doc || typeof doc !== 'object') return;

  // Build replacement map
  const replacementMap = new Map<string, string>();
  for (const [parentName, { wrapperName }] of wrappers.entries()) {
    const parentRef = `#/components/schemas/${parentName}`;
    const wrapperRef = `#/components/schemas/${wrapperName}`;
    replacementMap.set(parentRef, wrapperRef);
  }

  // Replace in schemas (but preserve allOf/anyOf/oneOf inheritance)
  const schemas = doc.components?.schemas;
  if (schemas && typeof schemas === 'object') {
    for (const schema of Object.values(schemas)) {
      if (!schema || typeof schema !== 'object') continue;
      
      const schemaObj = schema as any;
      // Keep composition contexts untouched
      const { allOf, anyOf, oneOf, ...schemaWithoutComposition } = schemaObj;
      
      // Replace in non-composition parts
      replaceRefsInNode(schemaWithoutComposition, replacementMap);
    }
  }

  // Replace in other document sections
  replaceRefsInNode(doc.paths, replacementMap);
  replaceRefsInNode(doc.webhooks, replacementMap);
  
  if (doc.components && typeof doc.components === 'object') {
    replaceRefsInNode(doc.components.requestBodies, replacementMap);
    replaceRefsInNode(doc.components.responses, replacementMap);
    replaceRefsInNode(doc.components.parameters, replacementMap);
    replaceRefsInNode(doc.components.callbacks, replacementMap);
    replaceRefsInNode(doc.components.links, replacementMap);
    replaceRefsInNode(doc.components.headers, replacementMap);
  }
}

/**
 * Recursively replace $ref values in a node using the replacement map.
 */
function replaceRefsInNode(node: any, replacementMap: Map<string, string>): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) {
      replaceRefsInNode(item, replacementMap);
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      const replacement = replacementMap.get(value);
      if (replacement) {
        node[key] = replacement;
      }
    } else if (value && typeof value === 'object') {
      replaceRefsInNode(value, replacementMap);
    }
  }
}

/**
 * Chain polymorphic wrappers: if a wrapper's oneOf references another polymorphic parent,
 * redirect to that parent's wrapper.
 */
function chainPolymorphicWrappers(
  schemas: Record<string, any>,
  wrappers: Map<string, { wrapperName: string; childNames: string[] }>
): void {
  if (wrappers.size <= 1) return;

  for (const [parentName, { wrapperName }] of wrappers.entries()) {
    const wrapperSchema = schemas[wrapperName];
    if (!wrapperSchema || !Array.isArray(wrapperSchema.oneOf)) continue;

    wrapperSchema.oneOf = wrapperSchema.oneOf.map((entry: any) => {
      if (!entry?.$ref) return entry;
      
      const targetName = refToName(entry.$ref);
      if (!targetName) return entry;
      
      // Don't replace reference to the parent schema itself (avoid circular reference)
      if (targetName === parentName) return entry;
      
      const nestedWrapper = wrappers.get(targetName);
      if (!nestedWrapper) return entry;
      
      return { $ref: `#/components/schemas/${nestedWrapper.wrapperName}` };
    });
  }
}

/**
 * Merge nested oneOf schemas by inlining references to schemas that only contain oneOf.
 */
function mergeNestedOneOfSchemas(schemas: Record<string, any>): void {
  if (!schemas || typeof schemas !== 'object') return;

  // Identify simple oneOf wrappers
  const simpleOneOfSchemas = new Set<string>();
  for (const [name, schema] of Object.entries(schemas)) {
    if (isSimpleOneOfSchema(schema)) {
      simpleOneOfSchemas.add(name);
    }
  }

  if (simpleOneOfSchemas.size === 0) return;

  // Merge nested oneOf
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== 'object' || !Array.isArray(schema.oneOf)) {
      continue;
    }

    let modified = false;
    const newOneOf: any[] = [];
    const mergedMappings: Record<string, string> = {};

    for (const entry of schema.oneOf) {
      if (!entry?.$ref) {
        newOneOf.push(entry);
        continue;
      }

      const refName = refToName(entry.$ref);
      
      if (!refName || !simpleOneOfSchemas.has(refName)) {
        newOneOf.push(entry);
        continue;
      }

      // Inline the referenced oneOf
      const referencedSchema = schemas[refName];
      if (referencedSchema && Array.isArray(referencedSchema.oneOf)) {
        newOneOf.push(...referencedSchema.oneOf);
        
        if (referencedSchema.discriminator?.mapping) {
          Object.assign(mergedMappings, referencedSchema.discriminator.mapping);
        }
        
        modified = true;
      } else {
        newOneOf.push(entry);
      }
    }

    if (modified) {
      // Remove duplicates
      const uniqueRefs = new Map<string, any>();
      for (const entry of newOneOf) {
        const key = entry?.$ref || JSON.stringify(entry);
        uniqueRefs.set(key, entry);
      }
      schema.oneOf = Array.from(uniqueRefs.values());

      // Merge discriminator mappings
      if (Object.keys(mergedMappings).length > 0) {
        if (!schema.discriminator) {
          schema.discriminator = { propertyName: 'type', mapping: {} };
        }
        if (!schema.discriminator.mapping) {
          schema.discriminator.mapping = {};
        }
        Object.assign(schema.discriminator.mapping, mergedMappings);
      }
    }
  }
}

/**
 * Check if a schema is a simple oneOf wrapper (only has oneOf, discriminator, description).
 */
function isSimpleOneOfSchema(schema: any): boolean {
  if (!schema || typeof schema !== 'object') return false;
  if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) return false;

  const allowedKeys = new Set(['oneOf', 'discriminator', 'description']);
  const schemaKeys = Object.keys(schema);
  
  for (const key of schemaKeys) {
    if (!allowedKeys.has(key)) {
      return false;
    }
  }

  if (schema.allOf || schema.properties || schema.type || schema.anyOf) {
    return false;
  }

  return true;
}

/**
 * Step 4.4: Remove discriminator from parent schemas based on wrapper creation status.
 * 
 * Two cases:
 * 1. Remove discriminator from schemas that got wrappers created (they're now just base types)
 * 2. Remove discriminator from schemas that:
 *    - Did NOT get a wrapper themselves
 *    - But have children that did get wrappers
 *    - AND are not referenced outside composition (they're only used for inheritance)
 *    
 * The second case handles situations like Vehicle which is only used for inheritance
 * but its child (Car) has a polymorphic wrapper. The discriminator on Vehicle becomes
 * stale/superseded by the child's wrapper.
 */
function removeDiscriminatorFromParents(
  schemas: Record<string, any>,
  wrappers: Map<string, { wrapperName: string; childNames: string[] }>,
  refIndex: Map<string, ReferenceLocation[]>
): void {
  // Case 1: Remove discriminator from schemas that got wrappers
  for (const parentName of wrappers.keys()) {
    const parentSchema = schemas[parentName];
    if (parentSchema?.discriminator) {
      delete parentSchema.discriminator;
    }
  }
  
  // Case 2: Remove discriminators from schemas that:
  // - didn't get wrappers (not in wrappers map)
  // - are not referenced outside composition (only used for inheritance)
  // - have children that got wrappers
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== 'object') continue;
    if (!schema.discriminator?.mapping) continue;
    
    // Skip if this schema got a wrapper (already handled in case 1)
    if (wrappers.has(schemaName)) continue;
    
    // Check if this schema is referenced outside composition
    const schemaRef = `#/components/schemas/${schemaName}`;
    const isUsedOutsideComposition = isReferencedOutsideComposition(schemaRef, refIndex);
    
    // If referenced outside composition, keep the discriminator
    // (like CommercialCar which is directly referenced in Dealership)
    if (isUsedOutsideComposition) continue;
    
    // Check if any mapped child has a wrapper
    let hasWrappedChild = false;
    for (const ref of Object.values(schema.discriminator.mapping)) {
      if (typeof ref !== 'string') continue;
      const childName = refToName(ref);
      if (childName && wrappers.has(childName)) {
        hasWrappedChild = true;
        break;
      }
    }
    
    // Only remove discriminator if not used outside composition and has wrapped children
    if (hasWrappedChild) {
      delete schema.discriminator;
    }
  }
}

/**
 * Optimized version of allOf to oneOf conversion.
 * 
 * This implementation follows the algorithm:
 * 1. Identify schemas with discriminators (more than 1 mapping entry)
 * 2. Build inheritance graph (transitive closure)
 * 3. Check which discriminator parents are actually used (outside composition)
 * 4. For each used parent:
 *    - Find and validate children
 *    - Create polymorphic wrapper
 *    - Add const properties to children
 *    - Remove discriminator from parent
 * 
 * Key optimizations:
 * - Single-pass reference indexing (O(n) instead of O(n²))
 * - Reuse of inheritance graph
 * - Validation with clear warnings
 * 
 * @param doc - OpenAPI document to transform
 * @param opts - Optional configuration
 */
export function allOfToOneOf(doc: any, opts: AllOfToOneOfOptions = {}): any {
  if (!doc || typeof doc !== 'object') return doc;
  
  const schemas = doc.components?.schemas;
  if (!schemas || typeof schemas !== 'object') return doc;

  // Step 1: Identify schemas with discriminators (excluding existing oneOf wrappers)
  const discriminatorParents = findDiscriminatorParents(schemas);
  
  // Early exit only if we have no work to do at all
  if (discriminatorParents.size === 0 && !opts.mergeNestedOneOf) {
    return doc;
  }

  // Step 2: Build inheritance graph (transitive closure)
  const inheritanceGraph = buildInheritanceGraph(schemas);

  // Step 3: Build reference index for the entire document (single pass)
  const refIndex = buildReferenceIndex(doc);

  // Step 4: Create polymorphic wrappers for parents that are actually used
  const wrappers = createPolymorphicWrappers(
    schemas,
    discriminatorParents,
    inheritanceGraph,
    refIndex,
    opts
  );

  if (wrappers.size > 0) {
    // Step 5: Replace references to parents with wrappers (except in composition)
    replaceReferencesWithWrappers(doc, wrappers);

    // Step 5b: Chain polymorphic wrappers
    chainPolymorphicWrappers(schemas, wrappers);

    // Step 4.4: Remove discriminator from parent schemas
    removeDiscriminatorFromParents(schemas, wrappers, refIndex);
  }

  // Step 5c: Optionally merge nested oneOf (applies to ALL oneOf schemas, not just created wrappers)
  if (opts.mergeNestedOneOf) {
    mergeNestedOneOfSchemas(schemas);
  }

  return doc;
}
