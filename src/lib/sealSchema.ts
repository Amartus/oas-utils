import { 
  refToName, 
  documentSupportsUnevaluatedProperties,
  getOpenApiVersion,
  getJsonSchemaVersion,
  upgradeToOas31,
  upgradeJsonSchemaToDraft201909
} from "./oasUtils.js";

import { JSONPath } from "jsonpath-plus";
import { extractDefRefName } from "./jsonSchemaUtils.js";

export interface SealSchemaOptions {
  /** If true, use unevaluatedProperties: false instead of additionalProperties: false (default: true) */
  useUnevaluatedProperties?: boolean;
  /** If true, automatically upgrade OpenAPI/JSON Schema version to support unevaluatedProperties (default: false) */
  uplift?: boolean;
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
 * @param doc - OpenAPI document or standalone JSON Schema to transform
 * @param opts - Optional configuration
 */
export function sealSchema(doc: any, opts: SealSchemaOptions = {}): any {
  if (!doc || typeof doc !== "object") return doc;

  const useUnevaluated = opts.useUnevaluatedProperties !== false;
  const sealing = useUnevaluated ? "unevaluatedProperties" : "additionalProperties";

  // Check if this is a standalone JSON Schema (not an OpenAPI document)
  const isStandalone = isStandaloneJsonSchema(doc);

  // Check if using unevaluatedProperties and validate version compatibility
  if (useUnevaluated) {
    const oasVersion = getOpenApiVersion(doc);
    const schemaVersion = getJsonSchemaVersion(doc);
    
    // Only validate if there's an explicit version specified
    const hasExplicitVersion = oasVersion || schemaVersion;
    
    if (hasExplicitVersion) {
      const isCompatible = documentSupportsUnevaluatedProperties(doc);
      
      if (!isCompatible) {
        if (opts.uplift) {
          // Automatically upgrade the version
          if (oasVersion) {
            upgradeToOas31(doc);
            console.warn(
              `[SEAL-SCHEMA] Upgraded OpenAPI version from ${oasVersion} to 3.1.0 to support unevaluatedProperties.`
            );
          } else if (schemaVersion) {
            upgradeJsonSchemaToDraft201909(doc);
            console.warn(
              `[SEAL-SCHEMA] Upgraded JSON Schema to draft 2019-09 to support unevaluatedProperties.`
            );
          }
        } else {
          // Error if uplift is not enabled
          const versionInfo = oasVersion 
            ? `OpenAPI ${oasVersion}` 
            : `JSON Schema ${schemaVersion}`;
          
          throw new Error(
            `unevaluatedProperties is only supported in OpenAPI 3.1+ or JSON Schema 2019-09+. ` +
            `Current document uses ${versionInfo}. ` +
            `Use --uplift option to automatically upgrade the version, or use --use-additional-properties instead.`
          );
        }
      }
    } else if (opts.uplift && isStandalone) {
      // If no version and it's a standalone schema, set it when uplift is enabled
      upgradeJsonSchemaToDraft201909(doc);
      console.warn(
        `[SEAL-SCHEMA] Set JSON Schema version to draft 2019-09 to support unevaluatedProperties.`
      );
    }
  }

  // Additional check: when using `additionalProperties:false` (i.e. not using
  // unevaluatedProperties) we must ensure that sealing will actually cover
  // composed schemas. In OpenAPI 3.0 and JSON Schema drafts before 2019-09,
  // `additionalProperties: false` does NOT apply across `allOf` composition in
  // a way that reliably seals extended models. If the document contains any
  // schema using `allOf` compositions referencing other schemas, sealing with
  // `additionalProperties:false` may be ineffective. In that case we should
  // throw an error unless `useUnevaluatedProperties` is true or `uplift` is set
  // (to upgrade the document to a version that supports `unevaluatedProperties`).
  if (!useUnevaluated) {
    validateAdditionalPropertiesCompatibility(doc);
  }


/**
 * Determine whether the provided document contains any schemas that use
 * `allOf` referencing other schemas (simple $ref in allOf entries).
 */
function documentContainsAllOfRefs(doc: any): boolean {
  // Use JSONPath to find any allOf entries that contain a $ref anywhere in the document
  try {
    const matches = JSONPath({ path: "$..allOf[*].$ref", json: doc });
    return Array.isArray(matches) && matches.length > 0;
  } catch (e) {
    // If JSONPath fails for some reason, fall back to conservative false
    return false;
  }
}


/**
 * Validate that attempting to seal using `additionalProperties:false` is
 * compatible with the document's declared OpenAPI/JSON Schema version. Throw
 * a descriptive error when an explicit older version is present and the
 * document contains allOf references that would make sealing ineffective.
 */
function validateAdditionalPropertiesCompatibility(doc: any): void {
  const oasVersion = getOpenApiVersion(doc);
  const schemaVersion = getJsonSchemaVersion(doc);
  const hasExplicitVersion = oasVersion || schemaVersion;

  if (hasExplicitVersion && documentContainsAllOfRefs(doc)) {
    const versionInfo = oasVersion ? `OpenAPI ${oasVersion}` : `JSON Schema ${schemaVersion}`;
    throw new Error(
      `Sealing via additionalProperties:false cannot reliably cover schemas composed with allOf in ${versionInfo}. ` +
      `Use --use-unevaluated-properties or enable --uplift to upgrade the document to a version that supports unevaluatedProperties.`
    );
  }
}
  
  let schemas: Record<string, any> | undefined;
  let wrappedName: string = "";

  if (isStandalone) {
    // Wrap the standalone schema in an OpenAPI structure
    wrappedName = doc.title || "Root";
    schemas = {};
    schemas[wrappedName] = doc;
  } else {
    schemas = doc.components?.schemas;
  }

  if (!schemas || typeof schemas !== "object") return doc;

  // Handle each schema's $defs and definitions (for JSON Schema models)
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (schema && typeof schema === "object") {
      if (schema.$defs && typeof schema.$defs === "object") {
        sealNestedSchemas(schema, "$defs", sealing);
      }
      if (schema.definitions && typeof schema.definitions === "object") {
        sealNestedSchemas(schema, "definitions", sealing);
      }
    }
  }

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

    // Only seal if there's sealable content (properties or composition)
    if (!hasSealableContent(schema)) {
      continue;
    }

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

  // If this was a standalone schema, extract and return it
  if (wrappedName && isStandalone) {
    return schemas[wrappedName];
  }

  return doc;
}

/**
 * Recursively seal nested schemas within a schema.
 * This handles JSON Schema models that contain nested subschemas in $defs or definitions.
 */
function sealNestedSchemas(schema: any, defsKey: "$defs" | "definitions", sealing: string): void {
  if (!schema || typeof schema !== "object" || !schema[defsKey]) return;

  const defs = schema[defsKey];

  // Step 1: Find all schemas referenced in allOf within $defs
  const referencedInAllOf = new Set<string>();
  for (const def of Object.values(defs)) {
    if (!def || typeof def !== "object") continue;
    const defAny = def as any;
    if (!Array.isArray(defAny.allOf)) continue;

    for (const item of defAny.allOf) {
      if (item && typeof item === "object" && typeof (item as any).$ref === "string") {
        const refName = extractDefRefName((item as any).$ref);
        if (refName && defs[refName]) {
          referencedInAllOf.add(refName);
        }
      }
    }
  }

  // Step 2: Create Core variants for schemas referenced in allOf
  const coreMapping = new Map<string, string>();
  for (const name of referencedInAllOf) {
    const def = defs[name];
    if (
      def &&
      typeof def === "object" &&
      !isPreSealed(def) &&
      isObjectLike(def)
    ) {
      const coreName = `${name}Core`;
      coreMapping.set(name, coreName);

      const coreSchema = deepClone(def);
      removeSealing(coreSchema);

      const refPath = defsKey === "$defs" ? `#/$defs/${coreName}` : `#/definitions/${coreName}`;
      const wrapper: any = {
        allOf: [{ $ref: refPath }],
      };
      wrapper[sealing] = false;

      const coreSchemaAny = coreSchema as any;
      if (coreSchemaAny.description) {
        wrapper.description = coreSchemaAny.description;
        delete coreSchemaAny.description;
      }

      defs[coreName] = coreSchema;
      defs[name] = wrapper;
    }
  }

  // Step 3: Rewrite references inside allOf to point to Core variants
  for (const [originalName, coreName] of coreMapping.entries()) {
    updateNestedAllOfReferences(defs, originalName, coreName, defsKey);
  }

  // Step 4: Seal composition roots and direct-only objects in $defs
  for (const [name, def] of Object.entries(defs)) {
    if (!def || typeof def !== "object") continue;

    const defAny = def as any;
    if (defAny[sealing] === false || defAny.additionalProperties === false) {
      continue;
    }

    const isWrapper =
      defAny.allOf &&
      defAny.allOf.length === 1 &&
      typeof (defAny.allOf[0] as any).$ref === "string" &&
      (defAny.allOf[0] as any).$ref.includes("Core");

    // Only seal if there's sealable content
    if (!hasSealableContent(def)) {
      continue;
    }

    if (!isWrapper && (defAny.allOf || defAny.anyOf || defAny.oneOf) && isObjectLike(def)) {
      defAny[sealing] = false;
    } else if (!coreMapping.has(name) && isObjectLike(def) && !name.endsWith("Core")) {
      defAny[sealing] = false;
    }
  }

  // Step 5: Recursively seal inline schemas in $defs
  sealInlineSchemas(defs, sealing);

  // Step 6: Seal the root schema itself if it has sealable content
  if (hasSealableContent(schema) && isObjectLike(schema) && !isPreSealed(schema)) {
    schema[sealing] = false;
  }
}

/**
 * Update all allOf references in nested schemas from original schema to core schema.
 */
function updateNestedAllOfReferences(
  defs: Record<string, any>,
  originalName: string,
  coreName: string,
  defsKey: "$defs" | "definitions"
): void {
  const refPrefix = defsKey === "$defs" ? "#/$defs" : "#/definitions";
  const originalRef = `${refPrefix}/${originalName}`;
  const coreRef = `${refPrefix}/${coreName}`;

  // Use JSONPath to find all matching allOf entries with the originalRef and update them
  try {
    const query = `$.${defsKey}..allOf[?(@.$ref=='${originalRef}')]`;
    const pointers: string[] = JSONPath({ path: query, json: { [defsKey]: defs }, resultType: 'pointer' }) as string[];
    for (const ptr of pointers) {
      // pointer points to the matching allOf item; we need to set its $ref to coreRef
      setJsonPointer({ [defsKey]: defs }, ptr + '/$ref', coreRef);
    }
  } catch (e) {
    // Fallback to original loop if JSONPath fails
    for (const def of Object.values(defs)) {
      if (!def || typeof def !== "object") continue;
      if (!Array.isArray((def as any).allOf)) continue;

      for (const item of (def as any).allOf) {
        if (item && typeof item === "object" && (item as any).$ref === originalRef) {
          (item as any).$ref = coreRef;
        }
      }
    }
  }
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

  try {
    const query = `$.components.schemas..allOf[?(@.$ref=='${originalRef}')]`;
    const pointers: string[] = JSONPath({ path: query, json: { components: { schemas } }, resultType: 'pointer' }) as string[];
    for (const ptr of pointers) {
      setJsonPointer({ components: { schemas } }, ptr + '/$ref', coreRef);
    }
  } catch (e) {
    // Fallback to original loop
    for (const schema of Object.values(schemas)) {
      if (!schema || typeof schema !== "object") continue;
      if (!Array.isArray((schema as any).allOf)) continue;

      for (const item of (schema as any).allOf) {
        if (item && typeof item === "object" && (item as any).$ref === originalRef) {
          (item as any).$ref = coreRef;
        }
      }
    }
  }
}


/**
 * Set a value in an object using a JSON Pointer string (e.g. '/a/0/b').
 */
function setJsonPointer(root: any, pointer: string, value: any): void {
  if (!pointer || pointer === "") return;
  // pointer is returned from jsonpath-plus as a JSON Pointer starting with '/'
  const parts = pointer.split('/').slice(1).map(unescapePointer);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!(key in cur)) return; // unexpected shape
    cur = cur[key];
    if (cur === undefined || cur === null) return;
  }
  const last = parts[parts.length - 1];
  cur[last] = value;
}

function unescapePointer(part: string): string {
  return part.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Recursively seal inline object schemas (properties, items, etc.).
 */
function sealInlineSchemas(schemas: Record<string, any>, sealing: string): void {
  const sealRecursive = (obj: any): void => {
    if (!obj || typeof obj !== "object") return;

    if (isObjectLike(obj) && !isPreSealed(obj) && hasSealableContent(obj)) {
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
 * Check if a schema has sealable content (properties or composition keywords).
 * This ensures we only seal schemas that actually define object structure.
 */
function hasSealableContent(schema: any): boolean {
  if (!schema || typeof schema !== "object") return false;
  return (
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

/**
 * Check if a document is a standalone JSON Schema (not an OpenAPI document).
 * A standalone schema has schema properties like $schema, type, properties, etc.
 * but does NOT have the OpenAPI structure (info, paths, components.schemas).
 */
function isStandaloneJsonSchema(doc: any): boolean {
  if (!doc || typeof doc !== "object") return false;

  // If it has the OpenAPI structure, it's not a standalone schema
  if (doc.openapi || doc.swagger || doc.info || doc.paths) {
    return false;
  }

  // If it has components.schemas, it's an OpenAPI doc
  if (doc.components?.schemas) {
    return false;
  }

  // Check for JSON Schema indicators
  const hasSchemaIndicators =
    doc.type !== undefined ||
    doc.properties !== undefined ||
    doc.$schema !== undefined ||
    doc.title !== undefined ||
    doc.description !== undefined ||
    doc.required !== undefined ||
    doc.allOf !== undefined ||
    doc.anyOf !== undefined ||
    doc.oneOf !== undefined ||
    doc.$defs !== undefined ||
    doc.definitions !== undefined;

  return hasSchemaIndicators;
}
