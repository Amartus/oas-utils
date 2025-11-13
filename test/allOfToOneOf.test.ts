import { describe, it, expect } from "vitest";
import { allOfToOneOf } from "../src/lib/allOfToOneOf.js";

describe("allOfToOneOf", () => {
  it("converts allOf + discriminator to oneOf + discriminator with const properties", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            required: ["id", "type", "name"],
            properties: {
              id: {
                type: "string",
                description: "Unique identifier for the animal",
                example: "a1",
              },
              type: {
                type: "string",
                description: "Discriminator property - concrete animal type",
                example: "Cat",
              },
              name: {
                type: "string",
                example: "Whiskers",
              },
              age: {
                type: "integer",
                minimum: 0,
                example: 3,
              },
              gender: {
                type: "string",
                enum: ["male", "female", "unknown"],
                example: "female",
              },
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                Cat: "#/components/schemas/Cat",
                Dog: "#/components/schemas/Dog",
              },
            },
            description: "Abstract animal type. Use the `type` discriminator to select a concrete schema.",
          },
          Cat: {
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              {
                type: "object",
                required: ["huntingSkill"],
                properties: {
                  huntingSkill: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                    description: "Hunting skill level for the cat",
                    example: "medium",
                  },
                  livesLeft: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9,
                    description: "Mythical number of lives remaining",
                    example: 9,
                  },
                },
              },
            ],
            description: "Cat specialization of Animal.",
          },
          Dog: {
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              {
                type: "object",
                required: ["isTrained"],
                properties: {
                  isTrained: {
                    type: "boolean",
                    description: "Whether the dog is trained",
                    example: true,
                  },
                  breed: {
                    type: "string",
                    example: "Labrador",
                  },
                  favoriteToy: {
                    type: "string",
                    example: "rubber ball",
                  },
                },
              },
            ],
            description: "Dog specialization of Animal.",
          },
          Human: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: {
                type: "string",
                example: "h1",
                description: "Unique identifier for the human",
              },
              name: {
                type: "string",
                example: "Alex Johnson",
              },
              age: {
                type: "integer",
                minimum: 0,
                example: 32,
              },
              pets: {
                type: "array",
                description: "Array of animals (polymorphic via discriminator)",
                items: {
                  $ref: "#/components/schemas/Animal",
                },
              },
            },
            description: "A human who may own zero or more pets. Each pet is an Animal and can be a Cat or Dog.",
          },
        },
      },
    };

    allOfToOneOf(doc);

    // Check that wrapper schema was created
    expect(doc.components.schemas.AnimalPolymorphic).toBeDefined();
    expect(doc.components.schemas.AnimalPolymorphic.oneOf).toBeDefined();
    expect(doc.components.schemas.AnimalPolymorphic.oneOf).toHaveLength(2);
    expect(doc.components.schemas.AnimalPolymorphic.discriminator).toBeDefined();
    expect(doc.components.schemas.AnimalPolymorphic.discriminator.propertyName).toBe("type");

    // Check that concrete schemas have const properties as separate allOf items
    const catAllOf = doc.components.schemas.Cat.allOf;
    expect(catAllOf).toBeDefined();
    const catConstItem = catAllOf.find((item: any) => item.properties && item.properties.type && item.properties.type.const === "Cat");
    expect(catConstItem).toBeDefined();
    expect(catConstItem.properties.type).toEqual({ const: "Cat" });
    const parentRefCat = catAllOf.find((item: any) => item.$ref === "#/components/schemas/Animal");
    expect(parentRefCat).toBeDefined();

    const dogAllOf = doc.components.schemas.Dog.allOf;
    expect(dogAllOf).toBeDefined();
    const dogConstItem = dogAllOf.find((item: any) => item.properties && item.properties.type && item.properties.type.const === "Dog");
    expect(dogConstItem).toBeDefined();
    expect(dogConstItem.properties.type).toEqual({ const: "Dog" });
    const parentRefDog = dogAllOf.find((item: any) => item.$ref === "#/components/schemas/Animal");
    expect(parentRefDog).toBeDefined();

    // Check that polymorphic reference in Human is updated
    expect(doc.components.schemas.Human.properties.pets.items.$ref).toBe(
      "#/components/schemas/AnimalPolymorphic"
    );
  });

  it("preserves base schema discriminator by default", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                Cat: "#/components/schemas/Cat",
              },
            },
          },
          Cat: {
            allOf: [{ $ref: "#/components/schemas/Animal" }],
          },
        },
      },
    };

    allOfToOneOf(doc);
    expect(doc.components.schemas.Animal.discriminator).toBeDefined();
  });

  it("removes discriminator from base when option is set", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                Cat: "#/components/schemas/Cat",
              },
            },
          },
          Cat: {
            allOf: [{ $ref: "#/components/schemas/Animal" }],
          },
        },
      },
    };

    allOfToOneOf(doc, { removeDiscriminatorFromBase: true });
    expect(doc.components.schemas.Animal.discriminator).toBeUndefined();
  });

  it("skips adding const to specialization when addDiscriminatorConst is false", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                Cat: "#/components/schemas/Cat",
              },
            },
          },
          Cat: {
            allOf: [{ $ref: "#/components/schemas/Animal" }],
          },
        },
      },
    };

    allOfToOneOf(doc, { addDiscriminatorConst: false });

    const catAllOf = doc.components.schemas.Cat.allOf;
    const catInline = catAllOf.find((item: any) => item.properties && item.properties.type);
    expect(catInline).toBeUndefined();
  });

  it("adds const to specialization by default", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                Dog: "#/components/schemas/Dog",
              },
            },
          },
          Dog: {
            allOf: [{ $ref: "#/components/schemas/Animal" }],
          },
        },
      },
    };

    allOfToOneOf(doc);

    const dogAllOf = doc.components.schemas.Dog.allOf;
    const dogConstItem = dogAllOf.find((item: any) => item.properties && item.properties.type && item.properties.type.const === "Dog");
    expect(dogConstItem).toBeDefined();
    expect(dogConstItem.properties.type).toEqual({ const: "Dog" });
  });

  it("handles multiple polymorphic base schemas", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                Cat: "#/components/schemas/Cat",
              },
            },
          },
          Cat: {
            allOf: [{ $ref: "#/components/schemas/Animal" }],
          },
          Vehicle: {
            type: "object",
            discriminator: {
              propertyName: "vehicleType",
              mapping: {
                Car: "#/components/schemas/Car",
              },
            },
          },
          Car: {
            allOf: [{ $ref: "#/components/schemas/Vehicle" }],
          },
        },
      },
    };

    allOfToOneOf(doc);

    expect(doc.components.schemas.AnimalPolymorphic).toBeDefined();
    expect(doc.components.schemas.VehiclePolymorphic).toBeDefined();
  });

  it("does not modify documents without discriminators", () => {
    const doc: any = {
      components: {
        schemas: {
          Base: {
            type: "object",
          },
          Derived: {
            allOf: [{ $ref: "#/components/schemas/Base" }],
          },
        },
      },
    };

    const before = JSON.stringify(doc);
    allOfToOneOf(doc);
    const after = JSON.stringify(doc);

    expect(before).toBe(after);
  });

  it("handles schemas without allOf references gracefully", () => {
    const doc = {
      components: {
        schemas: {
          Simple: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
        },
      },
    };

    const before = JSON.stringify(doc);
    allOfToOneOf(doc);
    const after = JSON.stringify(doc);

    expect(before).toBe(after);
  });

  it("replaces references in nested structures", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            discriminator: {
              propertyName: "type",
              mapping: {
                Dog: "#/components/schemas/Dog",
              },
            },
          },
          Dog: {
            allOf: [{ $ref: "#/components/schemas/Animal" }],
          },
          Pack: {
            type: "object",
            properties: {
              leader: { $ref: "#/components/schemas/Animal" },
              members: {
                type: "array",
                items: { $ref: "#/components/schemas/Animal" },
              },
            },
          },
        },
      },
    };

    allOfToOneOf(doc);

    // Array items should be replaced
    expect(doc.components.schemas.Pack.properties.members.items.$ref).toBe(
      "#/components/schemas/AnimalPolymorphic"
    );
    // Direct property reference is replaced too (deeply nested replacement)
    expect(doc.components.schemas.Pack.properties.leader.$ref).toBe(
      "#/components/schemas/AnimalPolymorphic"
    );
  });

  it("skips transformation if only one specialization is found with ignoreSingleSpecialization=true", () => {
    const doc: any = {
      components: {
        schemas: {
          Vehicle: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                Car: "#/components/schemas/Car",
              },
            },
          },
          Car: {
            allOf: [
              { $ref: "#/components/schemas/Vehicle" },
              {
                type: "object",
                properties: {
                  numDoors: { type: "integer" },
                },
              },
            ],
          },
        },
      },
    };

    allOfToOneOf(doc, { ignoreSingleSpecialization: true });

    // Should NOT create VehiclePolymorphic wrapper
    expect(doc.components.schemas.VehiclePolymorphic).toBeUndefined();
    // Car should remain unchanged
    expect(doc.components.schemas.Car.allOf[0].$ref).toBe("#/components/schemas/Vehicle");
  });

  it("transforms with single specialization when ignoreSingleSpecialization=false (default)", () => {
    const doc: any = {
      components: {
        schemas: {
          Vehicle: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                Car: "#/components/schemas/Car",
              },
            },
          },
          Car: {
            allOf: [
              { $ref: "#/components/schemas/Vehicle" },
              {
                type: "object",
                properties: {
                  numDoors: { type: "integer" },
                },
              },
            ],
          },
        },
      },
    };

    allOfToOneOf(doc, { ignoreSingleSpecialization: false });

    // Should create VehiclePolymorphic wrapper
    expect(doc.components.schemas.VehiclePolymorphic).toBeDefined();
    expect(doc.components.schemas.VehiclePolymorphic.oneOf).toEqual([
      { $ref: "#/components/schemas/Car" },
    ]);
    // Car should keep referencing the original base schema
    expect(doc.components.schemas.Car.allOf[0].$ref).toBe("#/components/schemas/Vehicle");
  });

  it("handles multi-level inheritance without duplicating const constraints", () => {
    const doc: any = {
      components: {
        schemas: {
          // Base schema with discriminator
          Animal: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                Pet: "#/components/schemas/Pet",
                Dog: "#/components/schemas/Dog",
              },
            },
          },
          // Intermediate schema with discriminator (extends Animal)
          Pet: {
            type: "object",
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              {
                type: "object",
                properties: {
                  owner: { type: "string" },
                },
              },
            ],
            discriminator: {
              propertyName: "type",
              mapping: {
                Dog: "#/components/schemas/Dog",
              },
            },
          },
          // Concrete schema with multi-level inheritance
          Dog: {
            allOf: [
              { $ref: "#/components/schemas/PetFood" },
              { $ref: "#/components/schemas/Pet" },
              { $ref: "#/components/schemas/Animal" },
              {
                type: "object",
                properties: {
                  breed: { type: "string" },
                },
              },
            ],
          },
          // Helper schema
          PetFood: {
            type: "object",
            properties: {
              foodType: { type: "string" },
            },
          },
        },
      },
    };

    allOfToOneOf(doc);

    // Check that wrappers were created
    expect(doc.components.schemas.AnimalPolymorphic).toBeDefined();
    expect(doc.components.schemas.PetPolymorphic).toBeDefined();

    // Check that Dog has const constraints
    const dogAllOf = doc.components.schemas.Dog.allOf;
    expect(dogAllOf).toBeDefined();

    // Count const constraints for "@type": "Dog"
    const constConstraints = dogAllOf.filter(
      (item: any) =>
        item &&
        typeof item === "object" &&
        item.type === "object" &&
        item.properties &&
        item.properties.type &&
        item.properties.type.const === "Dog"
    );

    // Should have exactly ONE const constraint, not multiple duplicates
    expect(constConstraints).toHaveLength(1);
    expect(constConstraints[0].properties.type).toEqual({ const: "Dog" });

    // Verify base references are still there
    const baseRefs = dogAllOf.filter((item: any) => item && item.$ref);
    expect(baseRefs).toHaveLength(3); // PetFood, Pet, Animal
  });
});
