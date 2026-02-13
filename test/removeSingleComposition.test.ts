import { describe, it, expect } from "vitest";
import { removeSingleComposition } from "../src/lib/removeSingleComposition.js";

describe("removeSingleComposition", () => {
  it("should remove a single allOf wrapper and rewrite references", () => {
    const doc = {
      components: {
        schemas: {
          Foo: {
            allOf: [{ $ref: "#/components/schemas/Bar" }],
          },
          Bar: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      },
      paths: {
        "/test": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Foo" },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(1);
    expect(result.removed).toContain("Foo");
    expect(doc.components.schemas.Foo).toBeUndefined();
    expect(doc.components.schemas.Bar).toBeDefined();
    expect(
      doc.paths["/test"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/Bar");
  });

  it("should remove a single anyOf wrapper", () => {
    const doc = {
      components: {
        schemas: {
          Wrapper: {
            anyOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {
        "/x": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Wrapper" },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(1);
    expect(result.removed).toContain("Wrapper");
    expect(
      doc.paths["/x"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/Target");
  });

  it("should remove a single oneOf wrapper", () => {
    const doc = {
      components: {
        schemas: {
          Wrapper: {
            oneOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {
        "/x": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Wrapper" },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(1);
    expect(result.removed).toContain("Wrapper");
    expect(
      doc.paths["/x"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/Target");
  });

  it("should resolve transitive chains", () => {
    const doc = {
      components: {
        schemas: {
          A: {
            allOf: [{ $ref: "#/components/schemas/B" }],
          },
          B: {
            oneOf: [{ $ref: "#/components/schemas/C" }],
          },
          C: {
            type: "object",
            properties: { value: { type: "number" } },
          },
        },
      },
      paths: {
        "/a": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/A" },
                  },
                },
              },
            },
          },
        },
        "/b": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/B" },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(2);
    expect(result.removed).toContain("A");
    expect(result.removed).toContain("B");
    expect(doc.components.schemas.A).toBeUndefined();
    expect(doc.components.schemas.B).toBeUndefined();
    expect(doc.components.schemas.C).toBeDefined();
    expect(
      doc.paths["/a"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/C");
    expect(
      doc.paths["/b"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/C");
  });

  it("should not remove schemas with additional top-level properties", () => {
    const doc = {
      components: {
        schemas: {
          WithDescription: {
            description: "A wrapper with description",
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(0);
    expect(doc.components.schemas.WithDescription).toBeDefined();
  });

  it("should remove schemas with description in aggressive mode", () => {
    const doc = {
      components: {
        schemas: {
          WithDescription: {
            description: "A wrapper with description",
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {
        "/x": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/WithDescription" },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = removeSingleComposition(doc, { aggressive: true });

    expect(result.schemasRemoved).toBe(1);
    expect(result.removed).toContain("WithDescription");
    expect(doc.components.schemas.WithDescription).toBeUndefined();
    expect(
      doc.paths["/x"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/Target");
  });

  it("should remove schemas with discriminator in aggressive mode", () => {
    const doc = {
      components: {
        schemas: {
          WithDiscriminator: {
            discriminator: { propertyName: "type" },
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
    };

    const result = removeSingleComposition(doc, { aggressive: true });

    expect(result.schemasRemoved).toBe(1);
    expect(result.removed).toContain("WithDiscriminator");
  });

  it("should NOT remove schemas with properties keyword even in aggressive mode", () => {
    const doc = {
      components: {
        schemas: {
          WithProperties: {
            properties: { extra: { type: "string" } },
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
    };

    const result = removeSingleComposition(doc, { aggressive: true });

    expect(result.schemasRemoved).toBe(0);
    expect(doc.components.schemas.WithProperties).toBeDefined();
  });

  it("should NOT remove schemas with properties even if other extra keywords are present in aggressive mode", () => {
    const doc = {
      components: {
        schemas: {
          WithPropsAndDesc: {
            description: "Has both",
            properties: { extra: { type: "string" } },
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
    };

    const result = removeSingleComposition(doc, { aggressive: true });

    expect(result.schemasRemoved).toBe(0);
    expect(doc.components.schemas.WithPropsAndDesc).toBeDefined();
  });

  it("aggressive mode should not affect schemas without extra keywords", () => {
    const doc = {
      components: {
        schemas: {
          PureWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
    };

    const result = removeSingleComposition(doc, { aggressive: true });

    expect(result.schemasRemoved).toBe(1);
    expect(result.removed).toContain("PureWrapper");
  });

  it("should not remove schemas with multiple allOf entries", () => {
    const doc = {
      components: {
        schemas: {
          Composed: {
            allOf: [
              { $ref: "#/components/schemas/Base" },
              { type: "object", properties: { extra: { type: "string" } } },
            ],
          },
          Base: { type: "object" },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(0);
    expect(doc.components.schemas.Composed).toBeDefined();
  });

  it("should not remove schemas with a single non-ref composition entry", () => {
    const doc = {
      components: {
        schemas: {
          InlineOnly: {
            allOf: [{ type: "object", properties: { x: { type: "string" } } }],
          },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(0);
    expect(doc.components.schemas.InlineOnly).toBeDefined();
  });

  it("should update discriminator mappings", () => {
    const doc = {
      components: {
        schemas: {
          Wrapper: {
            allOf: [{ $ref: "#/components/schemas/Actual" }],
          },
          Actual: { type: "object" },
          Parent: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                wrapped: "#/components/schemas/Wrapper",
                other: "#/components/schemas/Other",
              },
            },
          },
          Other: { type: "object" },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(1);
    expect(result.removed).toContain("Wrapper");
    expect(doc.components.schemas.Parent.discriminator.mapping.wrapped).toBe(
      "#/components/schemas/Actual"
    );
    expect(doc.components.schemas.Parent.discriminator.mapping.other).toBe(
      "#/components/schemas/Other"
    );
  });

  it("should return zero when no single-composition schemas exist", () => {
    const doc = {
      components: {
        schemas: {
          Normal: {
            type: "object",
            properties: { id: { type: "integer" } },
          },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(0);
    expect(result.removed).toHaveLength(0);
  });

  it("should handle empty document gracefully", () => {
    expect(removeSingleComposition({}).schemasRemoved).toBe(0);
    expect(removeSingleComposition(null).schemasRemoved).toBe(0);
    expect(removeSingleComposition(undefined).schemasRemoved).toBe(0);
  });

  it("should handle document with no schemas", () => {
    const doc = { components: {} };
    const result = removeSingleComposition(doc);
    expect(result.schemasRemoved).toBe(0);
  });

  it("should rewrite refs in all document locations", () => {
    const doc = {
      components: {
        schemas: {
          Wrapper: {
            allOf: [{ $ref: "#/components/schemas/Real" }],
          },
          Real: { type: "object" },
          UsesWrapper: {
            type: "object",
            properties: {
              field: { $ref: "#/components/schemas/Wrapper" },
            },
          },
        },
        requestBodies: {
          MyBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Wrapper" },
              },
            },
          },
        },
      },
      paths: {
        "/items": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Wrapper" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = removeSingleComposition(doc);

    expect(result.schemasRemoved).toBe(1);
    // Schema property ref
    expect(doc.components.schemas.UsesWrapper.properties.field.$ref).toBe(
      "#/components/schemas/Real"
    );
    // Request body ref
    expect(
      doc.components.requestBodies.MyBody.content["application/json"].schema.$ref
    ).toBe("#/components/schemas/Real");
    // Path array items ref
    expect(
      doc.paths["/items"].get.responses["200"].content["application/json"].schema.items.$ref
    ).toBe("#/components/schemas/Real");
  });
});
