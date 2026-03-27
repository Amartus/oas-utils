import { describe, it, expect } from "vitest";
import { removeFromOneOfByName } from "../src/lib/removeFromOneOfByName";
import { createDoc, discriminatorOneOf, objectSchema, ref } from "./testBuilders.js";

describe("removeFromOneOfByName", () => {
  it("removes schema from oneOf and updates discriminator", () => {
    const doc = createDoc({
      schemas: {
        Pet: discriminatorOneOf("type", { cat: "Cat", dog: "Dog" }),
        Cat: objectSchema(),
        Dog: objectSchema(),
      },
    });
    const changed = removeFromOneOfByName(doc, "Pet", "Cat");
    expect(changed).toBe(true);
    expect(doc.components.schemas.Pet.oneOf).toEqual([
      { $ref: ref("Dog") }
    ]);
    expect(doc.components.schemas.Pet.discriminator.mapping).toEqual({
      dog: ref("Dog")
    });
  });

  it("returns false if schema not found in oneOf", () => {
    const doc = createDoc({
      schemas: {
        Pet: discriminatorOneOf("type", { cat: "Cat", dog: "Dog" }),
        Cat: objectSchema(),
        Dog: objectSchema(),
      },
    });
    const changed = removeFromOneOfByName(doc, "Pet", "Bird");
    expect(changed).toBe(false);
    expect(doc.components.schemas.Pet.oneOf.length).toBe(2);
    expect(Object.keys(doc.components.schemas.Pet.discriminator.mapping)).toEqual([
      "cat", "dog"
    ]);
  });
});
