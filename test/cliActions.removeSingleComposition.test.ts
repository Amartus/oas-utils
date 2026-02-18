import { describe, it, expect } from "vitest";
import { runRemoveSingleComposition } from "../src/lib/cliActions.js";
import YAML from "yaml";

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

  it("should keep schemas matching exact pattern", async () => {
    const input = {
      components: {
        schemas: {
          LegacyWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          OtherWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: ["LegacyWrapper"] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.OtherWrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should keep schemas matching prefix pattern Foo*", async () => {
    const input = {
      components: {
        schemas: {
          FooWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          FooBarWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          BarWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: ["Foo*"] });

    expect(result.components.schemas.FooWrapper).toBeDefined();
    expect(result.components.schemas.FooBarWrapper).toBeDefined();
    expect(result.components.schemas.BarWrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should keep schemas matching suffix pattern *Wrapper", async () => {
    const input = {
      components: {
        schemas: {
          LegacyWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          DeprecatedWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Legacy: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: ["*Wrapper"] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.DeprecatedWrapper).toBeDefined();
    expect(result.components.schemas.Legacy).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should keep schemas matching substring pattern *Legacy*", async () => {
    const input = {
      components: {
        schemas: {
          MyLegacyWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          LegacyFoo: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Wrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: ["*Legacy*"] });

    expect(result.components.schemas.MyLegacyWrapper).toBeDefined();
    expect(result.components.schemas.LegacyFoo).toBeDefined();
    expect(result.components.schemas.Wrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should exclude schemas matching negative pattern !*Test", async () => {
    const input = {
      components: {
        schemas: {
          UserWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          ProductTest: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          MyTest: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: ["!*Test"] });

    // With only negative patterns, keep everything NOT matching
    expect(result.components.schemas.UserWrapper).toBeDefined(); // kept
    expect(result.components.schemas.ProductTest).toBeUndefined(); // removed (matches !*Test)
    expect(result.components.schemas.MyTest).toBeUndefined(); // removed (matches !*Test)
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should combine positive and negative patterns correctly", async () => {
    const input = {
      components: {
        schemas: {
          LegacyUser: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          LegacyTest: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          DeprecatedProduct: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          UserWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: ["Legacy*", "Deprecated*", "!*Test"] });

    expect(result.components.schemas.LegacyUser).toBeDefined(); // matches Legacy*, not *Test
    expect(result.components.schemas.LegacyTest).toBeUndefined(); // matches Legacy* but also *Test (excluded)
    expect(result.components.schemas.DeprecatedProduct).toBeDefined(); // matches Deprecated*, not *Test
    expect(result.components.schemas.UserWrapper).toBeUndefined(); // doesn't match positive patterns
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle wildcard * to keep everything", async () => {
    const input = {
      components: {
        schemas: {
          Wrapper1: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Wrapper2: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: ["*"] });

    expect(result.components.schemas.Wrapper1).toBeDefined();
    expect(result.components.schemas.Wrapper2).toBeDefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle multiple positive patterns", async () => {
    const input = {
      components: {
        schemas: {
          LegacyWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          DeprecatedWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          OtherWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: ["LegacyWrapper", "Deprecated*"] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.DeprecatedWrapper).toBeDefined();
    expect(result.components.schemas.OtherWrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle aggressive mode with keep patterns", async () => {
    const input = {
      components: {
        schemas: {
          LegacyWrapper: {
            description: "Legacy wrapper with description",
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          OtherWrapper: {
            description: "Other wrapper with description",
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { aggressive: true, keep: ["Legacy*"] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.OtherWrapper).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle empty keep array (no patterns)", async () => {
    const input = {
      components: {
        schemas: {
          Wrapper1: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Wrapper2: {
            oneOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: [] });

    // With no patterns, all wrappers should be removed
    expect(result.components.schemas.Wrapper1).toBeUndefined();
    expect(result.components.schemas.Wrapper2).toBeUndefined();
    expect(result.components.schemas.Target).toBeDefined();
  });

  it("should handle patterns with spaces (should be trimmed)", async () => {
    const input = {
      components: {
        schemas: {
          LegacyWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          OtherWrapper: {
            allOf: [{ $ref: "#/components/schemas/Target" }],
          },
          Target: { type: "object" },
        },
      },
      paths: {},
    };

    const result = await captureOutput(input, { keep: [" Legacy* ", " !Other* "] });

    expect(result.components.schemas.LegacyWrapper).toBeDefined();
    expect(result.components.schemas.OtherWrapper).toBeUndefined(); //  excluded by negative
    expect(result.components.schemas.Target).toBeDefined();
  });
});
