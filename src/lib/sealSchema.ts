import { refToName } from "./oasUtils.js";

export interface SealSchemaOptions {
  /** If true, use unevaluatedProperties: false instead of additionalProperties: false (default: true) */
  useUnevaluatedProperties?: boolean;
}

/**
 * Seal OpenAPI/JSON Schema objects to prevent additional properties.
 *
 * This ensures every final object shape exposed in the API is sealed (no additional properties allowed),
 * without breaking schemas that are extended via allOf.
 *
 * Algorithm:
 * 1. Index the schema and identify all $ref usages (extension vs direct)
 * 2. Classify object-type schemas (pre-sealed, core-candidate, direct-only)
 * 3. For core-candidates: create Core variant + sealed wrapper
 * 4. Rewrite refs inside allOf to point to Core variants
 * 5. Seal composition roots (allOf/anyOf/oneOf) and direct objects
 *
 * @param doc - OpenAPI document to transform
 * @param opts - Optional configuration
 */
export function sealSchema(doc: any, opts: SealSchemaOptions = {}): any {
  if (!doc || typeof doc !== "object") return doc;

  const useUnevaluated = opts.useUnevaluatedProperties !== false;
  const sealing = useUnevaluated ? "unevaluatedProperties" : "additionalProperties";

  const schemas: Record<string, any> | undefined = doc.components?.schemas;
  if (!schemas || typeof schemas !== "object") return doc;

  // Step 1: Find all schemas referenced in allOf (core candidates)
  const referencedInAllOf = new Set<string>();
  for (const schema of Object.values(schemas)) {
    if (!schema || typeof schema !== "object") continue;
    if (!Array.isArray(schema.allOf)) continue;

    for (const item of schema.allOf) {
      if (item && typeof item === "object" && typeof (item as any).$ref === "string") {
        const refName = refToName((item as any).$ref);
        if (refName && schemas[refName]) {
          referencedInAllOf.add(refName);
        }
      }
    }
  }

  // Step 2: Classify and create Core variants for core-candidates
  const coreMapping = new Map<string, string>(); // original -> core name
  for (const name of referencedInAllOf) {
    const schema = schemas[name];
    if (
      schema &&
      typeof schema === "object" &&
      !isPreSealed(schema) &&
      isObjectLike(schema)
    ) {
      const coreName = `${name}Core`;
      coreMapping.set(name, coreName);

      // Clone original schema as Core (without sealing keywords)
      const coreSchema = deepClone(schema);
      removeSealing(coreSchema);

      // Replace original with sealed wrapper
      const wrapper: any = {
        allOf: [{ $ref: `#/components/schemas/${coreName}` }],
      };
      wrapper[sealing] = false;

      // Preserve description if present in original
      if (coreSchema.description) {
        wrapper.description = coreSchema.description;
        delete coreSchema.description; // Remove from core to avoid duplication
      }

      schemas[coreName] = coreSchema;
      schemas[name] = wrapper;
    }
  }

  // Step 3: Rewrite references inside allOf to point to Core variants
  for (const [originalName, coreName] of coreMapping.entries()) {
    updateAllOfReferences(schemas, originalName, coreName);
  }

  // Step 4: Seal composition roots and direct-only objects
  for (const [name, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== "object") continue;

    // Skip if already sealed
    if (schema[sealing] === false || schema.additionalProperties === false) {
      continue;
    }

    // Check if this is a wrapper we created (single-item allOf pointing to Core)
    const isWrapper =
      schema.allOf &&
      schema.allOf.length === 1 &&
      typeof (schema.allOf[0] as any).$ref === "string" &&
      (schema.allOf[0] as any).$ref.includes("Core");

    // Seal composition roots (allOf/anyOf/oneOf) - except wrappers we just created
    if (
      !isWrapper &&
      (schema.allOf || schema.anyOf || schema.oneOf) &&
      isObjectLike(schema)
    ) {
      schema[sealing] = false;
    } else if (!coreMapping.has(name) && isObjectLike(schema) && !name.endsWith("Core")) {
      // Seal direct-only object schemas (not core-candidates and not cores themselves)
      schema[sealing] = false;
    }
  }

  // Step 5: Recursively seal inline object schemas
  sealInlineSchemas(schemas, sealing);

  return doc;
}

/**
 * Update all allOf references from original schema to core schema.
 */
function updateAllOfReferences(
  schemas: Record<string, any>,
  originalName: string,
  coreName: string
): void {
  const originalRef = `#/components/schemas/${originalName}`;
  const coreRef = `#/components/schemas/${coreName}`;

  for (const schema of Object.values(schemas)) {
    if (!schema || typeof schema !== "object") continue;
    if (!Array.isArray(schema.allOf)) continue;

    for (const item of schema.allOf) {
      if (item && typeof item === "object" && (item as any).$ref === originalRef) {
        (item as any).$ref = coreRef;
      }
    }
  }
}

/**
 * Recursively seal inline object schemas (properties, items, etc.).
 */
function sealInlineSchemas(schemas: Record<string, any>, sealing: string): void {
  const sealRecursive = (obj: any): void => {
    if (!obj || typeof obj !== "object") return;

    if (isObjectLike(obj) && !isPreSealed(obj)) {
      const hasComposition = Boolean(obj.allOf || obj.anyOf || obj.oneOf);
      const hasRef = Boolean(findRefsInObject(obj).length > 0);

      // Seal inline object if it's not just a reference/composition
      if (!hasRef && !hasComposition) {
        obj[sealing] = false;
      }
    }

    // Recurse into properties
    if (obj.properties && typeof obj.properties === "object") {
      for (const prop of Object.values(obj.properties)) {
        sealRecursive(prop);
      }
    }

    // Recurse into items
    if (obj.items && typeof obj.items === "object") {
      sealRecursive(obj.items);
    }

    // Recurse into allOf/anyOf/oneOf
    if (Array.isArray(obj.allOf)) {
      for (const item of obj.allOf) {
        sealRecursive(item);
      }
    }
    if (Array.isArray(obj.anyOf)) {
      for (const item of obj.anyOf) {
        sealRecursive(item);
      }
    }
    if (Array.isArray(obj.oneOf)) {
      for (const item of obj.oneOf) {
        sealRecursive(item);
      }
    }

    // Recurse into additionalProperties
    if (obj.additionalProperties && typeof obj.additionalProperties === "object") {
      sealRecursive(obj.additionalProperties);
    }
  };

  for (const schema of Object.values(schemas)) {
    sealRecursive(schema);
  }
}

/**
 * Check if a schema is object-like.
 * This includes schemas that have type: "object", explicit properties, or composition keywords (which implicitly compose objects).
 */
function isObjectLike(schema: any): boolean {
  if (!schema || typeof schema !== "object") return false;
  return (
    schema.type === "object" ||
    Boolean(schema.properties) ||
    Boolean(schema.allOf) ||
    Boolean(schema.anyOf) ||
    Boolean(schema.oneOf)
  );
}

/**
 * Check if a schema is already sealed.
 */
function isPreSealed(schema: any): boolean {
  if (!schema || typeof schema !== "object") return false;
  return (
    schema.additionalProperties === false ||
    schema.unevaluatedProperties === false
  );
}

/**
 * Remove sealing keywords from a schema.
 */
function removeSealing(schema: any): void {
  if (schema && typeof schema === "object") {
    delete schema.additionalProperties;
    delete schema.unevaluatedProperties;
  }
}

/**
 * Deep clone an object.
 */
function deepClone(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => deepClone(item));
  if (obj instanceof Date) return new Date(obj.getTime());
  const cloned: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

/**
 * Find all $ref entries in an object (non-recursive for direct refs).
 */
function findRefsInObject(obj: any): string[] {
  if (!obj || typeof obj !== "object") return [];
  const refs: string[] = [];
  if (typeof (obj as any).$ref === "string") {
    refs.push((obj as any).$ref);
  }
  return refs;
}
