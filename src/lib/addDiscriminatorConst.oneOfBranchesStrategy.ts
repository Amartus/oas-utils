import { createConstConstraint, hasConstraintInOneOfEntry, isSchemaReference, oneOfEntryTargetsRef } from './discriminatorConstraintUtils.js';
import type { DiscriminatorContext } from './addDiscriminatorConst.types.js';

export function addConstraintsToOneOfBranches(ctx: DiscriminatorContext): boolean {
  const { schema, propertyName, mapping, construct, result } = ctx;

  if (!Array.isArray(schema.oneOf)) {
    return false;
  }

  const oneOfEntries = schema.oneOf as unknown[];
  let schemaUpdated = false;

  for (const [discriminatorValue, ref] of Object.entries(mapping)) {
    if (typeof ref !== 'string') {
      continue;
    }

    const index = oneOfEntries.findIndex(entry => oneOfEntryTargetsRef(entry, ref));
    const constraint = createConstConstraint(propertyName, discriminatorValue, construct);

    if (index === -1) {
      oneOfEntries.push({ allOf: [{ $ref: ref }, constraint] });
      schemaUpdated = true;
      result.constAdded++;
      continue;
    }

    const existing = oneOfEntries[index];
    if (hasConstraintInOneOfEntry(existing, propertyName, discriminatorValue)) {
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
