import { describe, it, expect } from "vitest";
import { cleanupDiscriminatorMappings } from "../src/lib/cleanupDiscriminatorMappings.js";

describe("cleanupDiscriminatorMappings", () => {
  it("should remove mappings pointing to non-existent schemas", () => {
    const doc = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            properties: {
              type: { type: "string" }
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                "Cat": "#/components/schemas/Cat",
                "Dog": "#/components/schemas/Dog",
                "NonExistent": "#/components/schemas/NonExistent"
              }
            }
          },
          Cat: {
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              { type: "object", properties: { meow: { type: "boolean" } } }
            ]
          },
          Dog: {
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              { type: "object", properties: { bark: { type: "boolean" } } }
            ]
          }
        }
      }
    };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(1);
    expect(result.mappingsRemoved).toBe(1);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toEqual({
      schema: "Animal",
      removed: ["NonExistent"]
    });
    expect(doc.components.schemas.Animal.discriminator.mapping).toEqual({
      "Cat": "#/components/schemas/Cat",
      "Dog": "#/components/schemas/Dog"
    });
  });

  it("should handle schemas with valid mappings only", () => {
    const doc = {
      components: {
        schemas: {
          Vehicle: {
            type: "object",
            properties: {
              type: { type: "string" }
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                "Car": "#/components/schemas/Car",
                "Truck": "#/components/schemas/Truck"
              }
            }
          },
          Car: {
            allOf: [
              { $ref: "#/components/schemas/Vehicle" },
              { type: "object", properties: { doors: { type: "number" } } }
            ]
          },
          Truck: {
            allOf: [
              { $ref: "#/components/schemas/Vehicle" },
              { type: "object", properties: { capacity: { type: "number" } } }
            ]
          }
        }
      }
    };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(1);
    expect(result.mappingsRemoved).toBe(0);
    expect(result.details).toHaveLength(0);
    expect(doc.components.schemas.Vehicle.discriminator.mapping).toEqual({
      "Car": "#/components/schemas/Car",
      "Truck": "#/components/schemas/Truck"
    });
  });

  it("should handle multiple discriminators", () => {
    const doc = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                "Cat": "#/components/schemas/Cat",
                "Dead": "#/components/schemas/Dead"
              }
            }
          },
          Pet: {
            type: "object",
            discriminator: {
              propertyName: "kind",
              mapping: {
                "Dog": "#/components/schemas/Dog",
                "Ghost": "#/components/schemas/Ghost"
              }
            }
          },
          Cat: { type: "object" },
          Dog: { type: "object" }
        }
      }
    };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(2);
    expect(result.mappingsRemoved).toBe(2);
    expect(result.details).toHaveLength(2);
    expect(doc.components.schemas.Animal.discriminator.mapping).toEqual({
      "Cat": "#/components/schemas/Cat"
    });
    expect(doc.components.schemas.Pet.discriminator.mapping).toEqual({
      "Dog": "#/components/schemas/Dog"
    });
  });

  it("should handle empty document", () => {
    const result = cleanupDiscriminatorMappings({});

    expect(result.schemasChecked).toBe(0);
    expect(result.mappingsRemoved).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  it("should handle document with no schemas", () => {
    const doc = { components: {} };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(0);
    expect(result.mappingsRemoved).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  it("should handle schemas without discriminators", () => {
    const doc = {
      components: {
        schemas: {
          SimpleSchema: {
            type: "object",
            properties: {
              name: { type: "string" }
            }
          }
        }
      }
    };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(0);
    expect(result.mappingsRemoved).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  it("should handle discriminators without mapping", () => {
    const doc = {
      components: {
        schemas: {
          BaseSchema: {
            type: "object",
            discriminator: {
              propertyName: "type"
            }
          }
        }
      }
    };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(0);
    expect(result.mappingsRemoved).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  it("should handle mapping entries with non-string values", () => {
    const doc = {
      components: {
        schemas: {
          BaseSchema: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                "Valid": "#/components/schemas/Valid",
                "Invalid": 123,
                "Null": null
              }
            }
          },
          Valid: { type: "object" }
        }
      }
    };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(1);
    expect(result.mappingsRemoved).toBe(0);
    expect(result.details).toHaveLength(0);
    // Non-string values should remain unchanged
    expect(doc.components.schemas.BaseSchema.discriminator.mapping).toEqual({
      "Valid": "#/components/schemas/Valid",
      "Invalid": 123,
      "Null": null
    });
  });

  it("should handle refs with different formats", () => {
    const doc = {
      components: {
        schemas: {
          BaseSchema: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                "Valid": "#/components/schemas/Valid",
                "Missing": "#/components/schemas/Missing",
                "InvalidFormat": "not-a-ref"
              }
            }
          },
          Valid: { type: "object" }
        }
      }
    };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(1);
    expect(result.mappingsRemoved).toBe(1);
    expect(result.details[0].removed).toContain("Missing");
    // Invalid format should not be removed (refToName returns undefined)
    expect(doc.components.schemas.BaseSchema.discriminator.mapping).toEqual({
      "Valid": "#/components/schemas/Valid",
      "InvalidFormat": "not-a-ref"
    });
  });
});
