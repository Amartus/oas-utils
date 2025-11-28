import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resourcesDir = path.join(__dirname, "resources");
const commonDir = path.join(resourcesDir, "common");
const sealSchemaDir = path.join(resourcesDir, "sealSchema");

/**
 * Load a schema from a JSON file. 
 * First tries resources/common/, then resources/sealSchema/
 */
export function loadSchemaFromFile(filename: string): any {
  // Try common directory first (for core entity schemas)
  const commonPath = path.join(commonDir, `${filename}.json`);
  if (fs.existsSync(commonPath)) {
    const content = fs.readFileSync(commonPath, "utf-8");
    return JSON.parse(content);
  }
  
  // Fall back to sealSchema directory (for test-specific fixtures)
  const sealSchemaPath = path.join(sealSchemaDir, `${filename}.json`);
  if (fs.existsSync(sealSchemaPath)) {
    const content = fs.readFileSync(sealSchemaPath, "utf-8");
    return JSON.parse(content);
  }
  
  throw new Error(`Schema file not found: ${filename}`);
}

/**
 * Deep clone a schema
 */
function deepClone(obj: any): any {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Modify a schema by removing properties
 */
export function withoutProperties(schema: any, propertiesToRemove: string[]): any {
  const result = deepClone(schema);
  if (result.properties) {
    propertiesToRemove.forEach((prop) => {
      delete result.properties[prop];
    });
  }
  return result;
}

/**
 * Add properties to a schema
 */
export function withProperties(schema: any, newProperties: Record<string, any>): any {
  const result = deepClone(schema);
  if (!result.properties) {
    result.properties = {};
  }
  result.properties = { ...result.properties, ...newProperties };
  return result;
}

/**
 * Add description to a schema
 */
export function withDescription(schema: any, description: string): any {
  const result = deepClone(schema);
  result.description = description;
  return result;
}

/**
 * Add metadata (title, required, examples) to a schema
 */
export function withMetadata(schema: any, metadata: Record<string, any>): any {
  const result = deepClone(schema);
  return { ...result, ...metadata };
}

/**
 * Seal a schema (add unevaluatedProperties or additionalProperties)
 */
export function sealed(schema: any, useUnevaluated = true): any {
  const result = deepClone(schema);
  if (useUnevaluated) {
    result.unevaluatedProperties = false;
  } else {
    result.additionalProperties = false;
  }
  return result;
}

/**
 * Load multiple schemas from JSON files
 */
export function loadSchemasFromFiles(
  filenames: Record<string, string>
): Record<string, any> {
  const schemas: Record<string, any> = {};
  for (const [schemaName, filename] of Object.entries(filenames)) {
    schemas[schemaName] = loadSchemaFromFile(filename);
  }
  return schemas;
}

/**
 * Delete a property identified by a JSON Pointer string from the given object.
 * Uses json-p3's JSONPointer helper to resolve the parent and remove the property.
 */
import { JSONPointer } from "json-p3";

export function deleteByPointer(root: any, pointer: string): void {
  const p = new JSONPointer(pointer);
  const parent = p.parent().resolve(root, undefined as any);
  const segs = p.toString().split("/").slice(1);
  const last = decodeURIComponent(segs[segs.length - 1]);
  if (parent && typeof parent === "object" && Object.prototype.hasOwnProperty.call(parent, last)) {
    delete (parent as any)[last];
  }
}

/**
 * Common test schemas for reuse across all tests
 */
export const testSchemas = {
  // Simple objects (used in various graph/inheritance tests)
  simpleId: () => ({ type: "object", properties: { id: { type: "string" } } }),
  simpleType: () => ({ type: "object", properties: { type: { type: "string" } } }),
  simpleTypeWithMapping: (mapping: Record<string, string>) => ({
    type: "object",
    properties: { type: { type: "string" } },
    discriminator: { propertyName: "type", mapping },
  }),
  
  // Animal schemas - loaded from JSON files for consistency
  animal: () => loadSchemaFromFile("animal"),
  cat: () => loadSchemaFromFile("cat"),
  dog: () => loadSchemaFromFile("dog"),
  person: () => loadSchemaFromFile("person"),
  
  // Food schema (used in composition tests)
  food: () => loadSchemaFromFile("pet-food"),
  
  // Result schemas
  baseResult: () => loadSchemaFromFile("base-result"),
  result: () => loadSchemaFromFile("result"),
  
  // Utility helpers for building schemas
  withAllOfRef: (ref: string, inline?: Record<string, any>) => ({
    allOf: [
      { $ref: `#/components/schemas/${ref}` },
      ...(inline ? [inline] : []),
    ],
  }),
  
  withOneOfRefs: (...refs: string[]) => ({
    oneOf: refs.map((ref) => ({ $ref: `#/components/schemas/${ref}` })),
  }),
  
  withAnyOfRefs: (...refs: string[]) => ({
    anyOf: refs.map((ref) => ({ $ref: `#/components/schemas/${ref}` })),
  }),

  // Animal base schema with rich properties for polymorphic tests
  animalWithDiscriminator: (mapping: Record<string, string> = {}) => {
    const schema = loadSchemaFromFile("animal");
    if (mapping && Object.keys(mapping).length > 0) {
      schema.discriminator = {
        ...schema.discriminator,
        mapping
      };
    }
    return schema;
  },

  // Cat schema (specialization extending Animal)
  catSpecialized: () => loadSchemaFromFile("cat"),

  // Dog schema (specialization extending Animal)
  dogSpecialized: (overrideProps?: Record<string, any>) => {
    const baseSchema = loadSchemaFromFile("dog");
    if (overrideProps && baseSchema.allOf && baseSchema.allOf[1]) {
      baseSchema.allOf[1].properties = { ...baseSchema.allOf[1].properties, ...overrideProps };
    }
    return baseSchema;
  },

  // Vehicle base schema with discriminator (alternative polymorphic pattern)
  vehicleWithDiscriminator: (mapping: Record<string, string> = {}) => {
    const schema = loadSchemaFromFile("vehicle");
    if (mapping && Object.keys(mapping).length > 0) {
      schema.discriminator = {
        ...schema.discriminator,
        mapping
      };
    }
    return schema;
  },

  // Car schema (specialization extending Vehicle)
  carSpecialized: () => loadSchemaFromFile("car"),

  // Pet schema (intermediate extending Animal with owner) - used in multi-level inheritance tests
  petIntermediate: () => loadSchemaFromFile("pet-intermediate"),
};
