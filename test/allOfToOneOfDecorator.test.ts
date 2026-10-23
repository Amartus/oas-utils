import { describe, it, expect } from "vitest";
import AllOfToOneOfDecorator from "../src/redocly/allof-to-oneof-decorator.js";
import { createDoc, ref } from "./testBuilders.js";

const animalsDoc = () => createDoc({
  paths: {
    "/animals": {
      get: { responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: ref("Animal") } } } } } },
    },
  },
  schemas: {
    Animal: {
      type: "object",
      properties: { type: { type: "string" } },
      discriminator: { propertyName: "type", mapping: { Cat: ref("Cat"), Dog: ref("Dog") } },
    },
    Cat: { allOf: [{ $ref: ref("Animal") }, { type: "object", properties: { lives: { type: "integer" } } }] },
    Dog: { allOf: [{ $ref: ref("Animal") }, { type: "object", properties: { bark: { type: "number" } } }] },
  },
});

describe("allof-to-oneof decorator", () => {
  it("passes the documented discriminator const options to allOfToOneOf", () => {
    const doc = animalsDoc();
    AllOfToOneOfDecorator({ discriminatorConstPlacement: "children" }).Root.leave(doc);

    expect(doc.components.schemas.AnimalPolymorphic.oneOf).toEqual([{ $ref: ref("Cat") }, { $ref: ref("Dog") }]);
    expect(doc.components.schemas.Cat.allOf).toContainEqual({ type: "object", properties: { type: { enum: ["Cat"] } } });
  });

  it("uses the library defaults when no options are given", () => {
    const doc = animalsDoc();
    AllOfToOneOfDecorator({}).Root.leave(doc);

    expect(doc.components.schemas.AnimalPolymorphic.oneOf).toEqual([
      { allOf: [{ $ref: ref("Cat") }, { type: "object", properties: { type: { enum: ["Cat"] } } }] },
      { allOf: [{ $ref: ref("Dog") }, { type: "object", properties: { type: { enum: ["Dog"] } } }] },
    ]);
  });
});
