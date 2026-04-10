import { describe, it, expect } from "vitest";
import { addDiscriminatorConst, createConstConstraint, hasConstOrEnumConstraint } from "../src/lib/addDiscriminatorConst.js";
import {
  TestDocBuilder,
  objectSchema,
  constraintFragment,
  hasConstraint,
  ref,
} from "./testBuilders.js";

type ConstraintKind = "const" | "enum";
type ConstraintValue = string | string[];

function buildDoc(
  parentName: string,
  propertyName: string,
  mapping: Record<string, string>,
  schemas: Record<string, any> = {},
  openapi = "3.1.0"
): any {
  const builder = new TestDocBuilder()
    .withOpenApi(openapi)
    .withParent(parentName, propertyName, mapping);

  for (const [name, schema] of Object.entries(schemas)) {
    builder.withSchema(name, schema);
  }

  return builder.build();
}

function buildMappedHierarchyDoc(includeLeafOnly = false): any {
  const mapping: Record<string, string> = includeLeafOnly
    ? { A: "A", B: "B" }
    : { A: "A", B: "B", C: "C" };

  return buildDoc("A", "@type", mapping, {
    B: includeLeafOnly
      ? objectSchema({ b: { type: "string" } })
      : {
          allOf: [
            { $ref: ref("A") },
            objectSchema({ b: { type: "string" } }),
          ],
        },
    ...(includeLeafOnly
      ? {}
      : {
          C: {
            allOf: [
              { $ref: ref("A") },
              objectSchema({ c: { type: "string" } }),
            ],
          },
        }),
  });
}

const expectSchemaConstraint = (
  doc: any,
  schemaName: string,
  propName: string,
  value: ConstraintValue,
  kind: ConstraintKind,
  present = true
): void => {
  expect(hasConstraint(doc.components.schemas[schemaName], propName, value, kind)).toBe(present);
};

function hasOneOfBranchConstraint(
  schema: any,
  targetRef: string,
  propName: string,
  value: ConstraintValue,
  kind: ConstraintKind
): boolean {
  const values = Array.isArray(value) ? value : [value];
  if (!Array.isArray(schema?.oneOf)) return false;

  return schema.oneOf.some((entry: any) => {
    if (!Array.isArray(entry?.allOf)) return false;
    const hasRef = entry.allOf.some((item: any) => item?.$ref === ref(targetRef));
    if (!hasRef) return false;
    return entry.allOf.some((item: any) =>
      kind === "const"
        ? values.length === 1 && item?.properties?.[propName]?.const === values[0]
        : Array.isArray(item?.properties?.[propName]?.enum) && values.every((entryValue) => item.properties[propName].enum.includes(entryValue))
    );
  });
}

describe("addDiscriminatorConst", () => {
  describe("main function - default placement", () => {
    it("adds const constraints to oneOf branches by default", () => {
      const doc = buildDoc("AnimalOrRef", "@type", { AnimalRef: "AnimalRef", AnimalRefExt: "AnimalRefExt" }, {
        AnimalRef: {
          type: "object",
          allOf: [{ $ref: ref("EntityRef") }],
        },
        EntityRef: objectSchema({ id: { type: "string" } }),
        AnimalRefExt: {
          allOf: [
            { $ref: ref("AnimalRef") },
            objectSchema({ trackingCode: { type: "string" } }),
          ],
        },
      });

      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);
      expect(hasOneOfBranchConstraint(doc.components.schemas.AnimalOrRef, "AnimalRef", "@type", "AnimalRef", "const")).toBe(true);
      expect(hasOneOfBranchConstraint(doc.components.schemas.AnimalOrRef, "AnimalRefExt", "@type", "AnimalRefExt", "const")).toBe(true);
      expectSchemaConstraint(doc, "AnimalRef", "@type", "AnimalRef", "const", false);
      expectSchemaConstraint(doc, "AnimalRefExt", "@type", "AnimalRefExt", "const", false);
    });
  });

  describe("createConstConstraint helper", () => {
    it("creates const constraint", () => {
      const constraint = createConstConstraint("type", "cat", "const");
      expect(constraint).toEqual({
        type: "object",
        properties: {
          type: { const: "cat" }
        }
      });
    });

    it("creates enum constraint", () => {
      const constraint = createConstConstraint("type", "dog", "enum");
      expect(constraint).toEqual({
        type: "object",
        properties: {
          type: { enum: ["dog"] }
        }
      });
    });

    it("creates multi-value enum constraint in const mode", () => {
      const constraint = createConstConstraint("type", ["cat", "feline"], "const");
      expect(constraint).toEqual({
        type: "object",
        properties: {
          type: { enum: ["cat", "feline"] }
        }
      });
    });

    it("includes propertyType in const constraint when provided", () => {
      const constraint = createConstConstraint("@type", "cat", "const", "string");
      expect(constraint).toEqual({
        type: "object",
        properties: {
          "@type": { type: "string", const: "cat" }
        }
      });
    });

    it("includes propertyType in enum constraint when provided", () => {
      const constraint = createConstConstraint("@type", "dog", "enum", "string");
      expect(constraint).toEqual({
        type: "object",
        properties: {
          "@type": { type: "string", enum: ["dog"] }
        }
      });
    });

    it("includes propertyType in multi-value enum constraint when provided", () => {
      const constraint = createConstConstraint("@type", ["cat", "feline"], "const", "string");
      expect(constraint).toEqual({
        type: "object",
        properties: {
          "@type": { type: "string", enum: ["cat", "feline"] }
        }
      });
    });
  });

  describe("hasConstOrEnumConstraint helper", () => {
    it("detects const constraint", () => {
      const schema: any = {
        allOf: [
          {
            type: "object",
            properties: {
              type: { const: "cat" }
            }
          }
        ]
      };
      expect(hasConstOrEnumConstraint(schema, "type", "cat")).toBe(true);
    });

    it("detects enum constraint", () => {
      const schema: any = {
        allOf: [
          {
            type: "object",
            properties: {
              type: { enum: ["dog"] }
            }
          }
        ]
      };
      expect(hasConstOrEnumConstraint(schema, "type", "dog")).toBe(true);
    });

    it("detects multi-value enum constraint", () => {
      const schema: any = {
        allOf: [
          {
            type: "object",
            properties: {
              type: { enum: ["cat", "feline"] }
            }
          }
        ]
      };
      expect(hasConstOrEnumConstraint(schema, "type", ["cat", "feline"])).toBe(true);
    });

    it("returns false when no constraint present", () => {
      const schema: any = {
        type: "object",
        properties: {}
      };
      expect(hasConstOrEnumConstraint(schema, "type", "cat")).toBe(false);
    });

    it("returns false when constraint doesn't match value", () => {
      const schema: any = {
        allOf: [
          {
            type: "object",
            properties: {
              type: { const: "cat" }
            }
          }
        ]
      };
      expect(hasConstOrEnumConstraint(schema, "type", "dog")).toBe(false);
    });
  });

  describe("main function - const mode", () => {
    it("adds const constraint to oneOf children", () => {
      const doc = buildDoc("Animal", "type", { cat: "Cat", dog: "Dog" }, {
        Cat: objectSchema({ name: { type: "string" } }),
        Dog: objectSchema({ breed: { type: "string" } }),
      });

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);
      expect(result.versionUpgraded).toBe(false);
      expect(Array.isArray(doc.components.schemas.Cat.allOf)).toBe(true);
      expect(Array.isArray(doc.components.schemas.Dog.allOf)).toBe(true);
      expectSchemaConstraint(doc, "Cat", "type", "cat", "const");
      expectSchemaConstraint(doc, "Dog", "type", "dog", "const");
    });
  });

  describe("main function - enum mode", () => {
    it("adds enum constraint to oneOf children", () => {
      const doc = buildDoc("Vehicle", "vehicleType", { car: "Car", truck: "Truck" }, {
        Car: objectSchema({ doors: { type: "integer" } }),
        Truck: objectSchema({ capacity: { type: "number" } }),
      });

      const result = addDiscriminatorConst(doc, { mode: "enum", placement: "children" });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);
      expectSchemaConstraint(doc, "Car", "vehicleType", "car", "enum");
    });
  });

  describe("main function - auto mode", () => {
    it("uses enum for OAS 3.0.x documents", () => {
      const doc = buildDoc("Pet", "petType", { cat: "Cat" }, { Cat: undefined }, "3.0.0");

      const result = addDiscriminatorConst(doc, { mode: "auto", placement: "children" });

      expect(result.constAdded).toBe(1);
      expectSchemaConstraint(doc, "Cat", "petType", "cat", "enum");
    });

    it("uses const for OAS 3.1.x documents", () => {
      const doc = buildDoc("Pet", "petType", { dog: "Dog" }, { Dog: undefined });

      const result = addDiscriminatorConst(doc, { mode: "auto", placement: "children" });

      expect(result.constAdded).toBe(1);
      expectSchemaConstraint(doc, "Dog", "petType", "dog", "const");
    });
  });

  describe("main function - force uplift", () => {
    it("upgrades OAS 3.0.x and emits const in const mode", () => {
      const doc = buildDoc("Pet", "petType", { cat: "Cat" }, { Cat: undefined }, "3.0.0");

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children", forceUplift: true });

      expect(result.versionUpgraded).toBe(true);
      expect(doc.openapi).toBe("3.1.0");
      expectSchemaConstraint(doc, "Cat", "petType", "cat", "const");
    });

    it("falls back to enum in const mode on OAS 3.0.x without uplift", () => {
      const doc = buildDoc("Pet", "petType", { cat: "Cat" }, { Cat: undefined }, "3.0.0");

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.versionUpgraded).toBe(false);
      expectSchemaConstraint(doc, "Cat", "petType", "cat", "enum");
    });
  });

  describe("main function - adapt mode", () => {
    it("uses const and upgrades OAS 3.0.x to 3.1.0", () => {
      const doc = buildDoc("Shape", "shapeType", { circle: "Circle" }, { Circle: undefined }, "3.0.0");

      const result = addDiscriminatorConst(doc, { mode: "adapt", placement: "children" });

      expect(result.versionUpgraded).toBe(true);
      expect(doc.openapi).toBe("3.1.0");
      expect(result.constAdded).toBe(1);
      expectSchemaConstraint(doc, "Circle", "shapeType", "circle", "const");
    });

    it("does not upgrade OAS if already 3.1.0", () => {
      const doc = buildDoc("Shape", "shapeType", { square: "Square" }, { Square: undefined });

      const result = addDiscriminatorConst(doc, { mode: "adapt", placement: "children" });

      expect(result.versionUpgraded).toBe(false);
      expect(doc.openapi).toBe("3.1.0");
    });
  });

  describe("main function - partial constraints", () => {
    it("only updates children without existing constraints", () => {
      const doc = buildDoc("Status", "status", { active: "Active", inactive: "Inactive" }, {
        Active: {
          ...objectSchema(),
          allOf: [constraintFragment("status", "active", "const")],
        },
        Inactive: objectSchema(),
      });

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.constAdded).toBe(1); // Only Inactive gets updated
      expect(result.schemasUpdated).toBe(1);

      // Active should still have only 1 item in allOf
      expect(doc.components.schemas.Active.allOf.length).toBe(1);

      // Inactive should now have allOf with the constraint
      expect(doc.components.schemas.Inactive.allOf.length).toBe(1);
      expectSchemaConstraint(doc, "Inactive", "status", "inactive", "const");
    });
  });

  describe("main function - no changes scenarios", () => {
    it("ignores schema without discriminator", () => {
      const doc: any = {
        components: {
          schemas: {
            Base: {
              oneOf: [
                { $ref: "#/components/schemas/Derived" }
              ]
            },
            Derived: { type: "object" }
          }
        }
      };

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
    });

    it("ignores schema with discriminator but no oneOf", () => {
      const doc: any = {
        components: {
          schemas: {
            Base: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: { derived: "#/components/schemas/Derived" }
              }
            },
            Derived: { type: "object" }
          }
        }
      };

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
    });

    it("returns empty result for empty doc", () => {
      const doc: any = {};
      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
      expect(result.versionUpgraded).toBe(false);
    });

    it("returns zero when all children already have constraints", () => {
      const doc = buildDoc("Animal", "type", { cat: "Cat" }, {
        Cat: {
          ...objectSchema(),
          allOf: [constraintFragment("type", "cat", "const")],
        },
      });

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
    });
  });

  describe("main function - edge cases", () => {
    it("handles multiple schemas with discriminators", () => {
      const doc = new TestDocBuilder()
        .withOpenApi("3.1.0")
        .withParent("Animal", "animalType", { cat: "Cat" })
        .withSchema("Cat")
        .withParent("Vehicle", "vehicleType", { car: "Car" })
        .withSchema("Car")
        .build();

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(2);
      expect(result.constAdded).toBe(2);
      expectSchemaConstraint(doc, "Cat", "animalType", "cat", "const");
      expectSchemaConstraint(doc, "Car", "vehicleType", "car", "const");
    });

    it("handles invalid refs gracefully", () => {
      const doc: any = {
        openapi: "3.0.0",
        components: {
          schemas: {
            Animal: {
              oneOf: [{ $ref: ref("NonExistent") }],
              discriminator: {
                propertyName: "type",
                mapping: { cat: ref("NonExistent") }
              }
            }
          }
        }
      };

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
    });

    it("keeps default behavior when compatibility mode is disabled", () => {
      const doc = buildMappedHierarchyDoc();

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(3);
      expectSchemaConstraint(doc, "A", "@type", "A", "const");
      expectSchemaConstraint(doc, "B", "@type", "B", "const");
      expectSchemaConstraint(doc, "C", "@type", "C", "const");
    });

    it("skips mapped allOf parent schemas in compatibility mode", () => {
      const doc = buildMappedHierarchyDoc();

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children", compatibilityMode: true });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);
      expectSchemaConstraint(doc, "A", "@type", "A", "const", false);
      expectSchemaConstraint(doc, "B", "@type", "B", "const");
      expectSchemaConstraint(doc, "C", "@type", "C", "const");
    });

    it("does not skip mapped schema when no mapped child composes it", () => {
      const doc = buildMappedHierarchyDoc(true);

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children", compatibilityMode: true });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);
      expectSchemaConstraint(doc, "A", "@type", "A", "const");
      expectSchemaConstraint(doc, "B", "@type", "B", "const");
    });

    it("uses a consolidated enum for multiple values on the same child schema", () => {
      const doc = buildDoc("Pet", "petType", { cat: "Cat", feline: "Cat", dog: "Dog" }, { Cat: undefined, Dog: undefined });

      const result = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);
      expectSchemaConstraint(doc, "Cat", "petType", ["cat", "feline"], "enum");
      expectSchemaConstraint(doc, "Dog", "petType", "dog", "const");
    });

    it("uses a consolidated enum for multiple values on the same oneOf branch", () => {
      const doc = buildDoc("Pet", "petType", { cat: "Cat", feline: "Cat", dog: "Dog" }, { Cat: undefined, Dog: undefined });

      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);
      expect(hasOneOfBranchConstraint(doc.components.schemas.Pet, "Cat", "petType", ["cat", "feline"], "enum")).toBe(true);
      expect(hasOneOfBranchConstraint(doc.components.schemas.Pet, "Dog", "petType", "dog", "const")).toBe(true);
    });

    it("is idempotent for grouped discriminator mappings", () => {
      const doc = buildDoc("Pet", "petType", { cat: "Cat", feline: "Cat" }, { Cat: undefined });

      const first = addDiscriminatorConst(doc, { mode: "const", placement: "children" });
      const second = addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      expect(first.constAdded).toBe(1);
      expect(second.constAdded).toBe(0);
      expect(doc.components.schemas.Cat.allOf).toHaveLength(1);
      expectSchemaConstraint(doc, "Cat", "petType", ["cat", "feline"], "enum");
    });
  });

  describe("discriminator property type propagation", () => {
    it("includes type in children constraint when discriminator property has a type in parent schema", () => {
      const doc: any = {
        openapi: "3.1.0",
        components: {
          schemas: {
            Animal: {
              oneOf: [{ $ref: ref("Cat") }, { $ref: ref("Dog") }],
              discriminator: {
                propertyName: "@type",
                mapping: { cat: ref("Cat"), dog: ref("Dog") },
              },
              type: "object",
              properties: {
                "@type": { type: "string" },
              },
            },
            Cat: objectSchema({ name: { type: "string" } }),
            Dog: objectSchema({ breed: { type: "string" } }),
          },
        },
      };

      addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      const catConstraint = doc.components.schemas.Cat.allOf.find(
        (item: any) => item?.properties?.["@type"] !== undefined
      );
      expect(catConstraint?.properties["@type"]).toEqual({ type: "string", const: "cat" });
    });

    it("includes type in oneOf-branches constraint when discriminator property has a type", () => {
      const doc: any = {
        openapi: "3.1.0",
        components: {
          schemas: {
            Animal: {
              oneOf: [{ $ref: ref("Cat") }, { $ref: ref("Dog") }],
              discriminator: {
                propertyName: "@type",
                mapping: { cat: ref("Cat"), dog: ref("Dog") },
              },
              type: "object",
              properties: {
                "@type": { type: "string" },
              },
            },
            Cat: objectSchema({ name: { type: "string" } }),
            Dog: objectSchema({ breed: { type: "string" } }),
          },
        },
      };

      addDiscriminatorConst(doc, { mode: "const" });

      const animalSchema = doc.components.schemas.Animal;
      const catEntry = animalSchema.oneOf.find(
        (entry: any) => Array.isArray(entry?.allOf) && entry.allOf.some((item: any) => item?.$ref === ref("Cat"))
      );
      const catConstraint = catEntry?.allOf.find((item: any) => item?.properties?.["@type"] !== undefined);
      expect(catConstraint?.properties["@type"]).toEqual({ type: "string", const: "cat" });
    });

    it("does not include type when discriminator property has no type defined", () => {
      const doc = buildDoc("Animal", "@type", { cat: "Cat", dog: "Dog" }, {
        Cat: objectSchema({ name: { type: "string" } }),
        Dog: objectSchema({ breed: { type: "string" } }),
      });

      addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      const catConstraint = doc.components.schemas.Cat.allOf.find(
        (item: any) => item?.properties?.["@type"] !== undefined
      );
      expect(catConstraint?.properties["@type"]).not.toHaveProperty("type");
      expect(catConstraint?.properties["@type"]).toEqual({ const: "cat" });
    });

    it("resolves discriminator property type from allOf member in parent schema", () => {
      const doc: any = {
        openapi: "3.1.0",
        components: {
          schemas: {
            Animal: {
              allOf: [
                {
                  type: "object",
                  properties: { "@type": { type: "string" } },
                },
              ],
              oneOf: [{ $ref: ref("Cat") }],
              discriminator: {
                propertyName: "@type",
                mapping: { cat: ref("Cat") },
              },
            },
            Cat: objectSchema({ name: { type: "string" } }),
          },
        },
      };

      addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      const catConstraint = doc.components.schemas.Cat.allOf.find(
        (item: any) => item?.properties?.["@type"] !== undefined
      );
      expect(catConstraint?.properties["@type"]).toEqual({ type: "string", const: "cat" });
    });

    it("resolves discriminator property type by following $ref chain in allOf ancestry", () => {
      // Animal has no properties; AnimalBase is referenced via allOf->$ref and carries the type
      // BaseEntity is referenced from AnimalBase via allOf->$ref and carries the "@type" definition
      const doc: any = {
        openapi: "3.1.0",
        components: {
          schemas: {
            BaseEntity: {
              type: "object",
              properties: { "@type": { type: "string" } },
            },
            AnimalBase: {
              allOf: [{ $ref: ref("BaseEntity") }],
              type: "object",
            },
            Animal: {
              allOf: [{ $ref: ref("AnimalBase") }],
              oneOf: [{ $ref: ref("Cat") }],
              discriminator: {
                propertyName: "@type",
                mapping: { cat: ref("Cat") },
              },
            },
            Cat: objectSchema({ name: { type: "string" } }),
          },
        },
      };

      addDiscriminatorConst(doc, { mode: "const", placement: "children" });

      const catConstraint = doc.components.schemas.Cat.allOf.find(
        (item: any) => item?.properties?.["@type"] !== undefined
      );
      expect(catConstraint?.properties["@type"]).toEqual({ type: "string", const: "cat" });
    });

    it("is cycle-safe when schemas form a circular allOf reference", () => {
      const doc: any = {
        openapi: "3.1.0",
        components: {
          schemas: {
            A: {
              allOf: [{ $ref: ref("B") }],
              oneOf: [{ $ref: ref("Cat") }],
              discriminator: {
                propertyName: "@type",
                mapping: { cat: ref("Cat") },
              },
            },
            B: {
              allOf: [{ $ref: ref("A") }],
              type: "object",
            },
            Cat: objectSchema({ name: { type: "string" } }),
          },
        },
      };

      // Must not throw or hang; no type found so constraint should have no type field
      expect(() => addDiscriminatorConst(doc, { mode: "const", placement: "children" })).not.toThrow();
      const catConstraint = doc.components.schemas.Cat.allOf?.find(
        (item: any) => item?.properties?.["@type"] !== undefined
      );
      expect(catConstraint?.properties["@type"]).toEqual({ const: "cat" });
    });
  });
});
