import { describe, it, expect } from "vitest";
import { removeFromOneOfGlobally } from "../src/lib/removeFromOneOfByName";
import { testSchemas } from "./schemaLoader.js";

describe("removeFromOneOfGlobally", () => {
  it("removes schema from all top-level oneOfs and updates discriminators", () => {
    const doc = {
      components: {
        schemas: {
          Pet: {
            oneOf: [
              { $ref: "#/components/schemas/Cat" },
              { $ref: "#/components/schemas/Dog" }
            ],
            discriminator: {
              propertyName: "type",
              mapping: {
                cat: "#/components/schemas/Cat",
                dog: "#/components/schemas/Dog"
              }
            }
          },
          Cat: {},
          Dog: {}
        }
      }
    };
    const changed = removeFromOneOfGlobally(doc, "Cat");
    expect(changed).toBe(1);
    expect(doc.components.schemas.Pet.oneOf).toEqual([
      { $ref: "#/components/schemas/Dog" }
    ]);
    expect(doc.components.schemas.Pet.discriminator.mapping).toEqual({
      dog: "#/components/schemas/Dog"
    });
  });

  it("removes schema from nested oneOfs", () => {
    const doc = {
      components: {
        schemas: {
          Pet: {
            properties: {
              animal: {
                oneOf: [
                  { $ref: "#/components/schemas/Cat" },
                  { $ref: "#/components/schemas/Dog" }
                ],
                discriminator: {
                  propertyName: "type",
                  mapping: {
                    cat: "#/components/schemas/Cat",
                    dog: "#/components/schemas/Dog"
                  }
                }
              }
            }
          },
          Cat: {},
          Dog: {}
        }
      }
    };
    const changed = removeFromOneOfGlobally(doc, "Cat");
    expect(changed).toBe(1);
    expect(doc.components.schemas.Pet.properties.animal.oneOf).toEqual([
      { $ref: "#/components/schemas/Dog" }
    ]);
    expect(doc.components.schemas.Pet.properties.animal.discriminator.mapping).toEqual({
      dog: "#/components/schemas/Dog"
    });
  });

  it("removes schema from multiple oneOfs at different levels", () => {
    const doc = {
      components: {
        schemas: {
          Pet: {
            oneOf: [
              { $ref: "#/components/schemas/Cat" },
              { $ref: "#/components/schemas/Dog" }
            ]
          },
          Zoo: {
            properties: {
              animal: {
                oneOf: [
                  { $ref: "#/components/schemas/Cat" },
                  { $ref: "#/components/schemas/Dog" }
                ]
              }
            }
          },
          Cat: {},
          Dog: {}
        }
      }
    };
    const changed = removeFromOneOfGlobally(doc, "Cat");
    expect(changed).toBe(2);
    expect(doc.components.schemas.Pet.oneOf).toEqual([
      { $ref: "#/components/schemas/Dog" }
    ]);
    expect(doc.components.schemas.Zoo.properties.animal.oneOf).toEqual([
      { $ref: "#/components/schemas/Dog" }
    ]);
  });

  it("returns 0 if no oneOf contains the schema", () => {
    const doc = {
      components: {
        schemas: {
          Pet: {
            oneOf: [
              { $ref: "#/components/schemas/Dog" }
            ]
          },
          Cat: {},
          Dog: {}
        }
      }
    };
    const changed = removeFromOneOfGlobally(doc, "Bird");
    expect(changed).toBe(0);
    expect(doc.components.schemas.Pet.oneOf).toEqual([
      { $ref: "#/components/schemas/Dog" }
    ]);
  });
});
