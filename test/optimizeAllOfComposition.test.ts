import { describe, it, expect } from "vitest";
import { optimizeAllOfComposition } from "../src/lib/optimizeAllOfComposition.js";
import { testSchemas } from "./schemaLoader.js";

describe("optimizeAllOfComposition", () => {
  it("removes redundant allOf references (C: [B,A], B: [A] -> C: [B])", () => {
    const doc = {
      components: {
        schemas: {
          A: {},
          B: { allOf: [{ $ref: "#/components/schemas/A" }] },
          C: {
            allOf: [
              { $ref: "#/components/schemas/B" },
              { $ref: "#/components/schemas/A" },
            ],
          },
          D: {
            allOf: [
              { $ref: "#/components/schemas/C" },
              { $ref: "#/components/schemas/A" },
              { type: "object", properties: { d: { type: "boolean" } } },
            ],
          },
        },
      },
    };

    optimizeAllOfComposition(doc);
    expect(doc.components.schemas.C.allOf).toEqual([
      { $ref: "#/components/schemas/B" },
    ]);
    expect(doc.components.schemas.D.allOf).toEqual([
      { $ref: "#/components/schemas/C" },
      { type: "object", properties: { d: { type: "boolean" } } },
    ]);
  });

  it("keeps inline constraints in allOf untouched", () => {
    const doc = {
      components: {
        schemas: {
          A: { type: "object", properties: { a: { type: "string" } } },
          B: { allOf: [{ $ref: "#/components/schemas/A" }] },
          C: {
            allOf: [
              { $ref: "#/components/schemas/B" },
              { $ref: "#/components/schemas/A" },
              { type: "object", properties: { c: { type: "number" } } },
            ],
          },
        },
      },
    };

    optimizeAllOfComposition(doc);
    expect(doc.components.schemas.C.allOf).toEqual([
      { $ref: "#/components/schemas/B" },
      { type: "object", properties: { c: { type: "number" } } },
    ]);
  });
});
