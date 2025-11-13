import { refToName, buildInheritanceGraph } from "./oasUtils.js";


export interface AllOfToOneOfOptions {
  /** If true, remove discriminator from base schema and let oneOf wrapper handle it */
  removeDiscriminatorFromBase?: boolean;
  /** If true, add const property with discriminator value to specialization schemas (default: true) */
  addDiscriminatorConst?: boolean;
  /** If true, skip oneOf transformation if only one specialization is found (default: false) */
  ignoreSingleSpecialization?: boolean;
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
  // We need to find where base schemas are referenced and check if they're used polymorphically
  for (const [baseName, wrapperInfo] of polymorphicWrappers.entries()) {
    replacePolymorhicReferences(schemas, baseName, wrapperInfo.name);
  }

  // Step 6: Optionally remove discriminator from base schemas
  if (opts.removeDiscriminatorFromBase) {
    for (const baseName of baseSchemasWithDiscriminator.keys()) {
      if (schemas[baseName] && polymorphicWrappers.has(baseName)) {
        delete schemas[baseName].discriminator;
      }
    }
  }

  return doc;
}

/**
 * Replace references to a polymorphic base schema with references to its wrapper,
 * but only in contexts where polymorphism would be used (e.g., in array items).
 * Excludes references within concrete schemas' direct allOf references.
 */
function replacePolymorhicReferences(
  schemas: Record<string, any>,
  baseName: string,
  wrapperName: string
): void {
  const baseRef = `#/components/schemas/${baseName}`;
  const wrapperRef = `#/components/schemas/${wrapperName}`;

  for (const schema of Object.values(schemas)) {
    if (!schema || typeof schema !== "object") continue;
    replaceInSchema(schema, baseRef, wrapperRef, true);
  }
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
        if (item.$ref === oldRef) {
          // Don't replace direct $ref in allOf when flag is set
          if (skipDirectAllOfRefs) {
            continue;
          }
          item.$ref = newRef;
        } else {
          replaceInSchema(item, oldRef, newRef, skipDirectAllOfRefs);
        }
      }
    }
    return;
  }

  // For object properties, replace all $ref occurrences
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") {
      // Special handling for allOf: skip direct $ref replacements
      if (skipDirectAllOfRefs && key === "allOf" && Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && item.$ref !== oldRef) {
            replaceInSchema(item, oldRef, newRef, skipDirectAllOfRefs);
          }
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
