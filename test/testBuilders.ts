export function ref(name: string): string {
  return `#/components/schemas/${name}`;
}

export function objectSchema(properties: Record<string, unknown> = {}): any {
  return { type: "object", properties };
}

export function oneOfRefs(...schemaNames: string[]): Array<{ $ref: string }> {
  return schemaNames.map((name) => ({ $ref: ref(name) }));
}

export function discriminatorOneOf(propertyName: string, mapping: Record<string, string>): any {
  return {
    oneOf: oneOfRefs(...Object.values(mapping)),
    discriminator: {
      propertyName,
      mapping: Object.fromEntries(
        Object.entries(mapping).map(([discriminatorValue, schemaName]) => [discriminatorValue, ref(schemaName)])
      ),
    },
  };
}

export function createDoc(opts: {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, unknown>;
  schemas?: Record<string, unknown>;
} = {}): any {
  const {
    openapi = "3.0.0",
    info,
    paths,
    schemas = {},
  } = opts;

  const doc: any = {
    openapi,
    components: { schemas },
  };

  if (info) doc.info = info;
  if (paths) doc.paths = paths;

  return doc;
}

export function constraintFragment(propName: string, value: string, kind: "const" | "enum"): any {
  return {
    type: "object",
    properties: {
      [propName]: kind === "const" ? { const: value } : { enum: [value] },
    },
  };
}

export function hasConstraint(schema: any, propName: string, value: string, kind: "const" | "enum"): boolean {
  if (!Array.isArray(schema?.allOf)) return false;
  return schema.allOf.some((item: any) =>
    kind === "const"
      ? item?.properties?.[propName]?.const === value
      : Array.isArray(item?.properties?.[propName]?.enum) && item.properties[propName].enum.includes(value)
  );
}

export class TestDocBuilder {
  private doc: any = createDoc();

  withOpenApi(version: string): this {
    this.doc.openapi = version;
    return this;
  }

  withInfo(title = "Test API", version = "1.0.0"): this {
    this.doc.info = { title, version };
    return this;
  }

  withSchema(name: string, schema: any = objectSchema()): this {
    this.doc.components.schemas[name] = schema;
    return this;
  }

  withParent(name: string, propertyName: string, mapping: Record<string, string>): this {
    this.doc.components.schemas[name] = discriminatorOneOf(propertyName, mapping);
    return this;
  }

  build(): any {
    return JSON.parse(JSON.stringify(this.doc));
  }
}
