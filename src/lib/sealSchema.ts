// Single clean scaffold file — public API preserved and helpers stubbed.
import { JSONPath } from "jsonpath-plus";
import {
  documentSupportsUnevaluatedProperties,
  getOpenApiVersion,
  getJsonSchemaVersion,
  upgradeToOas31,
  upgradeJsonSchemaToDraft201909,
} from "./oasUtils.js";


import jsonPatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';

const { applyPatch } = jsonPatch;


export interface SealSchemaOptions {
  useUnevaluatedProperties?: boolean;
  uplift?: boolean;
  exclude?: string[];
  forceSealing?: boolean;
}


interface Mappings {
  orginalRef: string;
  wrapperRef: string;
  declarationPointers: string[];
}

const isAllOf = (prop: string): boolean => {
  return prop.split("/").at(-2) === "allOf";
}

/**
 * Scaffolded sealSchema - returns the document unchanged.
 */
export function sealSchema(doc: any, opts: SealSchemaOptions = {}): any {
  const useUnevaluated = opts.useUnevaluatedProperties !== false;
  const sealing = useUnevaluated ? "unevaluatedProperties" : "additionalProperties";

  const supportsUnevaluated = documentSupportsUnevaluatedProperties(doc);
  const containsAllOfRefs = documentContainsAllOfRefs(doc);

  const requiresUplift = !supportsUnevaluated && (useUnevaluated || containsAllOfRefs);

  if (requiresUplift) {
    const versionInfo = versionStr(doc, "OpenAPI") || versionStr(doc, "JSON Schema");
    if (!useUnevaluated) {
      throw new Error(
        `Sealing via additionalProperties:false cannot reliably cover schemas composed with allOf in ${versionInfo}. ` +
        `Use --use-unevaluated-properties or enable --uplift to upgrade the document to a version that supports unevaluatedProperties.`
      );
    }

    if (opts.uplift === true || versionInfo === undefined) {
      doc = upliftDocument(doc);
    } else {
      throwUpliftError(versionInfo);
    }
  }

  const exclude = opts.exclude ?? [];
  const forceSealing = opts.forceSealing ?? false;

  const allProps = find(doc, "$..properties");
  const allRefs = toReverseMap(find(doc, `$..[?(@['$ref'])]`));
  const allOfSchemas = find(doc, "$..allOf");


  const toSealSingle = filter(allProps, allRefs, exclude);
  const toSealCompositions = filterCompositions(allOfSchemas, allRefs, exclude);
  const toMap = calculateMappings(allRefs, doc, exclude, forceSealing);

  for (const prop of toSealSingle) {
    if (isExplicitlyOpen(prop.parent)) {
      if (forceSealing) {
        prop.parent[sealing] = false;
      } else {
        const schemaPath = JSONPath.toPathArray(prop.path).slice(0, -1);
        const schemaPointer = JSONPath.toPointer(schemaPath);
        const name = schemaNameFromPointer(schemaPointer) ?? schemaPointer;
        console.warn(
          `[SEAL-SCHEMA] Schema "${name}" has additionalProperties/unevaluatedProperties set to true (explicitly open). Skipping sealing. Use forceSealing option to override.`
        );
      }
    } else if (!isAlreadySealed(prop.parent)) {
      prop.parent[sealing] = false;
    }
  }

  for (const comp of toSealCompositions) {
    if (isExplicitlyOpen(comp.parent)) {
      if (forceSealing) {
        comp.parent["unevaluatedProperties"] = false;
      } else {
        const arr = JSONPath.toPathArray(comp.path);
        arr.pop(); // remove 'allOf'
        const pointer = JSONPath.toPointer(arr);
        const name = schemaNameFromPointer(pointer) ?? pointer;
        console.warn(
          `[SEAL-SCHEMA] Schema "${name}" has additionalProperties/unevaluatedProperties set to true (explicitly open). Skipping sealing. Use forceSealing option to override.`
        );
      }
    } else if (!isAlreadySealed(comp.parent)) {
      comp.parent["unevaluatedProperties"] = false;
    }
  }

  return applyMappings(doc, toMap);
}

function applyMappings(doc: any, mappings: Mappings[]): any {
  const operations = mappings.flatMap((mapping) => {
    const move = {
      "op": "move",
      "from": mapping.orginalRef,
      "path": mapping.wrapperRef
    };

    const add = {
      "op": "add",
      "path": mapping.orginalRef,
      "value": {
        "allOf": [{ "$ref": `#${mapping.wrapperRef}` }],
        "unevaluatedProperties": false
      }
    };
    const copyMetadata = [{
      "op": "copy",
      "from": `${mapping.wrapperRef}/description`,
      "path": `${mapping.orginalRef}/description`
    },
    {
      "op": "copy",
      "from": `${mapping.wrapperRef}/title`,
      "path": `${mapping.orginalRef}/title`
    }
    ];
    const replaces = mapping.declarationPointers.map((declPtr) => {
      return {
        "op": "replace",
        "path": declPtr,
        "value": {
          "$ref": `#${mapping.wrapperRef}`
        }
      };
    });
    return [move, add, ...copyMetadata, ...replaces] as Operation[]
  });

  operations.sort((a, b) => {
    if (a.op === "replace" && b.op !== "replace") return -1;
    if (a.op !== "replace" && b.op === "replace") return 1;
    return 0;
  });

  applyPatch(doc, operations);

  return doc;
}

function calculateMappings(allRefs: Record<string, string[]>, doc: any, exclude: string[], forceSealing: boolean): Mappings[] {
  return Object.entries(allRefs)
  .filter(([_, refValues]) => refValues.length > 1)
  .filter(([_, refValues]) => {
    const count = refValues.filter((p) => isAllOf(p)).length;
    return count != 0 && count != refValues.length;
    
  })
  .filter(([refPointer]) => {
    const schemaName = schemaNameFromPointer(refPointer);
    return schemaName === undefined || !exclude.includes(schemaName);
  })
  .filter(([refPointer]) => {
    const node = getNodeAtPointer(doc, refPointer);
    if (node === undefined) return true;
    if (isExplicitlyOpen(node)) {
      if (forceSealing) return true;
      const name = schemaNameFromPointer(refPointer) ?? refPointer;
      console.warn(
        `[SEAL-SCHEMA] Schema "${name}" has additionalProperties/unevaluatedProperties set to true (explicitly open). Skipping sealing. Use forceSealing option to override.`
      );
      return false;
    }
    return !isAlreadySealed(node);
  })
  .map(([refPointer, refValues]) => {
    return {
      orginalRef: refPointer,
      wrapperRef: `${refPointer}Core`,
      declarationPointers: refValues.filter((p) => isAllOf(p)),
    };
  });
}


function filterCompositions(allOfSchemas: any[], allRefs: Record<string, string[]>, exclude: string[]): any[] {
  return allOfSchemas.filter((item) => {
    const arr = JSONPath.toPathArray(item.path);
    arr.pop(); // remove 'allOf'
    if (isInsideNot(arr)) return false;
    const pointer = JSONPath.toPointer(arr);
    const schemaName = schemaNameFromPointer(pointer);
    if (schemaName !== undefined && exclude.includes(schemaName)) return false;
    const refs = allRefs[pointer];
    return refs == undefined || !refs.some(x => isAllOf(x));
  });
}


function filter(allProps: any[], allRefs: Record<string, string[]>, exclude: string[]): any[] {
  const inlineComposed = (prop: string[]): boolean => {
    return prop.length > 2 && prop[prop.length - 2] === "allOf";
  }

  const filtered = allProps.filter((prop) => {
    const path = JSONPath.toPathArray(prop.path).slice(0, -1);
    if (isInsideNot(path)) return false;
    const pointer = JSONPath.toPointer(path);
    const schemaName = schemaNameFromPointer(pointer);
    if (schemaName !== undefined && exclude.includes(schemaName)) return false;
    const refs = allRefs[pointer];
    return !inlineComposed(path) && (refs === undefined || refs.every(x => !isAllOf(x)));
  });

  return filtered;
}

function toReverseMap(allRefs: any[]): Record<string, string[]> {
  const asLocalPointer = (ref: string): string | undefined => {
    if (ref.startsWith("#/")) {
      return ref.slice(1);
    }
    else { return undefined }
  }

  const reverseMap: Record<string, string[]> = {};
  for (const refEntry of allRefs) {
    const refValue = asLocalPointer(refEntry.value["$ref"]);
    if (refValue) {
      if (!reverseMap[refValue]) {
        reverseMap[refValue] = [];
      }
      reverseMap[refValue].push(refEntry.pointer);
    }
  }
  return reverseMap;
}

function versionStr(doc: any, prefix?: string): string | undefined {
  const version = getOpenApiVersion(doc) || getJsonSchemaVersion(doc);
  if (version) {
    return prefix ? `${prefix} ${version}` : version;
  }
  return undefined;
}

function find(root: any, query: string): any[] {
  return JSONPath({
    path: query,
    json: root,
    resultType: "all",
  });
}

function upliftDocument(doc: any): any {
  let version = getOpenApiVersion(doc);
  if (version) {
    upgradeToOas31(doc);
    console.warn(
      `[SEAL-SCHEMA] Upgraded OpenAPI version from ${version} to 3.1.0 to support unevaluatedProperties.`
    );
    return doc;
  } else {
    version = getJsonSchemaVersion(doc);
    if (version) {
      upgradeJsonSchemaToDraft201909(doc);
      console.warn(
        `[SEAL-SCHEMA] Upgraded JSON Schema version from ${version} to draft 2019-09 to support unevaluatedProperties.`
      );
      return doc;
    }

    if (isStandaloneJsonSchema(doc)) {
      upgradeJsonSchemaToDraft201909(doc);
      console.warn(
        `[SEAL-SCHEMA] Upgraded JSON Schema version from ${version} to draft 2019-09 to support unevaluatedProperties.`
      );
      return doc;
    }

    throwUpliftError(version || "unknown");
  }
}


function throwUpliftError(version: string): never {
  throw new Error(
    `unevaluatedProperties is only supported in OpenAPI 3.1+ or JSON Schema 2019-09+. ` +
    `Current document uses ${version}. ` +
    `Use --uplift option to automatically upgrade the version, or use schema that does not require unevaluatedProperties.`
  );
}

/**
 * Determine whether the provided document contains any schemas that use `allOf`
 */
function documentContainsAllOfRefs(doc: any): boolean {
  // Use JSONPath to find any allOf entries 
  try {
    const matches = JSONPath({ path: "$..allOf", json: doc });
    return Array.isArray(matches) && matches.length > 0;
  } catch (e) {
    // If JSONPath fails for some reason, fall back to conservative false
    return false;
  }
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

function isInsideNot(pathArray: string[]): boolean {
  return pathArray.includes("not");
}

function schemaNameFromPointer(pointer: string): string | undefined {
  // Matches /components/schemas/{name}, /definitions/{name}, /$defs/{name}
  const m = pointer.match(/^\/(?:components\/schemas|definitions|\$defs)\/([^/]+)$/);
  return m ? m[1] : undefined;
}

function isExplicitlyOpen(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  return obj.additionalProperties === true || obj.unevaluatedProperties === true;
}

function isAlreadySealed(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  return obj.additionalProperties !== undefined || obj.unevaluatedProperties !== undefined;
}

function getNodeAtPointer(doc: any, pointer: string): any {
  const parts = pointer.split("/").slice(1); // remove leading ""
  let node: any = doc;
  for (const part of parts) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}
