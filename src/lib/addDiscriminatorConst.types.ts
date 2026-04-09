import type { Construct } from './discriminatorConstraintUtils.js';

export type { Construct };

export type ConstMode = 'auto' | 'const' | 'enum' | 'adapt';

export type ConstPlacement = 'oneOf-branches' | 'children';

export interface DiscriminatorMappingTarget {
  ref: string;
  values: string[];
}

export interface AddDiscriminatorConstOptions {
  /**
   * Mode for selecting the constraint construct.
   * - 'auto' (default): OAS 3.0.x -> enum, OAS 3.1.x -> const
   * - 'const': use { const: value } on OAS 3.1.x, otherwise fall back to enum
   * - 'enum': always use { enum: [value] }
   * - 'adapt': use const and upgrade OAS 3.0.x -> 3.1.0
   */
  mode?: ConstMode;

  /**
   * Force-upgrade the document to OAS 3.1.0 before constraint generation.
   * Useful when `mode='auto'` or `mode='const'` should emit `const` for OAS 3.0.x inputs.
   */
  forceUplift?: boolean;

  /**
   * Where discriminator constraints are injected.
   * - 'oneOf-branches' (default): add constraints in oneOf entries
   *   as allOf([$ref, constraint]) wrappers
   * - 'children': add constraints directly into mapped child schemas (legacy)
   */
  placement?: ConstPlacement;

  /**
   * Compatibility mode for oneOf discriminator inheritance patterns.
   */
  compatibilityMode?: boolean;

  /** Optional callback to receive warnings during transformation. */
  onWarning?: (message: string) => void;
}

export interface AddDiscriminatorConstResult {
  /** Number of schemas with one or more children updated */
  schemasUpdated: number;

  /** Total number of discriminator children that received const/enum constraints */
  constAdded: number;

  /** Whether OAS version was upgraded (only when mode='adapt') */
  versionUpgraded: boolean;
}

export interface DiscriminatorContext {
  schemas: Record<string, unknown>;
  schema: Record<string, unknown>;
  propertyName: string;
  mapping: Record<string, string>;
  mappingTargets: DiscriminatorMappingTarget[];
  construct: Construct;
  compatibilityMode: boolean;
  result: AddDiscriminatorConstResult;
}
