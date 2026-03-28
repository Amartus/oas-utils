import { refToName } from './oasUtils.js';
import { createConstConstraint, hasConstOrEnumConstraint, isSchemaReference } from './discriminatorConstraintUtils.js';
import type { DiscriminatorContext } from './addDiscriminatorConst.types.js';

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

export function addConstraintsToChildren(ctx: DiscriminatorContext): boolean {
  const { schemas, propertyName, mapping, construct, compatibilityMode, result } = ctx;
  const allOfParentNames = compatibilityMode
    ? getMappedAllOfParentNames(mapping, schemas)
    : undefined;

  let schemaUpdated = false;

  for (const [discriminatorValue, ref] of Object.entries(mapping)) {
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

    if (hasConstOrEnumConstraint(childSchema as Record<string, unknown>, propertyName, discriminatorValue)) {
      continue;
    }

    const mutableChild = childSchema as Record<string, unknown>;
    if (!Array.isArray(mutableChild.allOf)) {
      mutableChild.allOf = [];
    }

    const allOf = mutableChild.allOf as unknown[];
    const constraint = createConstConstraint(propertyName, discriminatorValue, construct);
    allOf.push(constraint);

    schemaUpdated = true;
    result.constAdded++;
  }

  return schemaUpdated;
}
