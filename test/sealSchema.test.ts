import { describe, it, expect } from "vitest";
import { sealSchema } from "../src/lib/sealSchema.js";

describe("sealSchema", () => {
  describe("basic sealing", () => {
    it("seals a simple direct-only object schema with unevaluatedProperties", () => {
      const doc: any = {
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "integer" },
              },
            },
          },
        },
      };

      sealSchema(doc, { useUnevaluatedProperties: true });

      expect(doc.components.schemas.Pet.unevaluatedProperties).toBe(false);
      expect(doc.components.schemas.Pet.additionalProperties).toBeUndefined();
    });

    it("seals a simple direct-only object schema with additionalProperties", () => {
      const doc: any = {
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "integer" },
              },
            },
          },
        },
      };

      sealSchema(doc, { useUnevaluatedProperties: false });

      expect(doc.components.schemas.Pet.additionalProperties).toBe(false);
      expect(doc.components.schemas.Pet.unevaluatedProperties).toBeUndefined();
    });

    it("does not modify already sealed schemas", () => {
      const doc: any = {
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
      };

      sealSchema(doc, { useUnevaluatedProperties: true });

      expect(doc.components.schemas.Pet.additionalProperties).toBe(false);
      expect(doc.components.schemas.Pet.unevaluatedProperties).toBeUndefined();
    });
  });

  describe("core/wrapper pattern for allOf extensions", () => {
    it("creates core variant for schema used in allOf", () => {
      const doc: any = {
        components: {
          schemas: {
            Animal: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
            Cat: {
              allOf: [
                { $ref: "#/components/schemas/Animal" },
                {
                  type: "object",
                  properties: {
                    meow: { type: "boolean" },
                  },
                },
              ],
            },
          },
        },
      };

      sealSchema(doc);

      // Animal should be converted to wrapper
      expect(doc.components.schemas.Animal).toEqual({
        allOf: [{ $ref: "#/components/schemas/AnimalCore" }],
        unevaluatedProperties: false,
      });

      // AnimalCore should be created with original content (no sealing)
      const animalCore = doc.components.schemas.AnimalCore;
      expect(animalCore.type).toBe("object");
      expect(animalCore.properties).toEqual({
        id: { type: "string" },
        name: { type: "string" },
      });

      // Cat should reference AnimalCore in allOf
      expect(doc.components.schemas.Cat.allOf[0].$ref).toBe(
        "#/components/schemas/AnimalCore"
      );
      // Cat should be sealed as a composition root
      expect(doc.components.schemas.Cat.unevaluatedProperties).toBe(false);
    });

    it("handles multiple levels of inheritance", () => {
      const doc: any = {
        components: {
          schemas: {
            Animal: {
              type: "object",
              properties: {
                id: { type: "string" },
              },
            },
            Pet: {
              allOf: [
                { $ref: "#/components/schemas/Animal" },
                {
                  type: "object",
                  properties: {
                    owner: { type: "string" },
                  },
                },
              ],
            },
            Cat: {
              allOf: [
                { $ref: "#/components/schemas/Pet" },
                {
                  type: "object",
                  properties: {
                    meow: { type: "boolean" },
                  },
                },
              ],
            },
          },
        },
      };

      sealSchema(doc);

      // Animal should be core candidate (referenced in allOf by Pet)
      expect(doc.components.schemas.AnimalCore).toBeDefined();
      expect(doc.components.schemas.Animal.allOf[0].$ref).toBe(
        "#/components/schemas/AnimalCore"
      );

      // Pet is referenced in allOf (by Cat), so it should also be a core candidate
      expect(doc.components.schemas.PetCore).toBeDefined();
      
      // Pet wrapper points to PetCore
      expect(doc.components.schemas.Pet.allOf[0].$ref).toBe(
        "#/components/schemas/PetCore"
      );
      
      // PetCore's first allOf should point to AnimalCore (Animal reference was updated)
      expect(doc.components.schemas.PetCore.allOf[0].$ref).toBe(
        "#/components/schemas/AnimalCore"
      );

      // Cat references PetCore in allOf
      expect(doc.components.schemas.Cat.allOf[0].$ref).toBe(
        "#/components/schemas/PetCore"
      );

      // Verify that composition roots are sealed
      expect(doc.components.schemas.Animal.unevaluatedProperties).toBe(false);
      expect(doc.components.schemas.Pet.unevaluatedProperties).toBe(false);
      expect(doc.components.schemas.Cat.unevaluatedProperties).toBe(false);
    });

    it("preserves description when creating wrapper", () => {
      const doc: any = {
        components: {
          schemas: {
            Animal: {
              type: "object",
              description: "An animal in the system",
              properties: {
                id: { type: "string" },
              },
            },
            Cat: {
              allOf: [{ $ref: "#/components/schemas/Animal" }],
            },
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.Animal.description).toBe(
        "An animal in the system"
      );
      expect(doc.components.schemas.AnimalCore.description).toBeUndefined();
    });
  });

  describe("composition root sealing", () => {
    it("seals allOf composition roots", () => {
      const doc: any = {
        components: {
          schemas: {
            Result: {
              allOf: [
                { $ref: "#/components/schemas/BaseResult" },
                {
                  type: "object",
                  properties: {
                    data: { type: "string" },
                  },
                },
              ],
            },
            BaseResult: {
              type: "object",
              properties: {
                status: { type: "string" },
              },
            },
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.Result.unevaluatedProperties).toBe(false);
    });

    it("seals oneOf composition roots", () => {
      const doc: any = {
        components: {
          schemas: {
            PetResponse: {
              oneOf: [
                { $ref: "#/components/schemas/Cat" },
                { $ref: "#/components/schemas/Dog" },
              ],
            },
            Cat: {
              type: "object",
              properties: {
                meow: { type: "boolean" },
              },
            },
            Dog: {
              type: "object",
              properties: {
                bark: { type: "boolean" },
              },
            },
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.PetResponse.unevaluatedProperties).toBe(false);
    });

    it("seals anyOf composition roots", () => {
      const doc: any = {
        components: {
          schemas: {
            FlexibleResponse: {
              anyOf: [
                { $ref: "#/components/schemas/Option1" },
                { $ref: "#/components/schemas/Option2" },
              ],
            },
            Option1: {
              type: "object",
              properties: {
                field1: { type: "string" },
              },
            },
            Option2: {
              type: "object",
              properties: {
                field2: { type: "integer" },
              },
            },
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.FlexibleResponse.unevaluatedProperties).toBe(false);
    });
  });

  describe("inline object sealing", () => {
    it("seals inline objects in properties", () => {
      const doc: any = {
        components: {
          schemas: {
            Person: {
              type: "object",
              properties: {
                name: { type: "string" },
                address: {
                  type: "object",
                  properties: {
                    street: { type: "string" },
                    city: { type: "string" },
                  },
                },
              },
            },
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.Person.unevaluatedProperties).toBe(false);
      expect(
        doc.components.schemas.Person.properties.address.unevaluatedProperties
      ).toBe(false);
    });

    it("seals inline objects in array items", () => {
      const doc: any = {
        components: {
          schemas: {
            People: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      age: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      };

      sealSchema(doc);

      expect(
        doc.components.schemas.People.properties.items.items.unevaluatedProperties
      ).toBe(false);
    });
  });

  describe("complex scenarios", () => {
    it("handles mixed inheritance and direct usage", () => {
      const doc: any = {
        components: {
          schemas: {
            Animal: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
            Cat: {
              allOf: [
                { $ref: "#/components/schemas/Animal" },
                {
                  type: "object",
                  properties: {
                    meow: { type: "boolean" },
                  },
                },
              ],
            },
            Shelter: {
              type: "object",
              properties: {
                animal: { $ref: "#/components/schemas/Animal" },
                cat: { $ref: "#/components/schemas/Cat" },
              },
            },
          },
        },
      };

      sealSchema(doc);

      // Animal should be core + wrapper
      expect(doc.components.schemas.AnimalCore).toBeDefined();
      expect(doc.components.schemas.Animal.allOf[0].$ref).toBe(
        "#/components/schemas/AnimalCore"
      );
      expect(doc.components.schemas.Animal.unevaluatedProperties).toBe(false);

      // Cat references AnimalCore in allOf
      expect(doc.components.schemas.Cat.allOf[0].$ref).toBe(
        "#/components/schemas/AnimalCore"
      );

      // Shelter references sealed Animal and Cat
      expect(doc.components.schemas.Shelter.properties.animal.$ref).toBe(
        "#/components/schemas/Animal"
      );
      expect(doc.components.schemas.Shelter.properties.cat.$ref).toBe(
        "#/components/schemas/Cat"
      );
    });

    it("does not seal non-object schemas", () => {
      const doc: any = {
        components: {
          schemas: {
            Name: {
              type: "string",
              minLength: 1,
            },
            Age: {
              type: "integer",
              minimum: 0,
            },
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.Name.unevaluatedProperties).toBeUndefined();
      expect(doc.components.schemas.Age.unevaluatedProperties).toBeUndefined();
    });

    it("handles document without components.schemas", () => {
      const doc: any = {
        openapi: "3.0.0",
      };

      // Should not throw
      expect(() => sealSchema(doc)).not.toThrow();
    });

    it("handles empty document", () => {
      const doc: any = {};

      // Should not throw
      expect(() => sealSchema(doc)).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("handles schema with both allOf and direct usage", () => {
      const doc: any = {
        components: {
          schemas: {
            Base: {
              type: "object",
              properties: {
                id: { type: "string" },
              },
            },
            Extended: {
              allOf: [
                { $ref: "#/components/schemas/Base" },
                {
                  type: "object",
                  properties: {
                    extra: { type: "string" },
                  },
                },
              ],
            },
            Container: {
              type: "object",
              properties: {
                base: { $ref: "#/components/schemas/Base" },
                extended: { $ref: "#/components/schemas/Extended" },
              },
            },
          },
        },
      };

      sealSchema(doc);

      // Base should be sealed as wrapper since it's extended via allOf
      expect(doc.components.schemas.BaseCore).toBeDefined();
      expect(doc.components.schemas.Base.unevaluatedProperties).toBe(false);

      // Extended should reference BaseCore in allOf
      expect(doc.components.schemas.Extended.allOf[0].$ref).toBe(
        "#/components/schemas/BaseCore"
      );
    });

    it("handles schema with existing unevaluatedProperties", () => {
      const doc: any = {
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
              unevaluatedProperties: false,
            },
            Animal: {
              allOf: [{ $ref: "#/components/schemas/Pet" }],
            },
          },
        },
      };

      sealSchema(doc);

      // Pet should not be turned into core+wrapper since it's already sealed
      expect(doc.components.schemas.PetCore).toBeUndefined();
      expect(doc.components.schemas.Pet.unevaluatedProperties).toBe(false);

      // Animal reference should not be changed
      expect(doc.components.schemas.Animal.allOf[0].$ref).toBe(
        "#/components/schemas/Pet"
      );
    });

    it("handles multiple allOf references in same schema", () => {
      const doc: any = {
        components: {
          schemas: {
            Mixin1: {
              type: "object",
              properties: {
                prop1: { type: "string" },
              },
            },
            Mixin2: {
              type: "object",
              properties: {
                prop2: { type: "string" },
              },
            },
            Combined: {
              allOf: [
                { $ref: "#/components/schemas/Mixin1" },
                { $ref: "#/components/schemas/Mixin2" },
              ],
            },
          },
        },
      };

      sealSchema(doc);

      // Both mixins should have Core variants
      expect(doc.components.schemas.Mixin1Core).toBeDefined();
      expect(doc.components.schemas.Mixin2Core).toBeDefined();

      // Combined should reference both Cores
      expect(doc.components.schemas.Combined.allOf[0].$ref).toBe(
        "#/components/schemas/Mixin1Core"
      );
      expect(doc.components.schemas.Combined.allOf[1].$ref).toBe(
        "#/components/schemas/Mixin2Core"
      );
    });

    it("preserves other schema properties during sealing", () => {
      const doc: any = {
        components: {
          schemas: {
            Pet: {
              type: "object",
              title: "A Pet",
              description: "Represents a pet",
              properties: {
                name: {
                  type: "string",
                  description: "Pet name",
                },
              },
              required: ["name"],
              examples: [{ name: "Fluffy" }],
            },
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.Pet.title).toBe("A Pet");
      expect(doc.components.schemas.Pet.description).toBe("Represents a pet");
      expect(doc.components.schemas.Pet.required).toEqual(["name"]);
      expect(doc.components.schemas.Pet.examples).toEqual([{ name: "Fluffy" }]);
      expect(doc.components.schemas.Pet.properties.name.description).toBe(
        "Pet name"
      );
    });
  });
});
