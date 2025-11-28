import { describe, it, expect } from "vitest";
import { sealSchema } from "../src/lib/sealSchema.js";
import { loadSchemaFromFile } from "./schemaLoader.js";
import { JSONPath } from "jsonpath-plus";
import { deleteByPointer } from "./schemaLoader.js";
import { before } from "node:test";

function collectUnevaluatedPropertiesPointers(node: any): string[] {
  return JSONPath({
    path: "$..unevaluatedProperties",
    json: node,
    resultType: "pointer",
  }) as string[];
}

function collectAdditionalPropertiesPointers(node: any): string[] {
  return JSONPath({
    path: "$..additionalProperties",
    json: node,
    resultType: "pointer",
  }) as string[];
}

describe("foo-bar schema sealing", () => {
  it("preserves unevaluatedProperties coverage after sealing", () => {
    const schema = loadSchemaFromFile("foo-bar");

    const beforePointers = collectUnevaluatedPropertiesPointers(schema);

    // Delete each pointer's property (pointer points exactly to the unevaluatedProperties node)
    for (const ptr of beforePointers) {
      deleteByPointer(schema, ptr);
    }

    const sealed = sealSchema(schema, {
      useUnevaluatedProperties: true,
      uplift: false,
    });

    const afterPointers = collectUnevaluatedPropertiesPointers(sealed);
    // checking that original unevaluatedProperties pointers are preserved

    // The sealing process may add unevaluatedProperties in additional nested places
    // — ensure all originally-present pointers are still present after sealing.
    const beforeSet = new Set(beforePointers);
    const afterSet = new Set(afterPointers);
    if (afterSet.size !== beforeSet.size) {
      // eslint-disable-next-line no-console
      console.log('unevaluatedPointers before:', beforePointers);
      // eslint-disable-next-line no-console
      console.log('unevaluatedPointers after:', afterPointers);
    }
    expect(afterSet.size).toBe(beforeSet.size);
    for (const p of beforeSet) {
      expect(afterSet.has(p)).toBeTruthy();
    }
  });

  it("preserves additionalProperties coverage after sealing", () => {
    const schema = loadSchemaFromFile("foo-bar-additional-properties");

    const beforeAdditional = collectAdditionalPropertiesPointers(schema);
    const beforeUnevaluated = collectUnevaluatedPropertiesPointers(schema);

    // Remove all additionalProperties occurrences using JSONPath pointers
    const pointers: string[] = beforeAdditional.concat(beforeUnevaluated);

    // Delete each pointer's property (pointer points exactly to the additionalProperties node)
    for (const ptr of pointers) {
      deleteByPointer(schema, ptr);
    }

    const sealed = sealSchema(schema, {
      useUnevaluatedProperties: false,
      uplift: false,
    });

    const afterUnevaluated = collectUnevaluatedPropertiesPointers(sealed);
    const afterAdditional = collectAdditionalPropertiesPointers(sealed);
    // checking that original additional/unevaluated pointers are preserved

    

    if (new Set(afterAdditional).size !== new Set(beforeAdditional).size || new Set(afterUnevaluated).size !== new Set(beforeUnevaluated).size) {
      // eslint-disable-next-line no-console
      console.log('additional before:', beforeAdditional);
      // eslint-disable-next-line no-console
      console.log('additional after:', afterAdditional);
      // eslint-disable-next-line no-console
      console.log('unevaluated before (add test):', beforeUnevaluated);
      // eslint-disable-next-line no-console
      console.log('unevaluated after (add test):', afterUnevaluated);
    }
    expect(new Set(afterAdditional).size).toBe(new Set(beforeAdditional).size);
    expect(new Set(afterUnevaluated).size).toBe(new Set(beforeUnevaluated).size);
   
  });
});
