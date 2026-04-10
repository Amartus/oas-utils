export type Construct = 'const' | 'enum';

const isValidObject = (obj: unknown): obj is Record<string, unknown> =>
  obj !== null && typeof obj === 'object' && !Array.isArray(obj);

function normalizeConstraintValues(values: string | string[]): string[] {
  const normalized = Array.isArray(values) ? values : [values];
  return [...new Set(normalized.filter(value => typeof value === 'string' && value.length > 0))];
}

function enumCoversValues(enumValues: unknown, values: string[]): boolean {
  return Array.isArray(enumValues) && values.every(value => enumValues.includes(value));
}

/**
 * Create a schema constraint fragment with const or enum.
 */
export function createConstConstraint(
  propName: string,
  values: string | string[],
  construct: Construct = 'const',
  propertyType?: string
): Record<string, unknown> {
  const normalizedValues = normalizeConstraintValues(values);
  const typeEntry = propertyType ? { type: propertyType } : {};

  if (normalizedValues.length !== 1 || construct === 'enum') {
    return {
      type: 'object',
      properties: { [propName]: { ...typeEntry, enum: normalizedValues } }
    };
  }

  return {
    type: 'object',
    properties: { [propName]: { ...typeEntry, const: normalizedValues[0] } }
  };
}

/**
 * Check if a schema already has a const or enum constraint for a property/value.
 */
export function hasConstOrEnumConstraint(
  schema: Record<string, unknown>,
  propName: string,
  values: string | string[]
): boolean {
  const normalizedValues = normalizeConstraintValues(values);

  if (!isValidObject(schema) || !Array.isArray(schema.allOf)) {
    return false;
  }

  return (schema.allOf as unknown[]).some(item => {
    if (!isValidObject(item) || !isValidObject(item.properties)) {
      return false;
    }

    const propSchema = item.properties[propName];
    if (!isValidObject(propSchema)) {
      return false;
    }

    if (normalizedValues.length === 1 && propSchema.const === normalizedValues[0]) {
      return true;
    }

    if (enumCoversValues(propSchema.enum, normalizedValues)) {
      return true;
    }

    return false;
  });
}

export function hasConstraintInProperties(
  schema: Record<string, unknown>,
  propName: string,
  values: string | string[]
): boolean {
  const normalizedValues = normalizeConstraintValues(values);

  if (!isValidObject(schema.properties)) {
    return false;
  }

  const propSchema = schema.properties[propName];
  if (!isValidObject(propSchema)) {
    return false;
  }

  if (normalizedValues.length === 1 && propSchema.const === normalizedValues[0]) {
    return true;
  }

  if (enumCoversValues(propSchema.enum, normalizedValues)) {
    return true;
  }

  return false;
}

export function hasConstraintInOneOfEntry(
  entry: unknown,
  propName: string,
  values: string | string[]
): boolean {
  if (!isValidObject(entry)) {
    return false;
  }

  if (hasConstraintInProperties(entry, propName, values)) {
    return true;
  }

  if (!Array.isArray(entry.allOf)) {
    return false;
  }

  return (entry.allOf as unknown[]).some(item => isValidObject(item) && hasConstraintInProperties(item, propName, values));
}

export function isSchemaReference(obj: unknown): obj is { $ref: string } {
  return isValidObject(obj) && typeof obj.$ref === 'string';
}

export function oneOfEntryTargetsRef(entry: unknown, ref: string): boolean {
  if (isSchemaReference(entry)) {
    return entry.$ref === ref;
  }

  if (!isValidObject(entry) || !Array.isArray(entry.allOf)) {
    return false;
  }

  return (entry.allOf as unknown[]).some(item => isSchemaReference(item) && item.$ref === ref);
}
