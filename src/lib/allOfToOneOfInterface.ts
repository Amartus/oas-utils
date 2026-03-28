/**
 * Common interface for allOf to oneOf transformation implementations
 */


export interface AllOfToOneOfOptions {
  /** If true, add const property with discriminator value to specialization schemas (default: true) */
  addDiscriminatorConst?: boolean;
  /**
   * If true, also add discriminator consts for pre-existing oneOf+discriminator
   * schemas present in the input document (default: false).
   */
  addDiscriminatorConstToExistingOneOf?: boolean;
  /**
   * Compatibility mode for discriminator const assignment (default: true).
   * When enabled, mapped schemas that are allOf parents of other mapped schemas are skipped.
   */
  discriminatorConstCompatibilityMode?: boolean;
  /**
   * Placement strategy for post-pass discriminator constraints.
   * - 'oneOf-branches' (default): attach constraints to oneOf branches
   * - 'children': attach constraints directly to mapped child schemas (legacy)
   */
  discriminatorConstPlacement?: 'oneOf-branches' | 'children';
  /** If true, skip oneOf transformation if only one specialization is found (default: false) */
  ignoreSingleSpecialization?: boolean;
  /** If true, merge nested oneOf schemas by inlining references to schemas that only contain oneOf (default: false) */
  mergeNestedOneOf?: boolean;
  /** Optional callback to receive warnings during transformation. If not provided, warnings are silently ignored. */
  onWarning?: (message: string) => void;
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


