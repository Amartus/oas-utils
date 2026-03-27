import { describe, it, expect } from "vitest";
import { removeFromOneOfGlobally } from "../src/lib/removeFromOneOfByName";
import { createDoc, discriminatorOneOf, objectSchema, oneOfRefs, ref } from "./testBuilders.js";

describe("removeFromOneOfGlobally", () => {
  it("removes schema from all top-level oneOfs and updates discriminators", () => {
    const doc = createDoc({
      schemas: {
        Pet: discriminatorOneOf("type", { cat: "Cat", dog: "Dog" }),
        Cat: objectSchema(),
        Dog: objectSchema(),
      },
    });
    const changed = removeFromOneOfGlobally(doc, "Cat");
    expect(changed).toBe(1);
    expect(doc.components.schemas.Pet.oneOf).toEqual([
      { $ref: ref("Dog") }
    ]);
    expect(doc.components.schemas.Pet.discriminator.mapping).toEqual({
      dog: ref("Dog")
    });
  });

  it("removes schema from nested oneOfs", () => {
    const doc = createDoc({
      schemas: {
        Pet: objectSchema({
          animal: {
            ...discriminatorOneOf("type", { cat: "Cat", dog: "Dog" }),
          },
        }),
        Cat: objectSchema(),
        Dog: objectSchema(),
      },
    });
    const changed = removeFromOneOfGlobally(doc, "Cat");
    expect(changed).toBe(1);
    expect(doc.components.schemas.Pet.properties.animal.oneOf).toEqual([
      { $ref: ref("Dog") }
    ]);
    expect(doc.components.schemas.Pet.properties.animal.discriminator.mapping).toEqual({
      dog: ref("Dog")
    });
  });

  it("removes schema from multiple oneOfs at different levels", () => {
    const doc = createDoc({
      schemas: {
        Pet: { oneOf: oneOfRefs("Cat", "Dog") },
        Zoo: objectSchema({
          animal: { oneOf: oneOfRefs("Cat", "Dog") },
        }),
        Cat: objectSchema(),
        Dog: objectSchema(),
      },
    });
    const changed = removeFromOneOfGlobally(doc, "Cat");
    expect(changed).toBe(2);
    expect(doc.components.schemas.Pet.oneOf).toEqual([
      { $ref: ref("Dog") }
    ]);
    expect(doc.components.schemas.Zoo.properties.animal.oneOf).toEqual([
      { $ref: ref("Dog") }
    ]);
  });

  it("returns 0 if no oneOf contains the schema", () => {
    const doc = createDoc({
      schemas: {
        Pet: { oneOf: oneOfRefs("Dog") },
        Cat: objectSchema(),
        Dog: objectSchema(),
      },
    });
    const changed = removeFromOneOfGlobally(doc, "Bird");
    expect(changed).toBe(0);
    expect(doc.components.schemas.Pet.oneOf).toEqual([
      { $ref: ref("Dog") }
    ]);
  });
});
