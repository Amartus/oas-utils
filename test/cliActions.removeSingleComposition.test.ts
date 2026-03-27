import { describe, it, expect } from "vitest";
import { runRemoveSingleComposition } from "../src/lib/cliActions.js";
import YAML from "yaml";
import { createDoc, objectSchema, ref } from "./testBuilders.js";

describe("runRemoveSingleComposition with wildcard patterns", () => {
  /** Helper to capture output from runRemoveSingleComposition */
  async function captureOutput(input: any, opts: any): Promise<any> {
    let output = '';
    const capturingFormat = (doc: any) => {
      output = YAML.stringify(doc);
      return output;
    };

    await runRemoveSingleComposition(
      opts,
      capturingFormat,
      async () => YAML.stringify(input)
    );

    return YAML.parse(output);
  }

  type WrapperKind = "allOf" | "oneOf" | "anyOf";
  interface WrapperDef {
    kind?: WrapperKind;
    target?: string;
    description?: string;
  }

  function wrapperSchema(def: WrapperDef = {}): any {
    const kind = def.kind ?? "allOf";
    const target = def.target ?? "Target";
    return {
      ...(def.description ? { description: def.description } : {}),
      [kind]: [{ $ref: ref(target) }],
    };
  }

  function makeInput(defs: Record<string, WrapperDef>): any {
    const schemas: Record<string, any> = { Target: objectSchema() };
    for (const [name, def] of Object.entries(defs)) {
      schemas[name] = wrapperSchema(def);
    }
    return createDoc({ paths: {}, schemas });
  }

  it("should keep schemas matching exact pattern", async () => {
    const input = makeInput({
      LegacyWrapper: {},
      OtherWrapper: {},
    });

    const result = await captureOutput(input, { keep: ["LegacyWrapper"] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.OtherWrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should keep schemas matching prefix pattern Foo*", async () => {
    const input = makeInput({
      FooWrapper: {},
      FooBarWrapper: {},
      BarWrapper: {},
    });

    const result = await captureOutput(input, { keep: ["Foo*"] });

    expect(result.components.schemas.FooWrapper).toBeDefined();
    expect(result.components.schemas.FooBarWrapper).toBeDefined();
    expect(result.components.schemas.BarWrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should keep schemas matching suffix pattern *Wrapper", async () => {
    const input = makeInput({
      LegacyWrapper: {},
      DeprecatedWrapper: {},
      Legacy: {},
    });

    const result = await captureOutput(input, { keep: ["*Wrapper"] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.DeprecatedWrapper).toBeDefined();
    expect(result.components.schemas.Legacy).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should keep schemas matching substring pattern *Legacy*", async () => {
    const input = makeInput({
      MyLegacyWrapper: {},
      LegacyFoo: {},
      Wrapper: {},
    });

    const result = await captureOutput(input, { keep: ["*Legacy*"] });

    expect(result.components.schemas.MyLegacyWrapper).toBeDefined();
    expect(result.components.schemas.LegacyFoo).toBeDefined();
    expect(result.components.schemas.Wrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should exclude schemas matching negative pattern !*Test", async () => {
    const input = makeInput({
      UserWrapper: {},
      ProductTest: {},
      MyTest: {},
    });

    const result = await captureOutput(input, { keep: ["!*Test"] });

    // With only negative patterns, keep everything NOT matching
    expect(result.components.schemas.UserWrapper).toBeDefined(); // kept
    expect(result.components.schemas.ProductTest).toBeUndefined(); // removed (matches !*Test)
    expect(result.components.schemas.MyTest).toBeUndefined(); // removed (matches !*Test)
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should combine positive and negative patterns correctly", async () => {
    const input = makeInput({
      LegacyUser: {},
      LegacyTest: {},
      DeprecatedProduct: {},
      UserWrapper: {},
    });

    const result = await captureOutput(input, { keep: ["Legacy*", "Deprecated*", "!*Test"] });

    expect(result.components.schemas.LegacyUser).toBeDefined(); // matches Legacy*, not *Test
    expect(result.components.schemas.LegacyTest).toBeUndefined(); // matches Legacy* but also *Test (excluded)
    expect(result.components.schemas.DeprecatedProduct).toBeDefined(); // matches Deprecated*, not *Test
    expect(result.components.schemas.UserWrapper).toBeUndefined(); // doesn't match positive patterns
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle wildcard * to keep everything", async () => {
    const input = makeInput({
      Wrapper1: {},
      Wrapper2: {},
    });

    const result = await captureOutput(input, { keep: ["*"] });

    expect(result.components.schemas.Wrapper1).toBeDefined();
    expect(result.components.schemas.Wrapper2).toBeDefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle multiple positive patterns", async () => {
    const input = makeInput({
      LegacyWrapper: {},
      DeprecatedWrapper: {},
      OtherWrapper: {},
    });

    const result = await captureOutput(input, { keep: ["LegacyWrapper", "Deprecated*"] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.DeprecatedWrapper).toBeDefined();
    expect(result.components.schemas.OtherWrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle aggressive mode with keep patterns", async () => {
    const input = makeInput({
      LegacyWrapper: { description: "Legacy wrapper with description" },
      OtherWrapper: { description: "Other wrapper with description" },
    });

    const result = await captureOutput(input, { aggressive: true, keep: ["Legacy*"] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.OtherWrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle empty keep array (no patterns)", async () => {
    const input = makeInput({
      Wrapper1: { kind: "allOf" },
      Wrapper2: { kind: "oneOf" },
    });

    const result = await captureOutput(input, { keep: [] });

    // With no patterns, all wrappers should be removed
    expect(result.components.schemas.Wrapper1).toBeUndefined();
    expect(result.components.schemas.Wrapper2).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle patterns with spaces (should be trimmed)", async () => {
    const input = makeInput({
      LegacyWrapper: {},
      OtherWrapper: {},
    });

    const result = await captureOutput(input, { keep: [" Legacy* ", " !Other* "] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.OtherWrapper).toBeUndefined(); //  excluded by negative
    expect(result.components.schemas.Target).toBeDefined();
  });
});
