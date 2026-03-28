export type Construct = 'const' | 'enum';

const isValidObject = (obj: unknown): obj is Record<string, unknown> =>
  obj !== null && typeof obj === 'object' && !Array.isArray(obj);

/**
 * Create a schema constraint fragment with const or enum.
 */
export function createConstConstraint(
  propName: string,
  value: string,
  construct: Construct = 'const'
): Record<string, unknown> {
  if (construct === 'enum') {
    return {
      type: 'object',
      properties: { [propName]: { enum: [value] } }
    };
  }

  return {
    type: 'object',
    properties: { [propName]: { const: value } }
  };
}

/**
 * Check if a schema already has a const or enum constraint for a property/value.
 */
export function hasConstOrEnumConstraint(
  schema: Record<string, unknown>,
  propName: string,
  value: string
): boolean {
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

    if (propSchema.const === value) {
      return true;
    }

    if (Array.isArray(propSchema.enum) && propSchema.enum.includes(value)) {
      return true;
    }

    return false;
  });
}

export function hasConstraintInProperties(
  schema: Record<string, unknown>,
  propName: string,
  value: string
): boolean {
  if (!isValidObject(schema.properties)) {
    return false;
  }

  const propSchema = schema.properties[propName];
  if (!isValidObject(propSchema)) {
    return false;
  }

  if (propSchema.const === value) {
    return true;
  }

  if (Array.isArray(propSchema.enum) && propSchema.enum.includes(value)) {
    return true;
  }

  return false;
}

export function hasConstraintInOneOfEntry(
  entry: unknown,
  propName: string,
  value: string
): boolean {
  if (!isValidObject(entry)) {
    return false;
  }

  if (hasConstraintInProperties(entry, propName, value)) {
    return true;
  }

  if (!Array.isArray(entry.allOf)) {
    return false;
  }

  return (entry.allOf as unknown[]).some(item => isValidObject(item) && hasConstraintInProperties(item, propName, value));
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
