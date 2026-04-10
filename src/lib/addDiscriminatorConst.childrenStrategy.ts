import { refToName } from './oasUtils.js';
import { createConstConstraint, hasConstOrEnumConstraint, isSchemaReference } from './discriminatorConstraintUtils.js';
import type { DiscriminatorContext } from './addDiscriminatorConst.types.js';

/**
 * Identifies which mapped schemas act as intermediate **allOf parents** within the same
 * discriminator mapping.
 *
 * In some inheritance hierarchies a discriminator mapping may include both a parent schema
 * (e.g. `Animal`) and its concrete children (e.g. `Dog`, `Cat`), where each child uses
 * `allOf: [{ $ref: '#/components/schemas/Animal' }, …]`.  Adding a discriminator constraint
 * to `Animal` would be incorrect because `Animal` itself is not the leaf type; the constraint
 * belongs only on the concrete children.
 *
 * This helper collects the names of every mapped schema that is **referenced via `allOf`
 * by another mapped schema**, signalling it is a parent and should be skipped when
 * `compatibilityMode` is enabled.
 */
function getMappedAllOfParentNames(
  mapping: Record<string, string>,
  schemas: Record<string, unknown>
): Set<string> {
  const mappedNames = new Set<string>();
  for (const ref of Object.values(mapping)) {
    const name = refToName(ref);
    if (name) {
      mappedNames.add(name);
    }
  }

  const allOfParentNames = new Set<string>();

  for (const childName of mappedNames) {
    const childSchema = schemas[childName];
    if (!childSchema || typeof childSchema !== 'object' || !Array.isArray((childSchema as Record<string, unknown>).allOf)) {
      continue;
    }

    for (const item of ((childSchema as Record<string, unknown>).allOf as unknown[])) {
      if (!isSchemaReference(item)) {
        continue;
      }
      const parentName = refToName(item.$ref);
      if (!parentName) {
        continue;
      }
      if (mappedNames.has(parentName) && parentName !== childName) {
        allOfParentNames.add(parentName);
      }
    }
  }

  return allOfParentNames;
}

/**
 * Strategy: inject discriminator constraints directly into the mapped **child** schemas.
 *
 * Unlike the `oneOf-branches` strategy (which modifies the parent schema's `oneOf` entries),
 * this strategy walks each `(discriminatorValue, $ref)` pair in the mapping and mutates the
 * referenced child schema itself by appending a constraint object to its `allOf` array.
 *
 * Behaviour:
 * - Resolves the child schema name from the `$ref` path.
 * - **Compatibility mode** (`opts.compatibilityMode = true`): skips any child that is itself
 *   referenced as an `allOf` parent by another mapped child (see `getMappedAllOfParentNames`).
 *   This prevents double-constraining intermediate abstract schemas in multi-level inheritance.
 * - Skips children that already carry a matching `const`/`enum` constraint (idempotent).
 * - Creates the `allOf` array on the child schema if it does not exist yet.
 * - Appends `{ required: [propertyName], properties: { [propertyName]: { const|enum: value } } }`
 *   (or equivalent, depending on `construct`) to `allOf`.
 *
 * @returns `true` if at least one child schema was modified.
 */
export function addConstraintsToChildren(ctx: DiscriminatorContext): boolean {
  const { schemas, propertyName, mapping, mappingTargets, construct, discriminatorPropertyType, compatibilityMode, result } = ctx;
  const allOfParentNames = compatibilityMode
    ? getMappedAllOfParentNames(mapping, schemas)
    : undefined;

  let schemaUpdated = false;

  for (const { ref, values } of mappingTargets) {
    const childName = refToName(ref);
    if (!childName) {
      continue;
    }

    const childSchema = schemas[childName];
    if (!childSchema || typeof childSchema !== 'object' || Array.isArray(childSchema)) {
      continue;
    }

    if (allOfParentNames?.has(childName)) {
      continue;
    }

    if (hasConstOrEnumConstraint(childSchema as Record<string, unknown>, propertyName, values)) {
      continue;
    }

    const mutableChild = childSchema as Record<string, unknown>;
    if (!Array.isArray(mutableChild.allOf)) {
      mutableChild.allOf = [];
    }

    const allOf = mutableChild.allOf as unknown[];
    const constraint = createConstConstraint(propertyName, values, construct, discriminatorPropertyType);
    allOf.push(constraint);

    schemaUpdated = true;
    result.constAdded++;
  }

  return schemaUpdated;
}
