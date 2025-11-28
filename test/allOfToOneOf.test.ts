import { describe, it, expect } from "vitest";
import { allOfToOneOf } from "../src/lib/allOfToOneOf.js";
import { testSchemas, withProperties } from "./schemaLoader.js";

describe("allOfToOneOf", () => {
  it("converts allOf + discriminator to oneOf + discriminator with const properties", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: testSchemas.animalWithDiscriminator({
            Cat: "#/components/schemas/Cat",
            Dog: "#/components/schemas/Dog",
          }),
          Cat: testSchemas.catSpecialized(),
          Dog: testSchemas.dogSpecialized(),
          Human: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { type: "string", example: "h1", description: "Unique identifier for the human" },
              name: { type: "string", example: "Alex Johnson" },
              age: { type: "integer", minimum: 0, example: 32 },
              pets: {
                type: "array",
                description: "Array of animals (polymorphic via discriminator)",
                items: { $ref: "#/components/schemas/Animal" },
              },
            },
            description: "A human who may own zero or more pets",
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

  it("removes discriminator from base schema after conversion", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: testSchemas.animalWithDiscriminator({
            Cat: "#/components/schemas/Cat",
          }),
          Cat: testSchemas.catSpecialized(),
        },
      },
    };

    allOfToOneOf(doc);
    expect(doc.components.schemas.Animal.discriminator).toBeUndefined();
  });

  it("skips adding const to specialization when addDiscriminatorConst is false", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: testSchemas.animalWithDiscriminator({
            Cat: "#/components/schemas/Cat",
          }),
          Cat: testSchemas.catSpecialized(),
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
          Animal: testSchemas.animalWithDiscriminator({
            Dog: "#/components/schemas/Dog",
          }),
          Dog: testSchemas.dogSpecialized(),
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
          Animal: testSchemas.animalWithDiscriminator({
            Cat: "#/components/schemas/Cat",
          }),
          Cat: testSchemas.catSpecialized(),
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
          Animal: testSchemas.animalWithDiscriminator({
            Dog: "#/components/schemas/Dog",
          }),
          Dog: testSchemas.dogSpecialized(),
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

  it("updates path-level request/response schemas that reference the polymorphic base", () => {
    const doc: any = {
      openapi: "3.1.0",
      info: { title: "Polymorphic API", version: "1.0.0" },
      paths: {
        "/fooBar": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Animal" },
                },
              },
            },
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Animal" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Animal: testSchemas.animalWithDiscriminator({
            Cat: "#/components/schemas/Cat",
            Dog: "#/components/schemas/Dog",
          }),
          Cat: testSchemas.catSpecialized(),
          Dog: testSchemas.dogSpecialized(),
        },
      },
    };

    allOfToOneOf(doc);

    expect(doc.components.schemas.AnimalPolymorphic).toBeDefined();
    const ref = "#/components/schemas/AnimalPolymorphic";

    expect(
      doc.paths["/fooBar"].post.requestBody.content["application/json"].schema.$ref
    ).toBe(ref);
    expect(
      doc.paths["/fooBar"].post.responses["200"].content["application/json"].schema.$ref
    ).toBe(ref);
  });

  it("updates webhooks and shared components that reference the polymorphic base", () => {
    const doc: any = {
      openapi: "3.1.0",
      info: { title: "Polymorphic API", version: "1.0.0" },
      webhooks: {
        myHook: {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Animal" },
                },
              },
            },
          },
        },
      },
      components: {
        requestBodies: {
          SharedAnimal: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Animal" },
              },
            },
          },
        },
        responses: {
          AnimalResponse: {
            description: "Animal response",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Animal" },
              },
            },
          },
        },
        parameters: {
          AnimalParam: {
            in: "query",
            name: "animal",
            schema: { $ref: "#/components/schemas/Animal" },
          },
        },
        schemas: {
          Animal: testSchemas.animalWithDiscriminator({
            Cat: "#/components/schemas/Cat",
            Dog: "#/components/schemas/Dog",
          }),
          Cat: testSchemas.catSpecialized(),
          Dog: testSchemas.dogSpecialized(),
        },
      },
    };

    allOfToOneOf(doc);

    const ref = "#/components/schemas/AnimalPolymorphic";

    expect(
      doc.webhooks.myHook.post.requestBody.content["application/json"].schema.$ref
    ).toBe(ref);
    expect(
      doc.components.requestBodies.SharedAnimal.content["application/json"].schema.$ref
    ).toBe(ref);
    expect(
      doc.components.responses.AnimalResponse.content["application/json"].schema.$ref
    ).toBe(ref);
    expect(doc.components.parameters.AnimalParam.schema.$ref).toBe(ref);
  });

  it("updates additional component sections that reference the polymorphic base", () => {
    const doc: any = {
      openapi: "3.1.0",
      components: {
        schemas: {
          Animal: testSchemas.animalWithDiscriminator({
            Cat: "#/components/schemas/Cat",
            Dog: "#/components/schemas/Dog",
          }),
          Cat: testSchemas.catSpecialized(),
          Dog: testSchemas.dogSpecialized(),
        },
        headers: {
          AnimalHeader: {
            schema: { $ref: "#/components/schemas/Animal" }
          }
        },
        callbacks: {
          AnimalCallback: {
            "{$request.body#/url}": {
              post: {
                requestBody: {
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/Animal" }
                    }
                  }
                },
                responses: {
                  "200": {
                    description: "OK",
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/Animal" }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        links: {
          AnimalLink: {
            requestBody: {
              $ref: "#/components/schemas/Animal"
            }
          }
        },
        examples: {
          AnimalExample: {
            value: {
              pet: { $ref: "#/components/schemas/Animal" }
            }
          }
        }
      }
    };

    const result = allOfToOneOf(doc, {});

    const wrapperRef = "#/components/schemas/AnimalPolymorphic";
    // headers schema is not rewritten (no allOf polymorphism context there)
    expect((result.components.headers!.AnimalHeader.schema as any).$ref).toBe("#/components/schemas/Animal");
    const cbOp = result.components.callbacks!.AnimalCallback["{$request.body#/url}"].post;
    expect((cbOp.requestBody.content["application/json"].schema as any).$ref).toBe(wrapperRef);
    expect((cbOp.responses["200"].content["application/json"].schema as any).$ref).toBe(wrapperRef);
    expect((result.components.links!.AnimalLink.requestBody as any).$ref).toBe(wrapperRef);
    // examples should remain unchanged
    expect((result.components.examples!.AnimalExample.value.pet as any).$ref).toBe("#/components/schemas/Animal");
  });

  it("skips transformation if only one specialization is found with ignoreSingleSpecialization=true", () => {
    const doc: any = {
      components: {
        schemas: {
          Vehicle: testSchemas.vehicleWithDiscriminator({
            Car: "#/components/schemas/Car",
          }),
          Car: testSchemas.carSpecialized(),
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
          Vehicle: testSchemas.vehicleWithDiscriminator({
            Car: "#/components/schemas/Car",
          }),
          Car: testSchemas.carSpecialized(),
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
          Pet: testSchemas.petIntermediate(),
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
          PetFood: testSchemas.food(),
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

  it("handles nested polymorphic bases with independent wrappers", () => {
    const doc: any = {
      openapi: "3.1.0",
      components: {
        schemas: {
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
                Bird: "#/components/schemas/Bird", 
              },
            },
          },
          Bird: {
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              {
                type: "object",
                properties: {
                  wingSpan: { type: "number" },
                },
              },
            ],
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
            discriminator: {
              propertyName: "type",
              mapping: {
                Cat: "#/components/schemas/Cat", 
                Dog: "#/components/schemas/Dog", 
              },
            },
          },
          Dog: {
            allOf: [
              { $ref: "#/components/schemas/Pet" },
              {
                type: "object",
                properties: {
                  barkVolume: { type: "number" },
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
                  lives: { type: "integer" },
                },
              },
            ],
          },
          PetFood: testSchemas.food(),
        },
      },
      paths: {
        "/byBase": {
          get: {
            responses: {
              "200": {
                description: "Base A response",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Animal" },
                  },
                },
              },
            },
          },
        },
        "/byIntermediate": {
          get: {
            responses: {
              "200": {
                description: "Intermediate Pet response",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Pet" },
                  },
                },
              },
            },
          },
        },
        "/byLeaf": {
          get: {
            responses: {
              "200": {
                description: "Leaf D response",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Cat" },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = allOfToOneOf(doc);
    console.log(JSON.stringify(result, null, 2));

    expect(result.components.schemas.AnimalPolymorphic).toBeDefined();
    const aWrapperRefs = result.components.schemas.AnimalPolymorphic.oneOf.map((s: any) => s.$ref);
    expect(aWrapperRefs).toContain("#/components/schemas/Bird");
    expect(aWrapperRefs).toContain("#/components/schemas/PetPolymorphic");

    expect(
      result.paths["/byBase"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/AnimalPolymorphic");

    expect(
      result.paths["/byIntermediate"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/PetPolymorphic");

    expect(
      result.paths["/byLeaf"].get.responses["200"].content["application/json"].schema.$ref
    ).toBe("#/components/schemas/Cat");
  });
});
