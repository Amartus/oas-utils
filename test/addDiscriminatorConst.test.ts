import { describe, it, expect } from "vitest";
import { addDiscriminatorConst, createConstConstraint, hasConstOrEnumConstraint } from "../src/lib/addDiscriminatorConst.js";
import {
  TestDocBuilder,
  objectSchema,
  constraintFragment,
  hasConstraint,
  ref,
} from "./testBuilders.js";

describe("addDiscriminatorConst", () => {
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
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.0.0")
        .withParent("Animal", "type", { cat: "Cat", dog: "Dog" })
        .withSchema("Cat", objectSchema({ name: { type: "string" } }))
        .withSchema("Dog", objectSchema({ breed: { type: "string" } }))
        .build();

      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);
      expect(result.versionUpgraded).toBe(false);

      // Cat should have const constraint
      const catSchema = doc.components.schemas.Cat;
      expect(Array.isArray(catSchema.allOf)).toBe(true);
      expect(hasConstraint(catSchema, "type", "cat", "const")).toBe(true);

      // Dog should have const constraint
      const dogSchema = doc.components.schemas.Dog;
      expect(Array.isArray(dogSchema.allOf)).toBe(true);
      expect(hasConstraint(dogSchema, "type", "dog", "const")).toBe(true);
    });
  });

  describe("main function - enum mode", () => {
    it("adds enum constraint to oneOf children", () => {
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.1.0")
        .withParent("Vehicle", "vehicleType", { car: "Car", truck: "Truck" })
        .withSchema("Car", objectSchema({ doors: { type: "integer" } }))
        .withSchema("Truck", objectSchema({ capacity: { type: "number" } }))
        .build();

      const result = addDiscriminatorConst(doc, { mode: "enum" });

      expect(result.schemasUpdated).toBe(1);
      expect(result.constAdded).toBe(2);

      // Car should have enum constraint
      const carSchema = doc.components.schemas.Car;
      expect(hasConstraint(carSchema, "vehicleType", "car", "enum")).toBe(true);
    });
  });

  describe("main function - auto mode", () => {
    it("uses const for OAS 3.0.x documents", () => {
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.0.0")
        .withParent("Pet", "petType", { cat: "Cat" })
        .withSchema("Cat")
        .build();

      const result = addDiscriminatorConst(doc, { mode: "auto" });

      expect(result.constAdded).toBe(1);
      const catSchema = doc.components.schemas.Cat;
      expect(hasConstraint(catSchema, "petType", "cat", "const")).toBe(true);
    });

    it("uses enum for OAS 3.1.x documents", () => {
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.1.0")
        .withParent("Pet", "petType", { dog: "Dog" })
        .withSchema("Dog")
        .build();

      const result = addDiscriminatorConst(doc, { mode: "auto" });

      expect(result.constAdded).toBe(1);
      const dogSchema = doc.components.schemas.Dog;
      expect(hasConstraint(dogSchema, "petType", "dog", "enum")).toBe(true);
    });
  });

  describe("main function - adapt mode", () => {
    it("uses const and upgrades OAS 3.0.x to 3.1.0", () => {
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.0.0")
        .withParent("Shape", "shapeType", { circle: "Circle" })
        .withSchema("Circle")
        .build();

      const result = addDiscriminatorConst(doc, { mode: "adapt" });

      expect(result.versionUpgraded).toBe(true);
      expect(doc.openapi).toBe("3.1.0");
      expect(result.constAdded).toBe(1);
      expect(hasConstraint(doc.components.schemas.Circle, "shapeType", "circle", "const")).toBe(true);
    });

    it("does not upgrade OAS if already 3.1.0", () => {
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.1.0")
        .withParent("Shape", "shapeType", { square: "Square" })
        .withSchema("Square")
        .build();

      const result = addDiscriminatorConst(doc, { mode: "adapt" });

      expect(result.versionUpgraded).toBe(false);
      expect(doc.openapi).toBe("3.1.0");
    });
  });

  describe("main function - partial constraints", () => {
    it("only updates children without existing constraints", () => {
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.0.0")
        .withParent("Status", "status", { active: "Active", inactive: "Inactive" })
        .withSchema("Active", {
          ...objectSchema(),
          allOf: [constraintFragment("status", "active", "const")],
        })
        .withSchema("Inactive", objectSchema())
        .build();

      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.constAdded).toBe(1); // Only Inactive gets updated
      expect(result.schemasUpdated).toBe(1);

      // Active should still have only 1 item in allOf
      expect(doc.components.schemas.Active.allOf.length).toBe(1);

      // Inactive should now have allOf with the constraint
      expect(doc.components.schemas.Inactive.allOf.length).toBe(1);
      expect(hasConstraint(doc.components.schemas.Inactive, "status", "inactive", "const")).toBe(true);
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

      const result = addDiscriminatorConst(doc, { mode: "const" });

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

      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
    });

    it("returns empty result for empty doc", () => {
      const doc: any = {};
      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
      expect(result.versionUpgraded).toBe(false);
    });

    it("returns zero when all children already have constraints", () => {
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.0.0")
        .withParent("Animal", "type", { cat: "Cat" })
        .withSchema("Cat", {
          ...objectSchema(),
          allOf: [constraintFragment("type", "cat", "const")],
        })
        .build();

      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
    });
  });

  describe("main function - edge cases", () => {
    it("handles multiple schemas with discriminators", () => {
      const doc: any = new TestDocBuilder()
        .withOpenApi("3.0.0")
        .withParent("Animal", "animalType", { cat: "Cat" })
        .withSchema("Cat")
        .withParent("Vehicle", "vehicleType", { car: "Car" })
        .withSchema("Car")
        .build();

      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.schemasUpdated).toBe(2);
      expect(result.constAdded).toBe(2);

      expect(hasConstraint(doc.components.schemas.Cat, "animalType", "cat", "const")).toBe(true);
      expect(hasConstraint(doc.components.schemas.Car, "vehicleType", "car", "const")).toBe(true);
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

      const result = addDiscriminatorConst(doc, { mode: "const" });

      expect(result.schemasUpdated).toBe(0);
      expect(result.constAdded).toBe(0);
    });
  });
});
