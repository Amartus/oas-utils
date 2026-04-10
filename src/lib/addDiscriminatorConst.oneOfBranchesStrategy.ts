import { createConstConstraint, hasConstraintInOneOfEntry, isSchemaReference, oneOfEntryTargetsRef } from './discriminatorConstraintUtils.js';
import type { DiscriminatorContext } from './addDiscriminatorConst.types.js';

/**
 * Strategy: inject discriminator constraints into `oneOf` entries on the **parent** schema.
 *
 * For each `(discriminatorValue, $ref)` pair in the mapping this function:
 *
 * 1. Searches the parent's `oneOf` array for an entry that already targets the given `$ref`.
 *
 * 2. **Entry not found** - appends a new wrapper `{ allOf: [{ $ref }, constraint] }` to `oneOf`.
 *    This covers the case where the mapping references a schema that is not yet listed in the
 *    parent's `oneOf`.
 *
 * 3. **Entry found, already constrained** - skips silently (idempotent).
 *
 * 4. **Entry found, bare `$ref`** - replaces the entry with `{ allOf: [{ $ref }, constraint] }`
 *    so the reference is preserved while gaining the discriminator constraint.
 *
 * 5. **Entry found, already an `allOf` wrapper** - appends the constraint object to the
 *    existing `allOf` array without altering other members.
 *
 * @returns `true` if at least one `oneOf` entry was modified or added.
 */
export function addConstraintsToOneOfBranches(ctx: DiscriminatorContext): boolean {
  const { schema, propertyName, mappingTargets, construct, discriminatorPropertyType, result } = ctx;

  if (!Array.isArray(schema.oneOf)) {
    return false;
  }

  const oneOfEntries = schema.oneOf as unknown[];
  let schemaUpdated = false;

  for (const { ref, values } of mappingTargets) {
    const index = oneOfEntries.findIndex(entry => oneOfEntryTargetsRef(entry, ref));
    const constraint = createConstConstraint(propertyName, values, construct, discriminatorPropertyType);

    if (index === -1) {
      oneOfEntries.push({ allOf: [{ $ref: ref }, constraint] });
      schemaUpdated = true;
      result.constAdded++;
      continue;
    }

    const existing = oneOfEntries[index];
    if (hasConstraintInOneOfEntry(existing, propertyName, values)) {
      continue;
    }

    if (isSchemaReference(existing)) {
      oneOfEntries[index] = { allOf: [{ $ref: existing.$ref }, constraint] };
      schemaUpdated = true;
      result.constAdded++;
      continue;
    }

    if (existing && typeof existing === 'object' && Array.isArray((existing as Record<string, unknown>).allOf)) {
      ((existing as Record<string, unknown>).allOf as unknown[]).push(constraint);
      schemaUpdated = true;
      result.constAdded++;
    }
  }

  return schemaUpdated;
}
