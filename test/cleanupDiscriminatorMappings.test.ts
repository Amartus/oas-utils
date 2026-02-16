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
                "keyToAnimal": "#/components/schemas/Animal",
                "Cat": "#/components/schemas/Cat",
                "Dog": "#/components/schemas/Dog",
                "NonExistent": "#/components/schemas/NonExistent",
                "NoneEx": "#/components/schemas/SomeStrangeSchema"
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
    expect(result.mappingsRemoved).toBe(2);
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toEqual({
      schema: "Animal",
      removed: ["NonExistent", "NoneEx"]
    });
    expect(doc.components.schemas.Animal.discriminator.mapping).toEqual({
      "Cat": "#/components/schemas/Cat",
      "Dog": "#/components/schemas/Dog",
      "keyToAnimal": "#/components/schemas/Animal"
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
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
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
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
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
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
    expect(result.details).toHaveLength(0);
  });

  it("should handle document with no schemas", () => {
    const doc = { components: {} };

    const result = cleanupDiscriminatorMappings(doc);

    expect(result.schemasChecked).toBe(0);
    expect(result.mappingsRemoved).toBe(0);
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
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
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
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
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
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
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
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
    expect(result.discriminatorsRemoved).toBe(0);
    expect(result.removedDiscriminators).toEqual([]);
    expect(result.details[0].removed).toContain("Missing");
    // Invalid format should not be removed (refToName returns undefined)
    expect(doc.components.schemas.BaseSchema.discriminator.mapping).toEqual({
      "Valid": "#/components/schemas/Valid",
      "InvalidFormat": "not-a-ref"
    });
  });

  describe("removeDiscriminatorPatterns option", () => {
    it("should remove discriminators from schemas matching patterns", () => {
      const doc = {
        components: {
          schemas: {
            Animal_RES: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {
                  "Cat": "#/components/schemas/Cat",
                  "Dog": "#/components/schemas/Dog"
                }
              }
            },
            Vehicle_RES: {
              type: "object",
              discriminator: {
                propertyName: "kind",
                mapping: {
                  "Car": "#/components/schemas/Car"
                }
              }
            },
            PersonRequest: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {
                  "Employee": "#/components/schemas/Employee"
                }
              }
            },
            Cat: { type: "object" },
            Dog: { type: "object" },
            Car: { type: "object" },
            Employee: { type: "object" }
          }
        }
      };

      const result = cleanupDiscriminatorMappings(doc, {
        removeDiscriminatorPatterns: ["*_RES"]
      });

      expect(result.discriminatorsRemoved).toBe(2);
      expect(result.removedDiscriminators).toEqual(["Animal_RES", "Vehicle_RES"]);
      expect(result.schemasChecked).toBe(1); // Only PersonRequest was checked for mappings
      expect(result.mappingsRemoved).toBe(0);
      
      // Discriminators should be removed from matching schemas
      expect(doc.components.schemas.Animal_RES.discriminator).toBeUndefined();
      expect(doc.components.schemas.Vehicle_RES.discriminator).toBeUndefined();
      
      // Discriminator should remain in non-matching schema
      expect(doc.components.schemas.PersonRequest.discriminator).toBeDefined();
      expect(doc.components.schemas.PersonRequest.discriminator.propertyName).toBe("type");
    });

    it("should handle multiple patterns", () => {
      const doc = {
        components: {
          schemas: {
            Animal_RES: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {
                  "Cat": "#/components/schemas/Cat"
                }
              }
            },
            VehicleResponse: {
              type: "object",
              discriminator: {
                propertyName: "kind",
                mapping: {
                  "Car": "#/components/schemas/Car"
                }
              }
            },
            Person: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {
                  "Employee": "#/components/schemas/Employee"
                }
              }
            },
            Cat: { type: "object" },
            Car: { type: "object" },
            Employee: { type: "object" }
          }
        }
      };

      const result = cleanupDiscriminatorMappings(doc, {
        removeDiscriminatorPatterns: ["*_RES", "*Response"]
      });

      expect(result.discriminatorsRemoved).toBe(2);
      expect(result.removedDiscriminators).toContain("Animal_RES");
      expect(result.removedDiscriminators).toContain("VehicleResponse");
      expect(doc.components.schemas.Animal_RES.discriminator).toBeUndefined();
      expect(doc.components.schemas.VehicleResponse.discriminator).toBeUndefined();
      expect(doc.components.schemas.Person.discriminator).toBeDefined();
    });

    it("should handle patterns with no matches", () => {
      const doc = {
        components: {
          schemas: {
            Animal: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {
                  "Cat": "#/components/schemas/Cat"
                }
              }
            },
            Cat: { type: "object" }
          }
        }
      };

      const result = cleanupDiscriminatorMappings(doc, {
        removeDiscriminatorPatterns: ["*_RES"]
      });

      expect(result.discriminatorsRemoved).toBe(0);
      expect(result.removedDiscriminators).toEqual([]);
      expect(doc.components.schemas.Animal.discriminator).toBeDefined();
    });

    it("should handle case-sensitive patterns", () => {
      const doc = {
        components: {
          schemas: {
            Animal_RES: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {}
              }
            },
            Animal_res: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {}
              }
            }
          }
        }
      };

      const result = cleanupDiscriminatorMappings(doc, {
        removeDiscriminatorPatterns: ["*_RES"]
      });

      expect(result.discriminatorsRemoved).toBe(1);
      expect(result.removedDiscriminators).toEqual(["Animal_RES"]);
      expect(doc.components.schemas.Animal_RES.discriminator).toBeUndefined();
      expect(doc.components.schemas.Animal_res.discriminator).toBeDefined();
    });

    it("should work without options parameter", () => {
      const doc = {
        components: {
          schemas: {
            Animal_RES: {
              type: "object",
              discriminator: {
                propertyName: "type",
                mapping: {
                  "Cat": "#/components/schemas/Cat"
                }
              }
            },
            Cat: { type: "object" }
          }
        }
      };

      const result = cleanupDiscriminatorMappings(doc);

      expect(result.discriminatorsRemoved).toBe(0);
      expect(result.removedDiscriminators).toEqual([]);
      expect(result.schemasChecked).toBe(1);
      expect(doc.components.schemas.Animal_RES.discriminator).toBeDefined();
    });
  });
});
