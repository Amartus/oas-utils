import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { allOfToOneOf as allOfToOneOfOriginal } from "../src/lib/allOfToOneOf.js";
import { allOfToOneOf as allOfToOneOfOptimized } from "../src/lib/allOfToOneOfOptimized.js";
import { testSchemas } from "./schemaLoader.js";

async function loadYaml(file: string): Promise<any> {
  const raw = await fs.readFile(file, "utf8");
  return YAML.parse(raw);
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

describe("allOfToOneOfOptimized - comparison with original", () => {
  const cases = [
    "foo-fvo-res",
    "merge-nested-oneof",
  ];

  for (const name of cases) {
    it(`${name} - optimized matches original`, async () => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const base = path.resolve(__dirname, "resources", `${name}`);
      const inputPath = base + ".input.yaml";
      const input = await loadYaml(inputPath);
      
      // Load options if available
      let options: any = undefined;
      try {
        const optsRaw = await fs.readFile(base + ".options.json", "utf8");
        options = JSON.parse(optsRaw);
      } catch {}
      
      const resultOriginal = allOfToOneOfOriginal(deepClone(input), options);
      const resultOptimized = allOfToOneOfOptimized(deepClone(input), options);
      
      expect(resultOptimized).toEqual(resultOriginal);
    });
  }
});

describe("allOfToOneOfOptimized", () => {
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

    allOfToOneOfOptimized(doc);

    // Check that wrapper schema was created
    expect(doc.components.schemas.AnimalPolymorphic).toBeDefined();
    expect(doc.components.schemas.AnimalPolymorphic.oneOf).toBeDefined();
    expect(doc.components.schemas.AnimalPolymorphic.oneOf).toHaveLength(2);
    expect(doc.components.schemas.AnimalPolymorphic.discriminator).toBeDefined();
    expect(doc.components.schemas.AnimalPolymorphic.discriminator.propertyName).toBe("type");

    // Check that concrete schemas have const properties
    const catAllOf = doc.components.schemas.Cat.allOf;
    expect(catAllOf).toBeDefined();
    const catConstItem = catAllOf.find((item: any) => item.properties?.type?.const === "Cat");
    expect(catConstItem).toBeDefined();

    const dogAllOf = doc.components.schemas.Dog.allOf;
    expect(dogAllOf).toBeDefined();
    const dogConstItem = dogAllOf.find((item: any) => item.properties?.type?.const === "Dog");
    expect(dogConstItem).toBeDefined();

    // Check that polymorphic reference in Human is updated
    expect(doc.components.schemas.Human.properties.pets.items.$ref).toBe("#/components/schemas/AnimalPolymorphic");

    // Check that discriminator was removed from base
    expect(doc.components.schemas.Animal.discriminator).toBeUndefined();
  });

  it("does not create wrapper if discriminator has only 1 mapping entry", () => {
    const doc: any = {
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
                Cat: "#/components/schemas/Cat"
              }
            }
          },
          Cat: testSchemas.catSpecialized(),
          Zoo: {
            type: "object",
            properties: {
              animals: {
                type: "array",
                items: { $ref: "#/components/schemas/Animal" }
              }
            }
          }
        }
      }
    };

    allOfToOneOfOptimized(doc);

    // Should not create wrapper with only 1 mapping
    expect(doc.components.schemas.AnimalPolymorphic).toBeUndefined();
    expect(doc.components.schemas.Zoo.properties.animals.items.$ref).toBe("#/components/schemas/Animal");
  });

  it("does not create wrapper if schema is not referenced outside composition", () => {
    const doc: any = {
      components: {
        schemas: {
          Base: {
            type: "object",
            properties: {
              type: { type: "string" }
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                TypeA: "#/components/schemas/TypeA",
                TypeB: "#/components/schemas/TypeB"
              }
            }
          },
          TypeA: {
            allOf: [
              { $ref: "#/components/schemas/Base" },
              { type: "object", properties: { a: { type: "string" } } }
            ]
          },
          TypeB: {
            allOf: [
              { $ref: "#/components/schemas/Base" },
              { type: "object", properties: { b: { type: "string" } } }
            ]
          },
          // Note: No path or component references Base directly
        }
      }
    };

    allOfToOneOfOptimized(doc);

    // Should not create wrapper since Base is only used for inheritance
    expect(doc.components.schemas.BasePolymorphic).toBeUndefined();
    expect(doc.components.schemas.Base.discriminator).toBeDefined();
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
              type: { type: "string" }
            },
            discriminator: {
              propertyName: "type",
              mapping: {
                Pet: "#/components/schemas/Pet",
                Bird: "#/components/schemas/Bird"
              }
            }
          },
          Pet: {
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              { type: "object", properties: { owner: { type: "string" } } }
            ],
            discriminator: {
              propertyName: "type",
              mapping: {
                Cat: "#/components/schemas/Cat",
                Dog: "#/components/schemas/Dog"
              }
            }
          },
          Bird: {
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              { type: "object", properties: { wingSpan: { type: "number" } } }
            ]
          },
          Cat: {
            allOf: [
              { $ref: "#/components/schemas/Pet" },
              { type: "object", properties: { lives: { type: "integer" } } }
            ]
          },
          Dog: {
            allOf: [
              { $ref: "#/components/schemas/Pet" },
              { type: "object", properties: { barkVolume: { type: "number" } } }
            ]
          }
        }
      },
      paths: {
        "/byBase": {
          get: {
            responses: {
              "200": {
                description: "Base A response",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Animal" }
                  }
                }
              }
            }
          }
        },
        "/byIntermediate": {
          get: {
            responses: {
              "200": {
                description: "Intermediate Pet response",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Pet" }
                  }
                }
              }
            }
          }
        }
      }
    };

    allOfToOneOfOptimized(doc);

    // Both Animal and Pet should have wrappers
    expect(doc.components.schemas.AnimalPolymorphic).toBeDefined();
    expect(doc.components.schemas.PetPolymorphic).toBeDefined();

    // Animal wrapper should reference PetPolymorphic (chained)
    const animalOneOf = doc.components.schemas.AnimalPolymorphic.oneOf;
    expect(animalOneOf.some((item: any) => item.$ref === "#/components/schemas/PetPolymorphic")).toBe(true);

    // Paths should reference wrappers
    expect(doc.paths["/byBase"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/AnimalPolymorphic");
    expect(doc.paths["/byIntermediate"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/PetPolymorphic");
  });

  it("warns about children that don't inherit from parent", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: {
            type: "object",
            properties: { type: { type: "string" } },
            discriminator: {
              propertyName: "type",
              mapping: {
                Cat: "#/components/schemas/Cat",
                Vehicle: "#/components/schemas/Vehicle"  // This doesn't inherit from Animal!
              }
            }
          },
          Cat: {
            allOf: [
              { $ref: "#/components/schemas/Animal" },
              { type: "object", properties: { meow: { type: "boolean" } } }
            ]
          },
          Vehicle: {
            type: "object",
            properties: { wheels: { type: "integer" } }
          },
          Zoo: {
            type: "object",
            properties: {
              animals: {
                type: "array",
                items: { $ref: "#/components/schemas/Animal" }
              }
            }
          }
        }
      }
    };

    // Capture console.warn
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.join(' '));
    };

    try {
      allOfToOneOfOptimized(doc);

      // Should still create wrapper but with a warning
      expect(doc.components.schemas.AnimalPolymorphic).toBeDefined();
      expect(warnings.some(w => w.includes('Vehicle') && w.includes('does not inherit'))).toBe(true);
      
      // Both schemas should still be in the oneOf (we keep them with warning)
      expect(doc.components.schemas.AnimalPolymorphic.oneOf).toHaveLength(2);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("supports custom wrapper suffix", () => {
    const doc: any = {
      components: {
        schemas: {
          Animal: testSchemas.animalWithDiscriminator({
            Cat: "#/components/schemas/Cat",
            Dog: "#/components/schemas/Dog",
          }),
          Cat: testSchemas.catSpecialized(),
          Dog: testSchemas.dogSpecialized(),
          Zoo: {
            type: "object",
            properties: {
              animals: {
                type: "array",
                items: { $ref: "#/components/schemas/Animal" }
              }
            }
          }
        }
      }
    };

    allOfToOneOfOptimized(doc, { wrapperSuffix: "Union" });

    expect(doc.components.schemas.AnimalUnion).toBeDefined();
    expect(doc.components.schemas.AnimalPolymorphic).toBeUndefined();
    expect(doc.components.schemas.Zoo.properties.animals.items.$ref).toBe("#/components/schemas/AnimalUnion");
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
                  seatingCapacity: { type: "number" }
                }
              }
            ],
            discriminator: {
              propertyName: "type",
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
              primaryCar: { $ref: "#/components/schemas/Car" },
              commercialVehicle: { $ref: "#/components/schemas/CommercialCar" }
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

    const result = allOfToOneOfOptimized(doc);


    const carWrapper = result.components.schemas.CarPolymorphic;
    expect(carWrapper).toBeDefined();
    const carRefs = carWrapper.oneOf.map((item: any) => item.$ref);
    expect(carRefs).toContain("#/components/schemas/Car");
    expect(carRefs).toContain("#/components/schemas/ElectricCar");
    expect(carRefs).toContain("#/components/schemas/CommercialCar");

    const commercialCar = result.components.schemas.CommercialCar;
    expect(commercialCar).toBeDefined();
    const commercialCarParents = commercialCar.allOf.map((item: any) => item.$ref);
    expect(commercialCarParents).toContain("#/components/schemas/Car");

    const dealershipProps = result.components.schemas.Dealership.properties;
    expect(dealershipProps.primaryCar.$ref).toBe("#/components/schemas/CarPolymorphic");
    expect(dealershipProps.commercialVehicle.$ref).toBe("#/components/schemas/CommercialCar");

    expect(result.components.schemas.Vehicle.discriminator).toBeUndefined();
    expect(result.components.schemas.CommercialCar.discriminator).toBeDefined();
  });

});
