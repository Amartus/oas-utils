import { refToName, buildInheritanceGraph } from "./oasUtils.js";
import { collectMatching } from "./schemaTransformUtils.js";

/**
 * Check if a schema reference is used anywhere in the document outside of allOf arrays.
 * Returns true if the schema is referenced in paths, operations, or components (excluding allOf inheritance).
 */
function isSchemaReferencedOutsideAllOf(doc: any, schemaRef: string): boolean {
  // Check paths and webhooks (no allOf filtering needed here)
  if (collectMatching(doc.paths, (node) => node?.$ref === schemaRef).length > 0) {
    return true;
  }
  if (collectMatching(doc.webhooks, (node) => node?.$ref === schemaRef).length > 0) {
    return true;
  }

  // Check components (excluding schemas which need special handling)
  const components = doc.components;
  if (components) {
    const nonSchemaComponents = {
      requestBodies: components.requestBodies,
      responses: components.responses,
      parameters: components.parameters,
      callbacks: components.callbacks,
      links: components.links,
      headers: components.headers
    };
    
    if (collectMatching(nonSchemaComponents, (node) => node?.$ref === schemaRef).length > 0) {
      return true;
    }

    // Check schemas but exclude direct allOf references
    const schemas = components.schemas;
    if (schemas && typeof schemas === "object") {
      for (const schema of Object.values(schemas)) {
        if (schema && typeof schema === "object") {
          // Create a copy of schema without the allOf array to search
          const { allOf, ...schemaWithoutAllOf } = schema as any;
          
          // Search in everything except the direct allOf references
          if (collectMatching(schemaWithoutAllOf, (node) => node?.$ref === schemaRef).length > 0) {
            return true;
          }
        }
      }
    }
  }

  return false;
}


export interface AllOfToOneOfOptions {
  /** If true, add const property with discriminator value to specialization schemas (default: true) */
  addDiscriminatorConst?: boolean;
  /** If true, skip oneOf transformation if only one specialization is found (default: false) */
  ignoreSingleSpecialization?: boolean;
  /** If true, merge nested oneOf schemas by inlining references to schemas that only contain oneOf (default: false) */
  mergeNestedOneOf?: boolean;
}

/**
 * Convert allOf + discriminator patterns to oneOf + discriminator.
 *
 * This operation:
 * 1. Finds base schemas with discriminators
 * 2. Identifies concrete schemas that extend the base via allOf
 * 3. For each concrete schema, adds a const property matching the discriminator value
 * 4. Creates a new oneOf wrapper schema containing all concrete schemas
 * 5. Replaces all references to the base schema with the wrapper schema (where polymorphism is used)
 *
 * @param doc - OpenAPI document to transform
 * @param opts - Optional configuration
 */
export function allOfToOneOf(doc: any, opts: AllOfToOneOfOptions = {}): any {
  if (!doc || typeof doc !== "object") return doc;
  const schemas: Record<string, any> | undefined = doc.components?.schemas;
  if (!schemas || typeof schemas !== "object") return doc;

  // Step 1: Find all base schemas with discriminators
  const baseSchemasWithDiscriminator = new Map<string, { mapping: Record<string, string>; propertyName: string }>();

  for (const [name, schema] of Object.entries(schemas)) {
    if (schema && typeof schema === "object" && schema.discriminator) {
      const disc = schema.discriminator;
      if (disc.propertyName && disc.mapping && typeof disc.mapping === "object") {
        baseSchemasWithDiscriminator.set(name, {
          propertyName: disc.propertyName,
          mapping: { ...disc.mapping }
        });
      }
    }
  }

  if (baseSchemasWithDiscriminator.size === 0) {
    return doc; // Nothing to convert
  }

  // Step 2: For each base schema with discriminator, find concrete types extending it
  const inheritanceGraph = buildInheritanceGraph(schemas);
  const polymorphicWrappers = new Map<string, { name: string; concreteSchemas: string[] }>();


  for (const [baseName, discInfo] of baseSchemasWithDiscriminator.entries()) {
    const concreteSchemas: string[] = Array.from(inheritanceGraph.get(baseName) || []);
  
    if (opts.ignoreSingleSpecialization && concreteSchemas.length === 1) {
      continue;
    }

    if (concreteSchemas.length > 0) {
      const wrapperName = `${baseName}Polymorphic`;
      polymorphicWrappers.set(baseName, { name: wrapperName, concreteSchemas });

      // Step 3: For each concrete schema, optionally add const property for discriminator
      if (opts.addDiscriminatorConst !== false) {
        const cS = Object.fromEntries(
          concreteSchemas.map(name => [name, schemas[name]])
        );
        addDiscriminatorConstToConcreteSchemas(cS, discInfo);
      }

      // Step 4: Create wrapper schema with oneOf
      const wrapperSchema: any = {
        oneOf: concreteSchemas.map(name => ({ $ref: `#/components/schemas/${name}` })),
        discriminator: {
          propertyName: discInfo.propertyName,
          mapping: discInfo.mapping
        }
      };

      // If available, preserve description from base
      const baseSchema = schemas[baseName];
      if (baseSchema && baseSchema.description) {
        wrapperSchema.description = `OneOf polymorphic ${baseName}. Use the "${discInfo.propertyName}" property to identify the concrete schema.`;
      }

      schemas[wrapperName] = wrapperSchema;
    }
  }

  // Step 5: Replace references to base schemas with wrapper schemas where polymorphism is used
  // Preserve direct inheritance (allOf) references but rewrite everything else
  // Also track if base schema is actually used anywhere
  const wrappersToRemove = new Set<string>();
  const baseNamesWithoutWrappers = new Set<string>();
  
  for (const [baseName, wrapperInfo] of polymorphicWrappers.entries()) {
    const baseRef = `#/components/schemas/${baseName}`;
    const wrapperRef = `#/components/schemas/${wrapperInfo.name}`;

    // Check if base schema is used anywhere outside of allOf inheritance
    const isBaseUsed = isSchemaReferencedOutsideAllOf(doc, baseRef);
    
    if (!isBaseUsed) {
      // Base schema is not used in API - mark wrapper for removal
      wrappersToRemove.add(wrapperInfo.name);
      baseNamesWithoutWrappers.add(baseName);
      continue;
    }

    // In components.schemas we must keep allOf inheritance pointing at the base,
    // but other usages (e.g. Human.pets, Pack.members) should point to the wrapper.
    replaceInSchema(schemas, baseRef, wrapperRef, true);

    // In other document sections we can freely replace all occurrences.
    replaceInSchema(doc.paths, baseRef, wrapperRef, false);
    replaceInSchema(doc.webhooks, baseRef, wrapperRef, false);

    const components = doc.components;
    if (components && typeof components === "object") {
      // Shared components using schemas
      replaceInSchema(components.requestBodies, baseRef, wrapperRef, false);
      replaceInSchema(components.responses, baseRef, wrapperRef, false);
      replaceInSchema(components.parameters, baseRef, wrapperRef, false);
      // Callbacks and links can contain operations and request bodies using schemas
      replaceInCallbacks(components.callbacks, baseRef, wrapperRef);
      replaceInSchema(components.links, baseRef, wrapperRef, false);
      // Intentionally do NOT touch headers or examples
    }
  }

  // Remove polymorphic wrappers that have no clients
  for (const wrapperName of wrappersToRemove) {
    delete schemas[wrapperName];
  }
  
  // Remove from tracking map as well
  for (const baseName of baseNamesWithoutWrappers) {
    polymorphicWrappers.delete(baseName);
  }

  // Step 5b: Chain polymorphic wrappers.
  // If a wrapper's oneOf entry points at another polymorphic base, redirect it to that base's wrapper
  // so that top-level polymorphic wrappers expose nested polymorphic wrappers instead of raw bases.
  if (polymorphicWrappers.size > 1) {
    for (const [, wrapperInfo] of polymorphicWrappers.entries()) {
      const wrapperSchema = schemas[wrapperInfo.name];
      if (!wrapperSchema || !Array.isArray(wrapperSchema.oneOf)) continue;

      wrapperSchema.oneOf = wrapperSchema.oneOf.map((entry: any) => {
        if (!entry || typeof entry !== "object" || typeof entry.$ref !== "string") {
          return entry;
        }
        const targetName = refToName(entry.$ref || "");
        const nested = targetName ? polymorphicWrappers.get(targetName) : undefined;
        if (!nested) {
          return entry;
        }
        return { $ref: `#/components/schemas/${nested.name}` };
      });
    }
  }

  // Step 5c: Optionally merge nested oneOf schemas
  // If a oneOf references a schema that only contains oneOf (no other properties),
  // inline the referenced oneOf items into the parent oneOf
  if (opts.mergeNestedOneOf) {
    mergeNestedOneOfSchemas(schemas);
  }

  // Step 6: Always remove discriminator from base schemas that were converted
  for (const baseName of baseSchemasWithDiscriminator.keys()) {
    if (schemas[baseName] && polymorphicWrappers.has(baseName)) {
      delete schemas[baseName].discriminator;
    }
  }

  return doc;
}

/**
 * Recursively replace $ref in a schema, particularly in polymorphic contexts like array items.
 * When skipAllOfReplacement=true, skip replacing $ref directly within allOf arrays.
 */
function replaceInSchema(node: any, oldRef: string, newRef: string, skipDirectAllOfRefs: boolean = false): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (item && typeof item === "object") {
        replaceInSchema(item, oldRef, newRef, skipDirectAllOfRefs);
      }
    }
    return;
  }

  // For object properties, replace all $ref occurrences
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") {
      // Special handling for allOf: skip direct $ref replacements when requested
      if (skipDirectAllOfRefs && key === "allOf" && Array.isArray(value)) {
        for (const item of value) {
          if (!item || typeof item !== "object") continue;
          // Keep direct inheritance refs to the base inside allOf
          if (item.$ref === oldRef) {
            continue;
          }
          replaceInSchema(item, oldRef, newRef, skipDirectAllOfRefs);
        }
        continue;
      }

      if ((value as any).$ref === oldRef) {
        (value as any).$ref = newRef;
      }
      replaceInSchema(value, oldRef, newRef, skipDirectAllOfRefs);
    }
  }
}

/**
 * Replace references inside callback components.
 * A callback map has shape { [name]: { [expression]: PathItemObject } }.
 * We can reuse replaceInSchema on each PathItemObject.
 */
function replaceInCallbacks(callbacks: any, oldRef: string, newRef: string): void {
  if (!callbacks || typeof callbacks !== "object") return;
  // callbacks object shape is { [callbackName]: { [expression]: PathItemObject } }
  for (const cb of Object.values(callbacks)) {
    if (!cb || typeof cb !== "object") continue;
    for (const pathItem of Object.values(cb as any)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      // PathItemObject has operations, parameters, etc. We need to walk
      // operations (get/post/put/patch/delete/options/head/trace) so that
      // requestBody/ responses schemas are updated just like in paths.
      const opLike = pathItem as any;
      const operationKeys = [
        "get",
        "put",
        "post",
        "delete",
        "options",
        "head",
        "patch",
        "trace"
      ];

      for (const key of operationKeys) {
        const op = opLike[key];
        if (op && typeof op === "object") {
          replaceInSchema(op, oldRef, newRef, false);
        }
      }
    }
  }
}

/**
 * Add const constraint to each concrete schema matching the discriminator value.
 * Avoids duplicates by checking if the const constraint already exists.
 *
 * @param schemas - Concrete schemas extending a base with discriminator (name -> schema)
 * @param discInfo - Discriminator info (propertyName, mapping)
 */
function addDiscriminatorConstToConcreteSchemas(
  schemas: Record<string, any>,
  discInfo: { mapping: Record<string, string>; propertyName: string }
): void {
  // Iterate through concrete schemas by name
  for (const [concreteName, concreteSchema] of Object.entries(schemas)) {
    if (!concreteSchema) continue;

    // Find the discriminator value for this concrete schema
    let discriminatorValue: string | undefined;
    for (const [value, ref] of Object.entries(discInfo.mapping)) {
      if (typeof ref === "string" && refToName(ref) === concreteName) {
        discriminatorValue = value;
        break;
      }
    }

    if (discriminatorValue) {
      // Ensure allOf exists
      if (!Array.isArray(concreteSchema.allOf)) {
        concreteSchema.allOf = [];
      }

      // Check if const constraint already exists for this schema
      const constExists = concreteSchema.allOf.some(
        (item: any) =>
          item &&
          typeof item === "object" &&
          item.type === "object" &&
          item.properties &&
          item.properties[discInfo.propertyName] &&
          item.properties[discInfo.propertyName].const === discriminatorValue
      );

      // Only add const if it doesn't already exist
      if (!constExists) {
        // Add const as a separate allOf constraint (not merged with existing inline objects)
        const constConstraint: any = {
          type: "object",
          properties: {
            [discInfo.propertyName]: {
              const: discriminatorValue
            }
          }
        };
        concreteSchema.allOf.push(constConstraint);
      }
    }
  }
}

/**
 * Merge nested oneOf schemas by inlining references to schemas that only contain oneOf.
 * This optimizes cases where a oneOf references another schema that is purely a oneOf wrapper.
 * 
 * @param schemas - All schemas in the document
 */
function mergeNestedOneOfSchemas(schemas: Record<string, any>): void {
  if (!schemas || typeof schemas !== "object") return;

  // Identify schemas that are "simple oneOf wrappers" (only have oneOf, discriminator, description)
  const simpleOneOfSchemas = new Set<string>();
  
  for (const [name, schema] of Object.entries(schemas)) {
    if (isSimpleOneOfSchema(schema)) {
      simpleOneOfSchemas.add(name);
    }
  }

  if (simpleOneOfSchemas.size === 0) return;

  // Process each schema that has oneOf
  for (const schema of Object.values(schemas)) {
    if (!schema || typeof schema !== "object" || !Array.isArray(schema.oneOf)) {
      continue;
    }

    let modified = false;
    const newOneOf: any[] = [];
    const mergedMappings: Record<string, string> = {};

    // Check each oneOf entry
    for (const entry of schema.oneOf) {
      if (!entry || typeof entry !== "object" || typeof entry.$ref !== "string") {
        newOneOf.push(entry);
        continue;
      }

      const refName = refToName(entry.$ref);
      if (!refName || !simpleOneOfSchemas.has(refName)) {
        newOneOf.push(entry);
        continue;
      }

      // This references a simple oneOf schema - inline it
      const referencedSchema = schemas[refName];
      if (referencedSchema && Array.isArray(referencedSchema.oneOf)) {
        // Add all items from the referenced oneOf
        newOneOf.push(...referencedSchema.oneOf);
        
        // Merge discriminator mappings
        if (referencedSchema.discriminator?.mapping) {
          Object.assign(mergedMappings, referencedSchema.discriminator.mapping);
        }
        
        modified = true;
      } else {
        newOneOf.push(entry);
      }
    }

    if (modified) {
      // Remove duplicates from oneOf (same $ref)
      const seen = new Set<string>();
      schema.oneOf = newOneOf.filter((entry: any) => {
        if (!entry?.$ref) return true;
        if (seen.has(entry.$ref)) return false;
        seen.add(entry.$ref);
        return true;
      });

      // Merge discriminator mappings
      if (Object.keys(mergedMappings).length > 0) {
        if (!schema.discriminator) {
          schema.discriminator = { propertyName: "type", mapping: {} };
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
 * Check if a schema is a "simple oneOf wrapper" - only contains oneOf and optionally discriminator/description.
 * These schemas are candidates for inlining.
 */
function isSimpleOneOfSchema(schema: any): boolean {
  if (!schema || typeof schema !== "object") return false;
  if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) return false;

  // Check that schema ONLY has oneOf, discriminator, and/or description
  const allowedKeys = new Set(['oneOf', 'discriminator', 'description']);
  const schemaKeys = Object.keys(schema);
  
  for (const key of schemaKeys) {
    if (!allowedKeys.has(key)) {
      return false;
    }
  }

  // Must not have allOf, properties, or other schema-defining properties
  if (schema.allOf || schema.properties || schema.type || schema.anyOf) {
    return false;
  }

  return true;
}
