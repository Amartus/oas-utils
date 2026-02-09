/**
 * Common interface for allOf to oneOf transformation implementations
 */


export interface AllOfToOneOfOptions {
  /** If true, add const property with discriminator value to specialization schemas (default: true) */
  addDiscriminatorConst?: boolean;
  /** If true, skip oneOf transformation if only one specialization is found (default: false) */
  ignoreSingleSpecialization?: boolean;
  /** If true, merge nested oneOf schemas by inlining references to schemas that only contain oneOf (default: false) */
  mergeNestedOneOf?: boolean;
}

/**
 * Transforms allOf + discriminator patterns to oneOf + discriminator in OpenAPI documents.
 *
 * @param doc - The OpenAPI document to transform (will be modified in-place)
 * @param opts - Optional configuration for the transformation
 * @returns The transformed document (same reference as input)
 *
 * @example
 * ```typescript
 * import { allOfToOneOf } from "./lib/allOfToOneOfJsonPath.js";
 *
 * const doc = { ... }; // OpenAPI document
 * const transformed = allOfToOneOf(doc, {
 *   addDiscriminatorConst: true,
 *   ignoreSingleSpecialization: false,
 *   mergeNestedOneOf: false
 * });
 * ```
 */
export interface AllOfToOneOfTransform {
  (doc: any, opts?: AllOfToOneOfOptions): any;
}


