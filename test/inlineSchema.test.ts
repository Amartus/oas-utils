import { describe, it, expect } from "vitest";
import { inlineSchema, batchInlineSchemas } from "../src/lib/inlineSchema.js";

describe("inlineSchema", () => {
  describe("basic inlining", () => {
    it("should inline a simple schema in allOf", () => {
      const doc = {
        components: {
          schemas: {
            Base: {
              type: "object",
              properties: {
                id: { type: "string" },
              },
            },
            Derived: {
              allOf: [
                { $ref: "#/components/schemas/Base" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                  },
                },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "Base");

      expect(result.inlined).toBe(1);
      expect(result.inlinedSchemas).toContain("Base");
      expect(result.affectedSchemas).toContain("Derived");

      const derived = doc.components.schemas.Derived;
      expect(derived.allOf).toHaveLength(2);
      expect(derived.allOf[0]).toEqual({
        type: "object",
        properties: {
          id: { type: "string" },
        },
      });
      expect(derived.allOf[1]).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
    });

    it("should handle inlining when schema has allOf", () => {
      const doc = {
        components: {
          schemas: {
            A: {
              type: "object",
              properties: { a: { type: "string" } },
            },
            B: {
              allOf: [
                { $ref: "#/components/schemas/A" },
                {
                  type: "object",
                  properties: { b: { type: "string" } },
                },
              ],
            },
            C: {
              allOf: [
                { $ref: "#/components/schemas/B" },
                {
                  type: "object",
                  properties: { c: { type: "string" } },
                },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "B");

      expect(result.inlined).toBe(1);
      expect(result.affectedSchemas).toContain("C");

      const c = doc.components.schemas.C;
      expect(c.allOf).toHaveLength(3);
      // B's allOf should be inlined into C
      expect(c.allOf[0]).toEqual({ $ref: "#/components/schemas/A" });
      expect(c.allOf[1]).toEqual({
        type: "object",
        properties: { b: { type: "string" } },
      });
      expect(c.allOf[2]).toEqual({
        type: "object",
        properties: { c: { type: "string" } },
      });
    });

    it("should inline in multiple schemas", () => {
      const doc = {
        components: {
          schemas: {
            Base: {
              type: "object",
              properties: { id: { type: "string" } },
            },
            Derived1: {
              allOf: [{ $ref: "#/components/schemas/Base" }],
            },
            Derived2: {
              allOf: [{ $ref: "#/components/schemas/Base" }],
            },
          },
        },
      };

      const result = inlineSchema(doc, "Base");

      expect(result.inlined).toBe(2);
      expect(result.affectedSchemas).toContain("Derived1");
      expect(result.affectedSchemas).toContain("Derived2");

      expect(doc.components.schemas.Derived1.allOf[0]).toEqual({
        type: "object",
        properties: { id: { type: "string" } },
      });
      expect(doc.components.schemas.Derived2.allOf[0]).toEqual({
        type: "object",
        properties: { id: { type: "string" } },
      });
    });
  });

  describe("chain mode", () => {
    it("should inline transitively in chain mode", () => {
      const doc = {
        components: {
          schemas: {
            A: {
              type: "object",
              properties: { a: { type: "string" } },
            },
            B: {
              allOf: [
                { $ref: "#/components/schemas/A" },
                {
                  type: "object",
                  properties: { b: { type: "string" } },
                },
              ],
            },
            C: {
              allOf: [
                { $ref: "#/components/schemas/B" },
                {
                  type: "object",
                  properties: { c: { type: "string" } },
                },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "B", { chain: true });

      expect(result.inlined).toBe(1);
      expect(result.affectedSchemas).toContain("C");

      const c = doc.components.schemas.C;
      // In chain mode, B should be fully inlined (with A also inlined into B first)
      expect(c.allOf).toHaveLength(3);
      expect(c.allOf[0]).toEqual({
        type: "object",
        properties: { a: { type: "string" } },
      });
      expect(c.allOf[1]).toEqual({
        type: "object",
        properties: { b: { type: "string" } },
      });
      expect(c.allOf[2]).toEqual({
        type: "object",
        properties: { c: { type: "string" } },
      });

      // B itself should also be modified
      const b = doc.components.schemas.B;
      expect(b.allOf).toHaveLength(2);
      expect(b.allOf[0]).toEqual({
        type: "object",
        properties: { a: { type: "string" } },
      });
    });

    it("should handle deep chains in chain mode", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object", properties: { a: { type: "string" } } },
            B: {
              allOf: [
                { $ref: "#/components/schemas/A" },
                { type: "object", properties: { b: { type: "string" } } },
              ],
            },
            C: {
              allOf: [
                { $ref: "#/components/schemas/B" },
                { type: "object", properties: { c: { type: "string" } } },
              ],
            },
            D: {
              allOf: [
                { $ref: "#/components/schemas/C" },
                { type: "object", properties: { d: { type: "string" } } },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "C", { chain: true });

      expect(result.affectedSchemas).toContain("D");

      const d = doc.components.schemas.D;
      // C should be fully expanded with A and B inlined
      expect(d.allOf).toHaveLength(4);
    });
  });

  describe("different combiners", () => {
    it("should work with oneOf", () => {
      const doc = {
        components: {
          schemas: {
            Option1: {
              type: "object",
              properties: { type: { const: "option1" } },
            },
            Option2: {
              type: "object",
              properties: { type: { const: "option2" } },
            },
            Union: {
              oneOf: [
                { $ref: "#/components/schemas/Option1" },
                { $ref: "#/components/schemas/Option2" },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "Option1", { combiner: "oneOf" });

      expect(result.inlined).toBe(1);
      expect(result.affectedSchemas).toContain("Union");

      const union = doc.components.schemas.Union;
      expect(union.oneOf[0]).toEqual({
        type: "object",
        properties: { type: { const: "option1" } },
      });
      expect(union.oneOf[1]).toEqual({ $ref: "#/components/schemas/Option2" });
    });

    it("should work with anyOf", () => {
      const doc = {
        components: {
          schemas: {
            Trait1: {
              type: "object",
              properties: { trait1: { type: "boolean" } },
            },
            Combined: {
              anyOf: [
                { $ref: "#/components/schemas/Trait1" },
                { type: "object", properties: { other: { type: "string" } } },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "Trait1", { combiner: "anyOf" });

      expect(result.inlined).toBe(1);
      expect(result.affectedSchemas).toContain("Combined");

      const combined = doc.components.schemas.Combined;
      expect(combined.anyOf[0]).toEqual({
        type: "object",
        properties: { trait1: { type: "boolean" } },
      });
    });

    it("should inline schema with oneOf into allOf when combiner is allOf", () => {
      const doc = {
        components: {
          schemas: {
            OptionSchema: {
              oneOf: [
                { type: "string" },
                { type: "number" },
              ],
            },
            Container: {
              allOf: [
                { $ref: "#/components/schemas/OptionSchema" },
                { type: "object", properties: { id: { type: "string" } } },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "OptionSchema", { combiner: "allOf" });

      expect(result.inlined).toBe(1);
      expect(result.affectedSchemas).toContain("Container");

      const container = doc.components.schemas.Container;
      // When inlining a schema that has oneOf (but doesn't have allOf),
      // we should inline the whole schema
      expect(container.allOf).toHaveLength(2);
      expect(container.allOf[0]).toEqual({
        oneOf: [
          { type: "string" },
          { type: "number" },
        ],
      });
    });
  });

  describe("batch inlining", () => {
    it("should inline multiple schemas", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object", properties: { a: { type: "string" } } },
            B: { type: "object", properties: { b: { type: "string" } } },
            C: {
              allOf: [
                { $ref: "#/components/schemas/A" },
                { $ref: "#/components/schemas/B" },
              ],
            },
          },
        },
      };

      const result = batchInlineSchemas(doc, ["A", "B"]);

      expect(result.inlined).toBe(2);
      expect(result.inlinedSchemas).toContain("A");
      expect(result.inlinedSchemas).toContain("B");
      expect(result.affectedSchemas).toContain("C");

      const c = doc.components.schemas.C;
      expect(c.allOf).toHaveLength(2);
      expect(c.allOf[0]).toEqual({
        type: "object",
        properties: { a: { type: "string" } },
      });
      expect(c.allOf[1]).toEqual({
        type: "object",
        properties: { b: { type: "string" } },
      });
    });

    it("should handle batch inlining with chain mode", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object", properties: { a: { type: "string" } } },
            B: {
              allOf: [
                { $ref: "#/components/schemas/A" },
                { type: "object", properties: { b: { type: "string" } } },
              ],
            },
            C: {
              allOf: [
                { $ref: "#/components/schemas/B" },
                { type: "object", properties: { c: { type: "string" } } },
              ],
            },
          },
        },
      };

      const result = batchInlineSchemas(doc, ["B"], { chain: true });

      expect(result.inlined).toBe(1);
      expect(result.affectedSchemas).toContain("C");
    });
  });

  describe("discriminator warnings", () => {
    it("should warn when inlined schema is in discriminator mapping", () => {
      const warnings: any[] = [];
      const doc = {
        components: {
          schemas: {
            Animal: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {
                  dog: "#/components/schemas/Dog",
                },
              },
              oneOf: [{ $ref: "#/components/schemas/Dog" }],
            },
            Dog: {
              type: "object",
              properties: {
                type: { const: "dog" },
                bark: { type: "string" },
              },
            },
            Container: {
              allOf: [{ $ref: "#/components/schemas/Dog" }],
            },
          },
        },
      };

      const result = inlineSchema(doc, "Dog", {
        warnDiscriminator: true,
        onDiscriminatorWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(result.discriminatorWarnings).toHaveLength(1);
      expect(result.discriminatorWarnings[0]).toEqual({
        schemaName: "Dog",
        parentName: "Animal",
        discriminatorProperty: "type",
      });
      expect(warnings).toHaveLength(1);
    });

    it("should not warn when warnDiscriminator is false", () => {
      const warnings: any[] = [];
      const doc = {
        components: {
          schemas: {
            Animal: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {
                  dog: "#/components/schemas/Dog",
                },
              },
              oneOf: [{ $ref: "#/components/schemas/Dog" }],
            },
            Dog: {
              type: "object",
              properties: {
                type: { const: "dog" },
              },
            },
            Container: {
              allOf: [{ $ref: "#/components/schemas/Dog" }],
            },
          },
        },
      };

      const result = inlineSchema(doc, "Dog", {
        warnDiscriminator: false,
        onDiscriminatorWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(result.discriminatorWarnings).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });
  });

  describe("negative cases", () => {
    it("should handle non-existent schema", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object" },
          },
        },
      };

      const result = inlineSchema(doc, "NonExistent");

      expect(result.inlined).toBe(0);
      expect(result.inlinedSchemas).toHaveLength(0);
      expect(result.affectedSchemas).toHaveLength(0);
    });

    it("should handle schema with no references", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object" },
            B: { type: "object" },
          },
        },
      };

      const result = inlineSchema(doc, "A");

      expect(result.inlined).toBe(0);
      expect(result.inlinedSchemas).toHaveLength(0);
      expect(result.affectedSchemas).toHaveLength(0);
    });

    it("should handle empty document", () => {
      const doc = {};

      const result = inlineSchema(doc, "A");

      expect(result.inlined).toBe(0);
    });

    it("should handle document without components", () => {
      const doc = { openapi: "3.0.0" };

      const result = inlineSchema(doc, "A");

      expect(result.inlined).toBe(0);
    });

    it("should handle schema not used in specified combiner", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object" },
            B: {
              allOf: [{ $ref: "#/components/schemas/A" }],
            },
          },
        },
      };

      const result = inlineSchema(doc, "A", { combiner: "oneOf" });

      expect(result.inlined).toBe(0);
      expect(result.affectedSchemas).toHaveLength(0);
    });

    it("should not modify schemas that don't reference the target", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object", properties: { a: { type: "string" } } },
            B: { type: "object", properties: { b: { type: "string" } } },
            C: {
              allOf: [
                { $ref: "#/components/schemas/A" },
                { type: "object", properties: { c: { type: "string" } } },
              ],
            },
          },
        },
      };

      const docCopy = JSON.parse(JSON.stringify(doc));
      inlineSchema(doc, "B");

      // Schema C should remain unchanged
      expect(doc.components.schemas.C).toEqual(docCopy.components.schemas.C);
    });

    it("should handle circular references gracefully in chain mode", () => {
      const doc = {
        components: {
          schemas: {
            A: {
              allOf: [
                { $ref: "#/components/schemas/B" },
                { type: "object", properties: { a: { type: "string" } } },
              ],
            },
            B: {
              allOf: [
                { $ref: "#/components/schemas/A" },
                { type: "object", properties: { b: { type: "string" } } },
              ],
            },
            C: {
              allOf: [{ $ref: "#/components/schemas/A" }],
            },
          },
        },
      };

      // Should not throw or hang
      const result = inlineSchema(doc, "A", { chain: true });

      // Should still process what it can
      expect(result.affectedSchemas).toContain("C");
    });
  });

  describe("complex scenarios", () => {
    it("should handle schema with multiple allOf items", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object", properties: { a: { type: "string" } } },
            B: { type: "object", properties: { b: { type: "string" } } },
            C: {
              allOf: [
                { $ref: "#/components/schemas/A" },
                { $ref: "#/components/schemas/B" },
                { type: "object", properties: { c: { type: "string" } } },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "A");

      expect(result.inlined).toBe(1);
      expect(result.affectedSchemas).toContain("C");

      const c = doc.components.schemas.C;
      expect(c.allOf).toHaveLength(3);
      expect(c.allOf[0]).toEqual({
        type: "object",
        properties: { a: { type: "string" } },
      });
      expect(c.allOf[1]).toEqual({ $ref: "#/components/schemas/B" });
      expect(c.allOf[2]).toEqual({
        type: "object",
        properties: { c: { type: "string" } },
      });
    });

    it("should handle inlining schema that is simple type", () => {
      const doc = {
        components: {
          schemas: {
            StringType: { type: "string" },
            Container: {
              allOf: [
                { $ref: "#/components/schemas/StringType" },
                { minLength: 5 },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "StringType");

      expect(result.inlined).toBe(1);
      expect(result.affectedSchemas).toContain("Container");

      const container = doc.components.schemas.Container;
      expect(container.allOf).toHaveLength(2);
      expect(container.allOf[0]).toEqual({ type: "string" });
      expect(container.allOf[1]).toEqual({ minLength: 5 });
    });

    it("should handle schema with description and other metadata", () => {
      const doc = {
        components: {
          schemas: {
            Base: {
              type: "object",
              description: "Base schema",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
            Derived: {
              allOf: [{ $ref: "#/components/schemas/Base" }],
            },
          },
        },
      };

      const result = inlineSchema(doc, "Base");

      expect(result.inlined).toBe(1);

      const derived = doc.components.schemas.Derived;
      expect(derived.allOf[0]).toEqual({
        type: "object",
        description: "Base schema",
        properties: { id: { type: "string" } },
        required: ["id"],
      });
    });

    it("should preserve order when inlining", () => {
      const doc = {
        components: {
          schemas: {
            A: { type: "object", properties: { a: { type: "string" } } },
            B: { type: "object", properties: { b: { type: "string" } } },
            C: {
              allOf: [
                { type: "object", properties: { c1: { type: "string" } } },
                { $ref: "#/components/schemas/A" },
                { type: "object", properties: { c2: { type: "string" } } },
                { $ref: "#/components/schemas/B" },
                { type: "object", properties: { c3: { type: "string" } } },
              ],
            },
          },
        },
      };

      const result = inlineSchema(doc, "A");

      expect(result.inlined).toBe(1);

      const c = doc.components.schemas.C;
      expect(c.allOf).toHaveLength(5);
      expect(c.allOf[0].properties).toHaveProperty("c1");
      expect(c.allOf[1].properties).toHaveProperty("a");
      expect(c.allOf[2].properties).toHaveProperty("c2");
      expect(c.allOf[3].$ref).toBe("#/components/schemas/B");
      expect(c.allOf[4].properties).toHaveProperty("c3");
    });
  });
});
