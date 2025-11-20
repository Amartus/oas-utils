import { describe, it, expect } from "vitest";
import { removeFromOneOfByName } from "../src/lib/removeFromOneOfByName";
import { testSchemas } from "./schemaLoader.js";

describe("removeFromOneOfByName", () => {
  it("removes schema from oneOf and updates discriminator", () => {
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
    const changed = removeFromOneOfByName(doc, "Pet", "Cat");
    expect(changed).toBe(true);
    expect(doc.components.schemas.Pet.oneOf).toEqual([
      { $ref: "#/components/schemas/Dog" }
    ]);
    expect(doc.components.schemas.Pet.discriminator.mapping).toEqual({
      dog: "#/components/schemas/Dog"
    });
  });

  it("returns false if schema not found in oneOf", () => {
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
    const changed = removeFromOneOfByName(doc, "Pet", "Bird");
    expect(changed).toBe(false);
    expect(doc.components.schemas.Pet.oneOf.length).toBe(2);
    expect(Object.keys(doc.components.schemas.Pet.discriminator.mapping)).toEqual([
      "cat", "dog"
    ]);
  });
});
