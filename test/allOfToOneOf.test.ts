import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { allOfToOneOf } from "../src/lib/allOfToOneOf.js";
import { testSchemas, withProperties } from "./schemaLoader.js";

async function loadYaml(file: string): Promise<any> {
  const raw = await fs.readFile(file, "utf8");
  return YAML.parse(raw);
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

describe("allOfToOneOf (file-based tests)", () => {
  const cases = [
    "foo-fvo-res",
    "merge-nested-oneof",
  ];

  for (const name of cases) {
    it(name, async () => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const base = path.resolve(__dirname, "resources", `${name}`);
      const inputPath = base + ".input.yaml";
      const expectedPath = base + ".expected.yaml";
      const input = await loadYaml(inputPath);
      const expected = await loadYaml(expectedPath);
      // optional options file
      let options: any = undefined;
      try {
        const optsRaw = await fs.readFile(base + ".options.json", "utf8");
        options = JSON.parse(optsRaw);
      } catch {}
      const actual = allOfToOneOf(deepClone(input), options);
      expect(actual).toEqual(expected);
    });
  }
});

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
      paths: {
        "/test": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Animal" }
                  }
                }
              }
            }
          }
        }
      },
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
      paths: {
        "/test": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Animal" }
                  }
                }
              },
              "201": {
                description: "created",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Vehicle" }
                  }
                }
              }
            }
          }
        }
      },
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
      paths: {
        "/test": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Vehicle" }
                  }
                }
              }
            }
          }
        }
      },
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
      paths: {
        "/test": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Animal" }
                  }
                }
              }
            }
          }
        }
      },
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

  it("converts vehicle hierarchy with commercial vehicle references", () => {
    const doc: any = {
      openapi: "3.0.0",
      components: {
        schemas: {
          Vehicle: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" }
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                Car: "#/components/schemas/Car",
                Bike: "#/components/schemas/Bike",
                ElectricCar: "#/components/schemas/ElectricCar"
              }
            }
          },
          Car: {
            allOf: [
              { $ref: "#/components/schemas/Vehicle" },
              {
                type: "object",
                properties: {
                  carKind: { type: "string" },
                  seatingCapacity: { type: "number" }
                }
              }
            ],
            discriminator: {
              propertyName: "carKind",
              mapping: {
                Car: "#/components/schemas/Car",
                ElectricCar: "#/components/schemas/ElectricCar",
                CommercialCar: "#/components/schemas/CommercialCar"
              }
            }
          },
          ElectricCar: {
            allOf: [
              { $ref: "#/components/schemas/Car" },
              {
                type: "object",
                properties: {
                  batteryCapacity: { type: "number" }
                }
              }
            ]
          },
          Bike: {
            allOf: [
              { $ref: "#/components/schemas/Vehicle" },
              {
                type: "object",
                properties: {
                  engineType: { type: "string" }
                }
              }
            ]
          },
          CommercialCar: {
            allOf: [
              { $ref: "#/components/schemas/Car" },
              {
                type: "object",
                properties: {
                  cargoCapacity: { type: "number" }
                }
              }
            ],
            discriminator: {
              propertyName: "commercialKind",
              mapping: {
                Car: "#/components/schemas/Car",
                ElectricCar: "#/components/schemas/ElectricCar"
              }
            }
          },
          Dealership: {
            type: "object",
            properties: {
              baseVehicle: { $ref: "#/components/schemas/Vehicle" },
              primaryCar: { $ref: "#/components/schemas/Car" },
              commercialVehicle: { $ref: "#/components/schemas/CommercialCar" },
              electricLink: { $ref: "#/components/schemas/ElectricCar" }
            }
          }
        }
      },
      paths: {
        "/dealership": {
          get: {
            responses: {
              "200": {
                description: "Returns dealership",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Dealership" }
                  }
                }
              }
            }
          }
        }
      }
    };

    const result = allOfToOneOf(doc);

    const vehicleWrapper = result.components.schemas.VehiclePolymorphic;
    expect(vehicleWrapper).toBeDefined();
    const vehicleRefs = vehicleWrapper.oneOf.map((item: any) => item.$ref);
    expect(vehicleRefs).toContain("#/components/schemas/Bike");
    expect(vehicleRefs).toContain("#/components/schemas/CarPolymorphic");

    const carWrapper = result.components.schemas.CarPolymorphic;
    expect(carWrapper).toBeDefined();
    const carRefs = carWrapper.oneOf.map((item: any) => item.$ref);
    expect(carRefs).toContain("#/components/schemas/ElectricCar");
    expect(carRefs).toContain("#/components/schemas/CommercialCar");

    const dealershipProps = result.components.schemas.Dealership.properties;
    expect(dealershipProps.baseVehicle.$ref).toBe("#/components/schemas/VehiclePolymorphic");
    expect(dealershipProps.primaryCar.$ref).toBe("#/components/schemas/CarPolymorphic");
    expect(dealershipProps.commercialVehicle.$ref).toBe("#/components/schemas/CommercialCar");
    expect(dealershipProps.electricLink.$ref).toBe("#/components/schemas/ElectricCar");

    expect(result.components.schemas.Vehicle.discriminator).toBeUndefined();
    expect(result.components.schemas.CommercialCar.discriminator).toBeDefined();
  });

  it("merges nested oneOf when mergeNestedOneOf option is enabled", () => {
    const doc: any = {
      openapi: "3.0.0",
      paths: {
        "/products": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Product" }
                  }
                }
              }
            }
          }
        },
        "/subproducts": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/SubProduct" }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Product: {
            type: "object",
            properties: { id: { type: "string" } },
            discriminator: {
              propertyName: "@type",
              mapping: {
                TypeA: "#/components/schemas/TypeA",
                TypeB: "#/components/schemas/TypeB"
              }
            }
          },
          TypeA: { allOf: [{ $ref: "#/components/schemas/Product" }] },
          TypeB: { allOf: [{ $ref: "#/components/schemas/Product" }] },
          SubProduct: {
            type: "object",
            properties: { id: { type: "string" } },
            discriminator: {
              propertyName: "@type",
              mapping: {
                TypeC: "#/components/schemas/TypeC",
                TypeD: "#/components/schemas/TypeD"
              }
            }
          },
          TypeC: { allOf: [{ $ref: "#/components/schemas/SubProduct" }] },
          TypeD: { allOf: [{ $ref: "#/components/schemas/SubProduct" }] }
        }
      }
    };

    const result = allOfToOneOf(doc, { mergeNestedOneOf: true });

    // Check that ProductPolymorphic and SubProductPolymorphic were created
    expect(result.components.schemas.ProductPolymorphic).toBeDefined();
    expect(result.components.schemas.SubProductPolymorphic).toBeDefined();

    // SubProductPolymorphic is a simple oneOf wrapper, so it should be inlined
    // when referenced by ProductPolymorphic if Product referenced it
    // But in this case they're independent, so no merging happens
    
    const productOneOf = result.components.schemas.ProductPolymorphic.oneOf;
    const productRefs = productOneOf.map((item: any) => item.$ref);
    expect(productRefs).toContain("#/components/schemas/TypeA");
    expect(productRefs).toContain("#/components/schemas/TypeB");
    expect(productRefs).toHaveLength(2);
  });

  it("merges nested oneOf schemas that are referenced", () => {
    const doc: any = {
      openapi: "3.0.0",
      paths: {
        "/products": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ProductPolymorphic" }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          // Manually created polymorphic wrappers (not created by allOfToOneOf)
          ProductPolymorphic: {
            oneOf: [
              { $ref: "#/components/schemas/TypeA" },
              { $ref: "#/components/schemas/SubProductPolymorphic" }
            ],
            discriminator: {
              propertyName: "@type",
              mapping: {
                TypeA: "#/components/schemas/TypeA"
              }
            }
          },
          SubProductPolymorphic: {
            oneOf: [
              { $ref: "#/components/schemas/TypeB" },
              { $ref: "#/components/schemas/TypeC" }
            ],
            discriminator: {
              propertyName: "@type",
              mapping: {
                TypeB: "#/components/schemas/TypeB",
                TypeC: "#/components/schemas/TypeC"
              }
            }
          },
          TypeA: { type: "object", properties: { name: { type: "string" } } },
          TypeB: { type: "object", properties: { name: { type: "string" } } },
          TypeC: { type: "object", properties: { name: { type: "string" } } }
        }
      }
    };

    const result = allOfToOneOf(doc, { mergeNestedOneOf: true });

    // ProductPolymorphic should have TypeA, TypeB, TypeC (SubProductPolymorphic inlined)
    const productOneOf = result.components.schemas.ProductPolymorphic.oneOf;
    const refs = productOneOf.map((item: any) => item.$ref);
    
    expect(refs).toContain("#/components/schemas/TypeA");
    expect(refs).toContain("#/components/schemas/TypeB");
    expect(refs).toContain("#/components/schemas/TypeC");
    expect(refs).not.toContain("#/components/schemas/SubProductPolymorphic");
    expect(refs).toHaveLength(3);

    // Check discriminator mapping was merged
    const mapping = result.components.schemas.ProductPolymorphic.discriminator.mapping;
    expect(mapping.TypeA).toBe("#/components/schemas/TypeA");
    expect(mapping.TypeB).toBe("#/components/schemas/TypeB");
    expect(mapping.TypeC).toBe("#/components/schemas/TypeC");
  });

  it("does not merge nested oneOf when option is disabled (default)", () => {
    const doc: any = {
      openapi: "3.0.0",
      components: {
        schemas: {
          Product: {
            type: "object",
            discriminator: {
              propertyName: "@type",
              mapping: {
                TypeA: "#/components/schemas/TypeA",
                SubProduct: "#/components/schemas/SubProduct"
              }
            }
          },
          TypeA: { allOf: [{ $ref: "#/components/schemas/Product" }] },
          SubProduct: {
            type: "object",
            discriminator: {
              propertyName: "@type",
              mapping: {
                TypeB: "#/components/schemas/TypeB"
              }
            }
          },
          TypeB: { allOf: [{ $ref: "#/components/schemas/SubProduct" }] }
        }
      }
    };

    // Don't pass mergeNestedOneOf option (defaults to false)
    const result = allOfToOneOf(doc);

    // ProductPolymorphic should NOT have TypeB inlined
    expect(result.components.schemas.ProductPolymorphic).toBeUndefined();
    expect(result.components.schemas.SubProductPolymorphic).toBeUndefined();
  });
});
