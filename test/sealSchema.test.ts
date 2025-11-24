import { describe, it, expect } from "vitest";
import { sealSchema } from "../src/lib/sealSchema.js";
import {
  loadSchemaFromFile,
  loadSchemasFromFiles,
  withoutProperties,
  withProperties,
  withDescription,
  withMetadata,
  sealed,
} from "./schemaLoader.js";

describe("sealSchema", () => {
  describe("basic sealing", () => {
    it("seals a simple direct-only object schema with unevaluatedProperties", () => {
      const doc: any = {
        components: {
          schemas: {
            Pet: withoutProperties(loadSchemaFromFile("animal"), ["name"]),
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
            Pet: sealed(withoutProperties(loadSchemaFromFile("animal"), ["name"]), false),
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
          schemas: loadSchemasFromFiles({
            Animal: "animal",
            Cat: "cat",
          }),
        },
      };

      sealSchema(doc);

      // Animal should be converted to wrapper
      expect(doc.components.schemas.Animal).toEqual({
        allOf: [{ $ref: "#/components/schemas/AnimalCore" }],
        description: "Abstract animal type",
        unevaluatedProperties: false,
      });

      // AnimalCore should be created with original content (no sealing)
      const animalCore = doc.components.schemas.AnimalCore;
      expect(animalCore.type).toBe("object");
      expect(animalCore.properties).toEqual({
        id: { type: "string", description: "Unique identifier", example: "a1" },
        type: { type: "string", description: "Animal type", example: "Cat" },
        name: { type: "string", example: "Whiskers" },
        age: { type: "integer", minimum: 0, example: 3 },
        gender: { type: "string", enum: ["male", "female", "unknown"], example: "female" },
      });

      // Cat should reference AnimalCore in allOf
      expect(doc.components.schemas.Cat.allOf[0].$ref).toBe(
        "#/components/schemas/AnimalCore"
      );
      // Cat should be sealed as a composition root
      expect(doc.components.schemas.Cat.unevaluatedProperties).toBe(false);
    });

    it("handles multiple levels of inheritance", () => {
      const base = withoutProperties(loadSchemaFromFile("animal"), ["name"]);
      const pet = {
        allOf: [
          { $ref: "#/components/schemas/Base" },
          {
            type: "object",
            properties: {
              owner: { type: "string" },
            },
          },
        ],
      };
      const cat = {
        allOf: [
          { $ref: "#/components/schemas/Pet" },
          {
            type: "object",
            properties: {
              meow: { type: "boolean" },
            },
          },
        ],
      };

      const doc: any = {
        components: {
          schemas: {
            Base: base,
            Pet: pet,
            Cat: cat,
          },
        },
      };

      sealSchema(doc);

      // Base should be core candidate (referenced in allOf by Pet)
      expect(doc.components.schemas.BaseCore).toBeDefined();
      expect(doc.components.schemas.Base.allOf[0].$ref).toBe(
        "#/components/schemas/BaseCore"
      );

      // Pet is referenced in allOf (by Cat), so it should also be a core candidate
      expect(doc.components.schemas.PetCore).toBeDefined();
      
      // Pet wrapper points to PetCore
      expect(doc.components.schemas.Pet.allOf[0].$ref).toBe(
        "#/components/schemas/PetCore"
      );
      
      // PetCore's first allOf should point to BaseCore (Base reference was updated)
      expect(doc.components.schemas.PetCore.allOf[0].$ref).toBe(
        "#/components/schemas/BaseCore"
      );

      // Cat references PetCore in allOf
      expect(doc.components.schemas.Cat.allOf[0].$ref).toBe(
        "#/components/schemas/PetCore"
      );

      // Verify that composition roots are sealed
      expect(doc.components.schemas.Base.unevaluatedProperties).toBe(false);
      expect(doc.components.schemas.Pet.unevaluatedProperties).toBe(false);
      expect(doc.components.schemas.Cat.unevaluatedProperties).toBe(false);
    });

    it("preserves description when creating wrapper", () => {
      const doc: any = {
        components: {
          schemas: {
            Animal: withDescription(
              withoutProperties(loadSchemaFromFile("animal"), ["name"]),
              "An animal in the system"
            ),
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
          schemas: loadSchemasFromFiles({
            Result: "result",
            BaseResult: "base-result",
          }),
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.Result.unevaluatedProperties).toBe(false);
    });

    it("seals oneOf composition roots", () => {
      const catOption = withoutProperties(loadSchemaFromFile("animal"), ["id", "name"]);
      const dogOption = { type: "object", properties: { bark: { type: "boolean" } } };
      const doc: any = {
        components: {
          schemas: {
            PetResponse: {
              oneOf: [
                { $ref: "#/components/schemas/Cat" },
                { $ref: "#/components/schemas/Dog" },
              ],
            },
            Cat: catOption,
            Dog: dogOption,
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.PetResponse.unevaluatedProperties).toBe(false);
    });

    it("seals anyOf composition roots", () => {
      const option1 = { type: "object", properties: { field1: { type: "string" } } };
      const option2 = { type: "object", properties: { field2: { type: "integer" } } };
      const doc: any = {
        components: {
          schemas: {
            FlexibleResponse: {
              anyOf: [
                { $ref: "#/components/schemas/Option1" },
                { $ref: "#/components/schemas/Option2" },
              ],
            },
            Option1: option1,
            Option2: option2,
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
          schemas: loadSchemasFromFiles({
            Person: "person",
          }),
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
          schemas: loadSchemasFromFiles({
            People: "people",
          }),
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
            Animal: loadSchemaFromFile("animal"),
            Cat: loadSchemaFromFile("cat"),
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

      // Animal should be core + wrapper (used in allOf by Cat)
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
            Name: loadSchemaFromFile("string-name"),
            Age: loadSchemaFromFile("integer-age"),
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.Name.unevaluatedProperties).toBeUndefined();
      expect(doc.components.schemas.Age.unevaluatedProperties).toBeUndefined();
    });

    it("handles document without components.schemas", () => {
      const doc: any = {
        openapi: "3.1.0",  // Use compatible version
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
          schemas: loadSchemasFromFiles({
            Base: "base",
            Extended: "extended",
            Container: "container",
          }),
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
      const preSealed = sealed(loadSchemaFromFile("animal"));
      const animalRef = { allOf: [{ $ref: "#/components/schemas/PreSealedSchema" }] };

      const doc: any = {
        components: {
          schemas: {
            PreSealedSchema: preSealed,
            AnimalPreSealed: animalRef,
          },
        },
      };

      sealSchema(doc);

      // PreSealedSchema should not be turned into core+wrapper since it's already sealed
      expect(doc.components.schemas.PreSealedSchemaCore).toBeUndefined();
      expect(doc.components.schemas.PreSealedSchema.unevaluatedProperties).toBe(false);

      // AnimalPreSealed reference should not be changed
      expect(doc.components.schemas.AnimalPreSealed.allOf[0].$ref).toBe(
        "#/components/schemas/PreSealedSchema"
      );
    });

    it("handles multiple allOf references in same schema", () => {
      const mixin1 = loadSchemaFromFile("mixin1");
      const mixin2 = loadSchemaFromFile("mixin1"); // reuse same mixin for second ref
      const combined = {
        allOf: [
          { $ref: "#/components/schemas/Mixin1" },
          { $ref: "#/components/schemas/Mixin2" },
        ],
      };

      const doc: any = {
        components: {
          schemas: {
            Mixin1: mixin1,
            Mixin2: mixin2,
            Combined: combined,
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
      const petComplete = withMetadata(loadSchemaFromFile("animal"), {
        title: "A Pet",
        description: "Represents a pet",
        required: ["id"],
        examples: [{ id: "1", name: "Fluffy" }],
      });

      const doc: any = {
        components: {
          schemas: {
            PetComplete: petComplete,
          },
        },
      };

      sealSchema(doc);

      expect(doc.components.schemas.PetComplete.title).toBe("A Pet");
      expect(doc.components.schemas.PetComplete.description).toBe("Represents a pet");
      expect(doc.components.schemas.PetComplete.required).toEqual(["id"]);
      expect(doc.components.schemas.PetComplete.examples).toEqual([
        { id: "1", name: "Fluffy" },
      ]);
    });
  });

  describe("JSON Schema model sealing", () => {
    it("seals a standalone JSON Schema model with unevaluatedProperties", () => {
      const schema: any = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        title: "User",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
        },
        required: ["id", "name"],
      };

      sealSchema({ components: { schemas: { User: schema } } });

      expect(schema.unevaluatedProperties).toBe(false);
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.title).toBe("User");
    });

    it("seals a JSON Schema model with nested objects", () => {
      const schema: any = {
        type: "object",
        title: "Company",
        properties: {
          name: { type: "string" },
          address: {
            type: "object",
            properties: {
              street: { type: "string" },
              city: { type: "string" },
              zipcode: { type: "string" },
            },
          },
          employees: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
          },
        },
      };

      sealSchema({ components: { schemas: { Company: schema } } });

      expect(schema.unevaluatedProperties).toBe(false);
      expect(schema.properties.address.unevaluatedProperties).toBe(false);
      expect(schema.properties.employees.items.unevaluatedProperties).toBe(false);
    });

    it("seals a JSON Schema model with composition", () => {
      const schemas: any = {
        BaseEntity: {
          type: "object",
          properties: {
            id: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
          required: ["id"],
        },
        Product: {
          allOf: [
            { $ref: "#/components/schemas/BaseEntity" },
            {
              type: "object",
              properties: {
                name: { type: "string" },
                price: { type: "number", minimum: 0 },
              },
              required: ["name"],
            },
          ],
        },
      };

      sealSchema({ components: { schemas: schemas } });

      // BaseEntity should be converted to wrapper + core
      expect(schemas.BaseEntityCore).toBeDefined();
      expect(schemas.BaseEntity.allOf).toBeDefined();
      expect(schemas.BaseEntity.unevaluatedProperties).toBe(false);

      // Product should reference BaseEntityCore
      expect(schemas.Product.allOf[0].$ref).toBe("#/components/schemas/BaseEntityCore");
      expect(schemas.Product.unevaluatedProperties).toBe(false);
    });

    it("preserves JSON Schema metadata while sealing", () => {
      const schema: any = {
        $id: "https://example.com/schemas/user",
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "User Profile",
        description: "A user account in the system",
        type: "object",
        properties: {
          username: { type: "string", minLength: 3, maxLength: 50 },
          email: { type: "string", format: "email" },
          age: { type: "integer", minimum: 0, maximum: 150 },
        },
        required: ["username", "email"],
        examples: [
          { username: "john_doe", email: "john@example.com", age: 30 },
        ],
      };

      sealSchema({ components: { schemas: { UserProfile: schema } } });

      expect(schema.unevaluatedProperties).toBe(false);
      expect(schema.$id).toBe("https://example.com/schemas/user");
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.title).toBe("User Profile");
      expect(schema.description).toBe("A user account in the system");
      expect(schema.examples).toEqual([
        { username: "john_doe", email: "john@example.com", age: 30 },
      ]);
    });

    it("seals root schema with interrelated $defs", () => {
      const schema: any = loadSchemaFromFile("organization");

      sealSchema({ components: { schemas: { Organization: schema } } });

      // Root schema should be sealed
      expect(schema.unevaluatedProperties).toBe(false);

      // All subschemas in $defs should be sealed
      expect(schema.$defs.Address.unevaluatedProperties).toBe(false);
      expect(schema.$defs.Employee.unevaluatedProperties).toBe(false);
      
      // Department uses allOf, so both parts should be sealed
      expect(schema.$defs.Department.allOf[0].unevaluatedProperties).toBe(false);
      expect(schema.$defs.Department.allOf[1].unevaluatedProperties).toBe(false);

      // Metadata should be preserved
      expect(schema.title).toBe("Organization");
      expect(schema.$id).toBe("https://example.com/schemas/organization");
      expect(schema.$defs.Address.title).toBe("Address");
      expect(schema.$defs.Employee.title).toBe("Employee");
      
      // References should be maintained
      expect(schema.properties.headquarters.$ref).toBe("#/$defs/Address");
      expect(schema.$defs.Department.allOf[1].properties.manager.$ref).toBe("#/$defs/Employee");
    });

    it("seals root schema with definitions (JSON Schema Draft 4)", () => {
      const schema: any = loadSchemaFromFile("company");

      sealSchema({ components: { schemas: { Company: schema } } });

      // Root schema should be sealed
      expect(schema.unevaluatedProperties).toBe(false);

      // All subschemas in definitions should be sealed
      expect(schema.definitions.Address.unevaluatedProperties).toBe(false);
      expect(schema.definitions.Manager.unevaluatedProperties).toBe(false);
      
      
      // Department uses allOf, so both parts should be sealed
      expect(schema.definitions.Department.allOf[0].unevaluatedProperties).toBe(false);
      expect(schema.definitions.Department.allOf[1].unevaluatedProperties).toBe(false);

      // Metadata should be preserved
      expect(schema.title).toBe("Company");
      expect(schema.definitions.Address.title).toBe("Address");
      expect(schema.definitions.Manager.title).toBe("Manager");
      
      // References should be maintained
      expect(schema.properties.headquarters.$ref).toBe("#/definitions/Address");
      expect(schema.definitions.Department.allOf[1].properties.manager.$ref).toBe("#/definitions/Manager");
    });
  });

  describe("standalone JSON Schema support", () => {
    it("seals a standalone JSON schema with unevaluatedProperties", () => {
      const standalonSchema: any = {
        $schema: "https://json-schema.org/draft/2020-12/schema",  // Use compatible version
        title: "WbCareProduct",
        type: "object",
        properties: {
          careLevel: {
            type: "string",
            description: "The care level",
          },
        },
        required: ["careLevel"],
      };

      const result = sealSchema(standalonSchema, { useUnevaluatedProperties: true });

      // The result should be the sealed schema, not wrapped in OpenAPI structure
      expect(result.unevaluatedProperties).toBe(false);
      expect(result.title).toBe("WbCareProduct");
      expect(result.type).toBe("object");
      expect(result.properties.careLevel).toEqual({
        type: "string",
        description: "The care level",
      });
      expect(result.required).toEqual(["careLevel"]);
      expect(result.components).toBeUndefined();
    });

    it("seals a standalone JSON schema with additionalProperties", () => {
      const standalonSchema: any = {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "Product",
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const result = sealSchema(standalonSchema, { useUnevaluatedProperties: false });

      expect(result.additionalProperties).toBe(false);
      expect(result.unevaluatedProperties).toBeUndefined();
    });

    it("seals a standalone schema without title", () => {
      const standalonSchema: any = {
        type: "object",
        properties: {
          id: { type: "string" },
        },
      };

      const result = sealSchema(standalonSchema);

      expect(result.unevaluatedProperties).toBe(false);
      expect(result.properties).toEqual({ id: { type: "string" } });
    });

    it("seals a standalone schema with nested $defs", () => {
      const standalonSchema: any = {
        title: "Container",
        type: "object",
        properties: {
          item: { $ref: "#/$defs/Item" },
        },
        $defs: {
          Item: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
        },
      };

      const result = sealSchema(standalonSchema);

      expect(result.unevaluatedProperties).toBe(false);
      expect(result.$defs.Item.unevaluatedProperties).toBe(false);
    });

    it("seals a standalone schema with allOf composition", () => {
      const standalonSchema: any = {
        title: "ExtendedPerson",
        type: "object",
        allOf: [
          {
            type: "object",
            properties: {
              name: { type: "string" },
            },
          },
          {
            type: "object",
            properties: {
              age: { type: "integer" },
            },
          },
        ],
      };

      const result = sealSchema(standalonSchema);

      expect(result.unevaluatedProperties).toBe(false);
      expect(result.allOf[0].unevaluatedProperties).toBe(false);
      expect(result.allOf[1].unevaluatedProperties).toBe(false);
    });

    it("preserves metadata when sealing a standalone schema", () => {
      const standalonSchema: any = {
        $schema: "https://json-schema.org/draft/2020-12/schema",  // Use compatible version
        $id: "https://example.com/product.schema.json",
        title: "Product",
        description: "A product schema",
        type: "object",
        properties: {
          name: { type: "string" },
        },
        examples: [{ name: "Widget" }],
      };

      const result = sealSchema(standalonSchema);

      expect(result.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(result.$id).toBe("https://example.com/product.schema.json");
      expect(result.title).toBe("Product");
      expect(result.description).toBe("A product schema");
      expect(result.examples).toEqual([{ name: "Widget" }]);
      expect(result.unevaluatedProperties).toBe(false);
    });
  });

  describe("version validation and uplift", () => {
    it("throws error when using unevaluatedProperties with OpenAPI 3.0.0 without uplift", () => {
      const doc: any = {
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0.0" },
        paths: {},
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
            },
          },
        },
      };

      expect(() => sealSchema(doc, { useUnevaluatedProperties: true })).toThrow(
        /unevaluatedProperties is only supported in OpenAPI 3.1\+ or JSON Schema 2019-09\+/
      );
    });

    it("automatically upgrades OpenAPI 3.0.0 to 3.1.0 with uplift option", () => {
      const doc: any = {
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0.0" },
        paths: {},
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
            },
          },
        },
      };

      sealSchema(doc, { useUnevaluatedProperties: true, uplift: true });

      expect(doc.openapi).toBe("3.1.0");
      expect(doc.components.schemas.Pet.unevaluatedProperties).toBe(false);
    });

    it("does not throw error when using additionalProperties with OpenAPI 3.0.0", () => {
      const doc: any = {
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0.0" },
        paths: {},
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
            },
          },
        },
      };

      expect(() => sealSchema(doc, { useUnevaluatedProperties: false })).not.toThrow();
      expect(doc.components.schemas.Pet.additionalProperties).toBe(false);
    });

    it("does not modify OpenAPI 3.1.0 when using unevaluatedProperties", () => {
      const doc: any = {
        openapi: "3.1.0",
        info: { title: "Test", version: "1.0.0" },
        paths: {},
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
            },
          },
        },
      };

      sealSchema(doc, { useUnevaluatedProperties: true });

      expect(doc.openapi).toBe("3.1.0");
      expect(doc.components.schemas.Pet.unevaluatedProperties).toBe(false);
    });

    it("throws error when using unevaluatedProperties with JSON Schema draft-07 without uplift", () => {
      const doc: any = {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      expect(() => sealSchema(doc, { useUnevaluatedProperties: true })).toThrow(
        /unevaluatedProperties is only supported in OpenAPI 3.1\+ or JSON Schema 2019-09\+/
      );
    });

    it("automatically upgrades JSON Schema draft-07 to 2020-12 with uplift option", () => {
      const doc: any = {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const result = sealSchema(doc, { useUnevaluatedProperties: true, uplift: true });

      expect(result.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(result.unevaluatedProperties).toBe(false);
    });

    it("does not throw error when using unevaluatedProperties with JSON Schema 2020-12", () => {
      const doc: any = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const result = sealSchema(doc, { useUnevaluatedProperties: true });

      expect(result.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(result.unevaluatedProperties).toBe(false);
    });

    it("does not throw for document without version by default (backward compatibility)", () => {
      const doc: any = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      // Should not throw - backward compatibility
      const result = sealSchema(doc, { useUnevaluatedProperties: true });
      expect(result.unevaluatedProperties).toBe(false);
    });

    it("sets $schema when uplift is enabled for standalone schema without version", () => {
      const doc: any = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const result = sealSchema(doc, { useUnevaluatedProperties: true, uplift: true });

      expect(result.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(result.unevaluatedProperties).toBe(false);
    });

    it("preserves OpenAPI structure when upgrading", () => {
      const doc: any = {
        openapi: "3.0.3",
        info: { title: "Pet Store", version: "2.0.0" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/pets": {
            get: {
              responses: {
                "200": {
                  description: "Success",
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/Pet" },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
            },
          },
        },
      };

      sealSchema(doc, { useUnevaluatedProperties: true, uplift: true });

      expect(doc.openapi).toBe("3.1.0");
      expect(doc.info).toEqual({ title: "Pet Store", version: "2.0.0" });
      expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
      expect(doc.paths).toBeDefined();
      expect(doc.components.schemas.Pet.unevaluatedProperties).toBe(false);
    });
  });
});


