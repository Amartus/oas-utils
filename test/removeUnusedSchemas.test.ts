import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { removeUnusedSchemas } from "../src/lib/removeUnusedSchemas";
import { testSchemas } from "./schemaLoader.js";

async function loadYaml(file: string): Promise<any> {
  const raw = await fs.readFile(file, "utf8");
  return YAML.parse(raw);
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

// Test helpers for building OpenAPI documents
const builders = {
  doc: (paths: any, schemas: Record<string, any>) => ({
    openapi: "3.0.3",
    paths,
    components: { schemas }
  }),

  path: (method: string, response: any) => ({
    [method]: { responses: { "200": response } }
  }),

  jsonResponse: (schemaRef: string, description = "ok") => ({
    description,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaRef}` }
      }
    }
  }),

  arrayResponse: (itemsRef: string, description = "ok") => ({
    description,
    content: {
      "application/json": {
        schema: {
          type: "array",
          items: { $ref: `#/components/schemas/${itemsRef}` }
        }
      }
    }
  }),

  schema: {
    simple: (type: string) => {
      const obj = { type } as any;
      obj.withDiscriminator = (propertyName: string, mapping: Record<string, string>) => {
        obj.required = [propertyName];
        obj.properties = { ...obj.properties, [propertyName]: { type: "string" } };
        obj.discriminator = { propertyName, mapping };
        return obj;
      };
      return obj;
    },
    
    withProps: (properties: Record<string, any>) => {
      const obj = {
        type: "object",
        properties
      } as any;
      obj.withDiscriminator = (propertyName: string, mapping: Record<string, string>) => {
        obj.required = [propertyName];
        obj.properties = { ...obj.properties, [propertyName]: { type: "string" } };
        obj.discriminator = { propertyName, mapping };
        return obj;
      };
      return obj;
    },

    withRef: (name: string) => ({ $ref: `#/components/schemas/${name}` }),

    allOf: (refs: string[], inline?: any) => ({
      allOf: [
        ...refs.map(ref => ({ $ref: `#/components/schemas/${ref}` })),
        ...(inline ? [inline] : [])
      ]
    }),

    oneOf: (refs: string[]) => ({
      oneOf: refs.map(ref => ({ $ref: `#/components/schemas/${ref}` }))
    }),

    withDiscriminator: (propertyName: string, mapping: Record<string, string>) => ({
      type: "object",
      required: [propertyName],
      properties: {
        [propertyName]: { type: "string" }
      },
      discriminator: { propertyName, mapping }
    }),

    arrayOf: (itemsRef: string) => ({
      type: "array",
      items: { $ref: `#/components/schemas/${itemsRef}` }
    })
  }
};

// Reusable polymorphic hierarchy builders
const polymorphicBuilders = {
  // Build a simple 2-level animal hierarchy (Animal -> Dog, Cat)
  animalHierarchy: () => ({
    Animal: builders.schema.simple("object"),
    Dog: builders.schema.allOf(["Animal"], 
      builders.schema.withProps({ breed: { type: "string" }, barkVolume: { type: "number" } })),
    Cat: builders.schema.allOf(["Animal"], 
      builders.schema.withProps({ lives: { type: "integer" } }))
  }),

  // Build a 3-level hierarchy (Animal -> Mammal/Bird -> Dog/Cat/Eagle/Penguin)
  multiLevelAnimalHierarchy: (includeToys = false) => {
    const schemas: Record<string, any> = {
      Animal: {
        ...builders.schema.withDiscriminator("type", {
          mammal: "#/components/schemas/Mammal",
          bird: "#/components/schemas/Bird"
        }),
        properties: {
          type: { type: "string" },
          name: { type: "string" }
        }
      },
      Mammal: builders.schema.allOf(["Animal"], 
        builders.schema.withProps({ furColor: { type: "string" } })),
      Bird: builders.schema.allOf(["Animal"], 
        builders.schema.withProps({ wingSpan: { type: "number" } })),
      Dog: builders.schema.allOf(["Mammal"], 
        builders.schema.withProps({ breed: { type: "string" }, barkVolume: { type: "number" } })),
      Cat: builders.schema.allOf(["Mammal"], 
        builders.schema.withProps({ 
          lives: { type: "integer" },
          ...(includeToys ? { favoriteToys: builders.schema.arrayOf("Toy") } : {})
        })),
      Eagle: builders.schema.allOf(["Bird"], 
        builders.schema.withProps({ talonsSharp: { type: "boolean" } })),
      Penguin: builders.schema.allOf(["Bird"], 
        builders.schema.withProps({ canSwim: { type: "boolean" } }))
    };

    if (includeToys) {
      Object.assign(schemas, polymorphicBuilders.toyHierarchy());
    }

    return schemas;
  },

  // Build toy hierarchy (Toy -> Ball, FeatherToy)
  toyHierarchy: () => ({
    Toy: {
      ...builders.schema.withDiscriminator("toyType", {
        ball: "#/components/schemas/Ball",
        feather: "#/components/schemas/FeatherToy"
      }),
      properties: {
        toyType: { type: "string" },
        name: { type: "string" }
      }
    },
    Ball: builders.schema.allOf(["Toy"], 
      builders.schema.withProps({ size: { type: "string" }, color: { type: "string" } })),
    FeatherToy: builders.schema.allOf(["Toy"], 
      builders.schema.withProps({ featherCount: { type: "integer" } }))
  }),

  // Build vehicle hierarchy (Vehicle -> MotorVehicle/Bicycle -> Car/Motorcycle)
  vehicleHierarchy: () => ({
    Vehicle: builders.schema.withProps({ 
      type: { type: "string" },
      manufacturer: builders.schema.withRef("Manufacturer")
    }),
    Manufacturer: builders.schema.withProps({ 
      name: { type: "string" },
      country: { type: "string" }
    }),
    MotorVehicle: builders.schema.allOf(["Vehicle"], 
      builders.schema.withProps({ engine: builders.schema.withRef("Engine") })),
    Engine: builders.schema.withProps({ 
      horsepower: { type: "number" },
      fuelType: { type: "string" }
    }),
    Car: builders.schema.allOf(["MotorVehicle"], 
      builders.schema.withProps({ doors: { type: "integer" } })),
    Motorcycle: builders.schema.allOf(["MotorVehicle"], 
      builders.schema.withProps({ hasStorage: { type: "boolean" } })),
    Bicycle: builders.schema.allOf(["Vehicle"], 
      builders.schema.withProps({ gears: { type: "integer" } }))
  })
};

describe("removeUnusedSchemas (fixtures)", () => {
  const cases = [
    "basic-transitive",
    "paths-only",
    "components-ref",
    "allof-promotion",
    "allof-transitive",
    "keep-option",
    "aggressive-components",
    "allof-promotion-positive",
    "allof-promotion-negative",
    "allof-ignore-parent",
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
      const actual = removeUnusedSchemas(deepClone(input), options);
      expect(actual).toEqual(expected);
    });
  }
});

describe("removeUnusedSchemas (unit tests)", () => {
  it("should handle null/undefined input gracefully", () => {
    expect(removeUnusedSchemas(null as any)).toBe(null);
    expect(removeUnusedSchemas(undefined as any)).toBe(undefined);
    expect(removeUnusedSchemas("string" as any)).toBe("string");
  });

  it("should handle document with no components", () => {
    const doc = {
      openapi: "3.0.3",
      paths: {
        "/test": {
          get: {
            responses: {
              "200": { description: "ok" }
            }
          }
        }
      }
    };
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result).toEqual(doc);
  });

  it("should handle document with empty schemas", () => {
    const doc = builders.doc({}, {});
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas).toEqual({});
  });

  it("should keep schemas referenced directly in paths", () => {
    const doc = builders.doc(
      { "/pet": builders.path("get", builders.jsonResponse("Pet")) },
      {
        Pet: builders.schema.simple("object"),
        Unused: builders.schema.simple("string")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas).toEqual({
      Pet: { type: "object" }
    });
  });

  it("should follow transitive references", () => {
    const doc = builders.doc(
      { "/pet": builders.path("get", builders.jsonResponse("Pet")) },
      {
        Pet: builders.schema.withProps({ id: builders.schema.withRef("Id") }),
        Id: builders.schema.simple("string"),
        Unused: builders.schema.simple("string")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas.Pet).toBeDefined();
    expect(result.components.schemas.Id).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
  });

  it("should promote schemas via allOf when parent is referenced", () => {
    const doc = builders.doc(
      { "/animals": builders.path("get", builders.jsonResponse("Animal")) },
      {
        Animal: builders.schema.simple("object"),
        Dog: builders.schema.allOf(["Animal"], 
          builders.schema.withProps({ breed: { type: "string" } })),
        Cat: builders.schema.allOf(["Animal"], 
          builders.schema.withProps({ color: { type: "string" } })),
        Unrelated: builders.schema.simple("string")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas.Animal).toBeDefined();
    expect(result.components.schemas.Dog).toBeDefined();
    expect(result.components.schemas.Cat).toBeDefined();
    expect(result.components.schemas.Unrelated).toBeUndefined();
  });

  it("should NOT promote via allOf when parent is ignored", () => {
    const doc = builders.doc(
      { "/animals": builders.path("get", builders.jsonResponse("Animal")) },
      {
        Animal: builders.schema.simple("object"),
        IgnoredBase: builders.schema.simple("object"),
        Dog: builders.schema.allOf(["Animal"], 
          builders.schema.withProps({ breed: { type: "string" } })),
        Cat: builders.schema.allOf(["IgnoredBase"], 
          builders.schema.withProps({ color: { type: "string" } }))
      }
    );
    const result = removeUnusedSchemas(deepClone(doc), { 
      ignoreParents: ["IgnoredBase"] 
    });
    expect(result.components.schemas.Animal).toBeDefined();
    expect(result.components.schemas.Dog).toBeDefined();
    expect(result.components.schemas.IgnoredBase).toBeUndefined();
    expect(result.components.schemas.Cat).toBeUndefined();
  });

  it("should handle transitive allOf promotion", () => {
    const doc = builders.doc(
      { "/entity": builders.path("get", builders.jsonResponse("Base")) },
      {
        Base: builders.schema.simple("object"),
        Level1: builders.schema.allOf(["Base"], 
          builders.schema.withProps({ l1: { type: "string" } })),
        Level2: builders.schema.allOf(["Level1"], 
          builders.schema.withProps({ l2: { type: "string" } })),
        Unrelated: builders.schema.simple("string")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas.Base).toBeDefined();
    expect(result.components.schemas.Level1).toBeDefined();
    expect(result.components.schemas.Level2).toBeDefined();
    expect(result.components.schemas.Unrelated).toBeUndefined();
  });

  it("should respect keep option", () => {
    const doc = builders.doc(
      { "/test": builders.path("get", builders.jsonResponse("Used")) },
      {
        Used: builders.schema.simple("object"),
        Unused: builders.schema.simple("string"),
        KeepMe: builders.schema.simple("number")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc), { 
      keep: ["KeepMe"] 
    });
    expect(result.components.schemas.Used).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
    expect(result.components.schemas.KeepMe).toBeDefined();
  });

  it("should follow refs through non-schema components to find schemas", () => {
    const doc = {
      openapi: "3.0.3",
      paths: {
        "/test": {
          post: {
            parameters: [
              { $ref: "#/components/parameters/TestParam" }
            ],
            responses: {
              "200": { description: "ok" }
            }
          }
        }
      },
      components: {
        parameters: {
          TestParam: {
            in: "query",
            name: "test",
            schema: { $ref: "#/components/schemas/ParamSchema" }
          }
        },
        schemas: {
          ParamSchema: { type: "string" },
          Unused: { type: "object" }
        }
      }
    };
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas.ParamSchema).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
  });

  it("should remove unused non-schema components when aggressive is true", () => {
    const doc = {
      openapi: "3.0.3",
      paths: {
        "/test": {
          get: {
            responses: {
              "200": { $ref: "#/components/responses/UsedResponse" }
            }
          }
        }
      },
      components: {
        responses: {
          UsedResponse: {
            description: "ok",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ResponseSchema" }
              }
            }
          },
          UnusedResponse: {
            description: "unused"
          }
        },
        parameters: {
          UnusedParam: {
            in: "query",
            name: "test"
          }
        },
        schemas: {
          ResponseSchema: { type: "object" },
          Unused: { type: "string" }
        }
      }
    };
    const result = removeUnusedSchemas(deepClone(doc), { aggressive: true });
    expect(result.components.responses.UsedResponse).toBeDefined();
    expect(result.components.responses.UnusedResponse).toBeUndefined();
    expect(result.components.parameters).toBeUndefined();
    expect(result.components.schemas.ResponseSchema).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
  });

  it("should NOT remove unused non-schema components when aggressive is false", () => {
    const doc = {
      openapi: "3.0.3",
      paths: {
        "/test": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Used" }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        parameters: {
          UnusedParam: {
            in: "query",
            name: "test"
          }
        },
        schemas: {
          Used: { type: "object" },
          Unused: { type: "string" }
        }
      }
    };
    const result = removeUnusedSchemas(deepClone(doc), { aggressive: false });
    expect(result.components.parameters.UnusedParam).toBeDefined();
    expect(result.components.schemas.Used).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
  });

  it("should handle allOf nested in properties", () => {
    const doc = builders.doc(
      { "/test": builders.path("get", builders.jsonResponse("Container")) },
      {
        Base: builders.schema.simple("object"),
        Child: builders.schema.allOf(["Base"]),
        Container: builders.schema.withProps({
          nested: {
            allOf: [
              { $ref: "#/components/schemas/Base" },
              { type: "object" }
            ]
          }
        }),
        Unused: builders.schema.simple("string")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas.Base).toBeDefined();
    expect(result.components.schemas.Child).toBeDefined();
    expect(result.components.schemas.Container).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
  });

  it("should handle multiple ignoreParents", () => {
    const doc = builders.doc(
      { "/test": builders.path("get", builders.jsonResponse("Used")) },
      {
        Used: builders.schema.simple("object"),
        IgnoredA: builders.schema.simple("object"),
        IgnoredB: builders.schema.simple("object"),
        ChildOfA: builders.schema.allOf(["IgnoredA"]),
        ChildOfB: builders.schema.allOf(["IgnoredB"]),
        ChildOfUsed: builders.schema.allOf(["Used"])
      }
    );
    const result = removeUnusedSchemas(deepClone(doc), { 
      ignoreParents: ["IgnoredA", "IgnoredB"] 
    });
    expect(result.components.schemas.Used).toBeDefined();
    expect(result.components.schemas.ChildOfUsed).toBeDefined();
    expect(result.components.schemas.IgnoredA).toBeUndefined();
    expect(result.components.schemas.IgnoredB).toBeUndefined();
    expect(result.components.schemas.ChildOfA).toBeUndefined();
    expect(result.components.schemas.ChildOfB).toBeUndefined();
  });

  it("should delete empty non-schema sections but keep components with empty schemas", () => {
    const doc = {
      openapi: "3.0.3",
      paths: {
        "/test": {
          get: {
            responses: {
              "200": { description: "ok" }
            }
          }
        }
      },
      components: {
        parameters: {
          UnusedParam: {
            in: "query",
            name: "test"
          }
        },
        schemas: {
          Unused: { type: "string" }
        }
      }
    };
    const result = removeUnusedSchemas(deepClone(doc), { aggressive: true });
    // The implementation keeps the components.schemas object even if empty
    expect(result.components).toBeDefined();
    expect(result.components.schemas).toEqual({});
    expect(result.components.parameters).toBeUndefined();
  });

  it("should handle refs in arrays (anyOf, oneOf)", () => {
    const doc = builders.doc(
      { "/test": builders.path("get", builders.jsonResponse("Union")) },
      {
        Union: builders.schema.oneOf(["OptionA", "OptionB"]),
        OptionA: builders.schema.simple("string"),
        OptionB: builders.schema.simple("number"),
        Unused: builders.schema.simple("object")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas.Union).toBeDefined();
    expect(result.components.schemas.OptionA).toBeDefined();
    expect(result.components.schemas.OptionB).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
  });

  it("should handle combined options: aggressive, keep, and ignoreParents", () => {
    const doc = {
      openapi: "3.0.3",
      paths: {
        "/test": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Used" }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        parameters: {
          UnusedParam: {
            in: "query",
            name: "test"
          }
        },
        schemas: {
          Used: { type: "object" },
          KeepMe: { type: "string" },
          IgnoredParent: { type: "object" },
          ChildOfIgnored: {
            allOf: [
              { $ref: "#/components/schemas/IgnoredParent" },
              { type: "object" }
            ]
          },
          ChildOfUsed: {
            allOf: [
              { $ref: "#/components/schemas/Used" },
              { type: "object" }
            ]
          },
          Unused: { type: "number" }
        }
      }
    };
    const result = removeUnusedSchemas(deepClone(doc), {
      aggressive: true,
      keep: ["KeepMe"],
      ignoreParents: ["IgnoredParent"]
    });
    expect(result.components.schemas.Used).toBeDefined();
    expect(result.components.schemas.KeepMe).toBeDefined();
    expect(result.components.schemas.ChildOfUsed).toBeDefined();
    expect(result.components.schemas.IgnoredParent).toBeUndefined();
    expect(result.components.schemas.ChildOfIgnored).toBeUndefined();
    expect(result.components.schemas.Unused).toBeUndefined();
    expect(result.components.parameters).toBeUndefined();
  });

  it("should handle deep transitive allOf chains", () => {
    const doc = builders.doc(
      { "/test": builders.path("get", builders.jsonResponse("L0")) },
      {
        L0: builders.schema.simple("object"),
        L1: builders.schema.allOf(["L0"]),
        L2: builders.schema.allOf(["L1"]),
        L3: builders.schema.allOf(["L2"]),
        Unrelated: builders.schema.simple("string")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas.L0).toBeDefined();
    expect(result.components.schemas.L1).toBeDefined();
    expect(result.components.schemas.L2).toBeDefined();
    expect(result.components.schemas.L3).toBeDefined();
    expect(result.components.schemas.Unrelated).toBeUndefined();
  });

  it("should handle allOf promotion with additional transitive refs", () => {
    const doc = builders.doc(
      { "/test": builders.path("get", builders.jsonResponse("Base")) },
      {
        Base: builders.schema.simple("object"),
        Helper: builders.schema.simple("string"),
        Child: builders.schema.allOf(["Base"], 
          builders.schema.withProps({ prop: builders.schema.withRef("Helper") })),
        Unused: builders.schema.simple("number")
      }
    );
    const result = removeUnusedSchemas(deepClone(doc));
    expect(result.components.schemas.Base).toBeDefined();
    expect(result.components.schemas.Child).toBeDefined();
    expect(result.components.schemas.Helper).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
  });

  it("should handle multi-level allOf polymorphic hierarchies", () => {
    const doc = builders.doc(
      { "/animals": builders.path("get", builders.arrayResponse("Animal", "List all animals")) },
      {
        ...polymorphicBuilders.multiLevelAnimalHierarchy(true),
        UnrelatedSchema: builders.schema.withProps({ irrelevant: { type: "string" } })
      }
    );
    
    const result = removeUnusedSchemas(deepClone(doc));
    
    // Level 0: Base referenced in paths should be kept
    expect(result.components.schemas.Animal).toBeDefined();
    
    // Level 1: Direct children of Animal via allOf should be promoted
    expect(result.components.schemas.Mammal).toBeDefined();
    expect(result.components.schemas.Bird).toBeDefined();
    
    // Level 2: Grandchildren via allOf should be promoted transitively
    expect(result.components.schemas.Dog).toBeDefined();
    expect(result.components.schemas.Cat).toBeDefined();
    expect(result.components.schemas.Eagle).toBeDefined();
    expect(result.components.schemas.Penguin).toBeDefined();
    
    // Polymorphic Toy hierarchy: Cat references Toy in array, so Toy and its children should be kept
    expect(result.components.schemas.Toy).toBeDefined();
    expect(result.components.schemas.Ball).toBeDefined();
    expect(result.components.schemas.FeatherToy).toBeDefined();
    
    // Unrelated schema should be removed
    expect(result.components.schemas.UnrelatedSchema).toBeUndefined();
  });

  it("should handle multi-level polymorphic with intermediate refs", () => {
    const doc = builders.doc(
      { "/vehicles": builders.path("get", builders.jsonResponse("Vehicle")) },
      {
        ...polymorphicBuilders.vehicleHierarchy(),
        UnusedThing: builders.schema.simple("string")
      }
    );
    
    const result = removeUnusedSchemas(deepClone(doc));
    
    // Base and its direct ref should be kept
    expect(result.components.schemas.Vehicle).toBeDefined();
    expect(result.components.schemas.Manufacturer).toBeDefined();
    
    // Level 1 polymorphic children
    expect(result.components.schemas.MotorVehicle).toBeDefined();
    expect(result.components.schemas.Bicycle).toBeDefined();
    
    // MotorVehicle's additional ref should be kept
    expect(result.components.schemas.Engine).toBeDefined();
    
    // Level 2 polymorphic children
    expect(result.components.schemas.Car).toBeDefined();
    expect(result.components.schemas.Motorcycle).toBeDefined();
    
    // Unused should be removed
    expect(result.components.schemas.UnusedThing).toBeUndefined();
  });

  it("should promote parents and child hierarchies give parents are referenced", () => {
    // RootSchema references A and X1
    // B and C inherit from A (allOf A)
    // D inherits from C (allOf C)
    // X1, X2, X3 inherit from X (allOf X)
    // So A, B, C, D, X should be promoted
    
    const doc = builders.doc(
      { 
        "/root": builders.path("get", builders.jsonResponse("RootSchema"))
      },
      {
        RootSchema: builders.schema.withProps({
          a: builders.schema.withRef("A"),
          x: builders.schema.withRef("X1")
        }),
        A: builders.schema.withProps({
          propA: { type: "string" }
        }).withDiscriminator("type", {
          B: "#/components/schemas/B",
          C: "#/components/schemas/C",
          D: "#/components/schemas/D"
        }),
        B: builders.schema.allOf(["A"], 
          builders.schema.withProps({ propB: { type: "string" } })),
        C: builders.schema.allOf(["A"], 
          builders.schema.withProps({ propC: { type: "string" } })
          .withDiscriminator("type", { D: "#/components/schemas/D" })),
        D: builders.schema.allOf(["C"], 
          builders.schema.withProps({ propD: { type: "string" } })),
        X: builders.schema.withProps({
          propX: { type: "string" }
        }),
        X1: builders.schema.allOf(["X"], 
          builders.schema.withProps({ propX1: { type: "string" } })),
        X2: builders.schema.allOf(["X"], 
          builders.schema.withProps({ propX2: { type: "string" } })),
        X3: builders.schema.allOf(["X"], 
          builders.schema.withProps({ propX3: { type: "string" } }))
      }
    );

    console.log(JSON.stringify(doc, null, 2));

    const result = removeUnusedSchemas(deepClone(doc));

    // RootSchema is directly used
    expect(result.components.schemas.RootSchema).toBeDefined();
    
    // A is directly referenced by RootSchema
    expect(result.components.schemas.A).toBeDefined();
    
    // B and C inherit from A, so they should be promoted (polymorphism)
    // D inherits from C, so it should be promoted too
    expect(result.components.schemas.B).toBeDefined();
    expect(result.components.schemas.C).toBeDefined();
    expect(result.components.schemas.D).toBeDefined();
    
    // X1 is directly referenced by RootSchema
    expect(result.components.schemas.X1).toBeDefined();
    
    // X is parent of X1, so it should be promoted
    expect(result.components.schemas.X).toBeDefined();
    
    // X is not referenced directly (as property, list property or oneOf member) so their children should not be automatically promoted
    expect(result.components.schemas.X2).not.toBeDefined();
    expect(result.components.schemas.X3).not.toBeDefined();
  });
});
