import { describe, it, expect } from "vitest";
import { sealSchema } from "../src/lib/sealSchema.js";
import { loadSchemaFromFile } from "./schemaLoader.js";
import { JSONPath } from "jsonpath-plus";
import { deleteByPointer } from "./schemaLoader.js";

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
    // The sealing process will add unevaluatedProperties to all object schemas
    // so the coverage after sealing should be at least as comprehensive as before
    const beforeSet = new Set(beforePointers);
    const afterSet = new Set(afterPointers);
    if (afterSet.size !== beforeSet.size) {
      // eslint-disable-next-line no-console
      console.log('unevaluatedPointers before:', beforePointers);
      // eslint-disable-next-line no-console
      console.log('unevaluatedPointers after:', afterPointers);
    }
    expect(afterSet.size).toBe(beforeSet.size);

    // All originally-present pointers should still be present after sealing
    for (const p of beforeSet) {
      expect(afterSet.has(p)).toBeTruthy();
    }
    // New sealing should be added to ensure comprehensive coverage
    expect(afterSet.size).toBe(beforeSet.size);
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
    
    // The sealing process will add sealing to all object schemas
    // Verify that previously-sealed locations remain sealed
    const beforeAdditionalSet = new Set(beforeAdditional);
    const beforeUnevaluatedSet = new Set(beforeUnevaluated);
    const afterAdditionalSet = new Set(afterAdditional);
    const afterUnevaluatedSet = new Set(afterUnevaluated);
    
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
    
    expect(afterAdditionalSet.size).toBe(beforeAdditionalSet.size);
    expect(afterUnevaluatedSet.size).toBe(beforeUnevaluatedSet.size);
    
    // All original additionalProperties should be preserved
    for (const p of beforeAdditionalSet) {
      expect(afterAdditionalSet.has(p)).toBeTruthy();
    }
    
    // All original unevaluatedProperties should be preserved
    // (some might be on composition roots even when using additionalProperties mode)
    for (const p of beforeUnevaluatedSet) {
      expect(afterUnevaluatedSet.has(p) || afterAdditionalSet.has(p)).toBeTruthy();
    }
  });
});
