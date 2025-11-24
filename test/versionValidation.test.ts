import { describe, it, expect } from "vitest";
import {
  getOpenApiVersion,
  getJsonSchemaVersion,
  supportsUnevaluatedProperties,
  oasSupportsUnevaluatedProperties,
  documentSupportsUnevaluatedProperties,
  upgradeToOas31,
  upgradeJsonSchemaToDraft202012,
} from "../src/lib/oasUtils.js";

describe("Version Detection", () => {
  describe("getOpenApiVersion", () => {
    it("extracts OpenAPI 3.0.0 version", () => {
      const doc = { openapi: "3.0.0" };
      expect(getOpenApiVersion(doc)).toBe("3.0.0");
    });

    it("extracts OpenAPI 3.1.0 version", () => {
      const doc = { openapi: "3.1.0" };
      expect(getOpenApiVersion(doc)).toBe("3.1.0");
    });

    it("extracts Swagger 2.0 version", () => {
      const doc = { swagger: "2.0" };
      expect(getOpenApiVersion(doc)).toBe("2.0");
    });

    it("returns undefined for non-OpenAPI document", () => {
      const doc = { type: "object" };
      expect(getOpenApiVersion(doc)).toBeUndefined();
    });
  });

  describe("getJsonSchemaVersion", () => {
    it("extracts JSON Schema draft-07", () => {
      const doc = { $schema: "http://json-schema.org/draft-07/schema#" };
      expect(getJsonSchemaVersion(doc)).toBe("http://json-schema.org/draft-07/schema#");
    });

    it("extracts JSON Schema 2020-12", () => {
      const doc = { $schema: "https://json-schema.org/draft/2020-12/schema" };
      expect(getJsonSchemaVersion(doc)).toBe("https://json-schema.org/draft/2020-12/schema");
    });

    it("returns undefined for document without $schema", () => {
      const doc = { type: "object" };
      expect(getJsonSchemaVersion(doc)).toBeUndefined();
    });
  });
});

describe("unevaluatedProperties Support Detection", () => {
  describe("supportsUnevaluatedProperties (JSON Schema)", () => {
    it("returns true for JSON Schema 2019-09", () => {
      expect(supportsUnevaluatedProperties("https://json-schema.org/draft/2019-09/schema")).toBe(true);
    });

    it("returns true for JSON Schema 2020-12", () => {
      expect(supportsUnevaluatedProperties("https://json-schema.org/draft/2020-12/schema")).toBe(true);
    });

    it("returns false for JSON Schema draft-07", () => {
      expect(supportsUnevaluatedProperties("http://json-schema.org/draft-07/schema#")).toBe(false);
    });

    it("returns false for JSON Schema draft-06", () => {
      expect(supportsUnevaluatedProperties("http://json-schema.org/draft-06/schema#")).toBe(false);
    });

    it("returns false for JSON Schema draft-04", () => {
      expect(supportsUnevaluatedProperties("http://json-schema.org/draft-04/schema#")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(supportsUnevaluatedProperties("")).toBe(false);
    });
  });

  describe("oasSupportsUnevaluatedProperties (OpenAPI)", () => {
    it("returns true for OpenAPI 3.1.0", () => {
      expect(oasSupportsUnevaluatedProperties("3.1.0")).toBe(true);
    });

    it("returns true for OpenAPI 3.1.1", () => {
      expect(oasSupportsUnevaluatedProperties("3.1.1")).toBe(true);
    });

    it("returns true for OpenAPI 3.2.0 (future version)", () => {
      expect(oasSupportsUnevaluatedProperties("3.2.0")).toBe(true);
    });

    it("returns false for OpenAPI 3.0.0", () => {
      expect(oasSupportsUnevaluatedProperties("3.0.0")).toBe(false);
    });

    it("returns false for OpenAPI 3.0.3", () => {
      expect(oasSupportsUnevaluatedProperties("3.0.3")).toBe(false);
    });

    it("returns false for Swagger 2.0", () => {
      expect(oasSupportsUnevaluatedProperties("2.0")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(oasSupportsUnevaluatedProperties("")).toBe(false);
    });
  });

  describe("documentSupportsUnevaluatedProperties", () => {
    it("returns true for OpenAPI 3.1.0 document", () => {
      const doc = { openapi: "3.1.0", info: {}, paths: {} };
      expect(documentSupportsUnevaluatedProperties(doc)).toBe(true);
    });

    it("returns false for OpenAPI 3.0.0 document", () => {
      const doc = { openapi: "3.0.0", info: {}, paths: {} };
      expect(documentSupportsUnevaluatedProperties(doc)).toBe(false);
    });

    it("returns true for JSON Schema 2020-12 document", () => {
      const doc = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" };
      expect(documentSupportsUnevaluatedProperties(doc)).toBe(true);
    });

    it("returns false for JSON Schema draft-07 document", () => {
      const doc = { $schema: "http://json-schema.org/draft-07/schema#", type: "object" };
      expect(documentSupportsUnevaluatedProperties(doc)).toBe(false);
    });

    it("returns false for document without version", () => {
      const doc = { type: "object", properties: {} };
      expect(documentSupportsUnevaluatedProperties(doc)).toBe(false);
    });
  });
});

describe("Version Upgrade Functions", () => {
  describe("upgradeToOas31", () => {
    it("upgrades OpenAPI 3.0.0 to 3.1.0", () => {
      const doc = { openapi: "3.0.0", info: {}, paths: {} };
      upgradeToOas31(doc);
      expect(doc.openapi).toBe("3.1.0");
    });

    it("upgrades OpenAPI 3.0.3 to 3.1.0", () => {
      const doc = { openapi: "3.0.3", info: {}, paths: {} };
      upgradeToOas31(doc);
      expect(doc.openapi).toBe("3.1.0");
    });

    it("does not modify OpenAPI 3.1.0", () => {
      const doc = { openapi: "3.1.0", info: {}, paths: {} };
      upgradeToOas31(doc);
      expect(doc.openapi).toBe("3.1.0");
    });

    it("does not modify non-OpenAPI document", () => {
      const doc = { type: "object" };
      upgradeToOas31(doc);
      expect(doc.openapi).toBeUndefined();
    });
  });

  describe("upgradeJsonSchemaToDraft202012", () => {
    it("sets $schema to draft 2020-12", () => {
      const doc = { type: "object", properties: {} };
      upgradeJsonSchemaToDraft202012(doc);
      expect(doc.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    });

    it("upgrades from draft-07 to draft 2020-12", () => {
      const doc = { $schema: "http://json-schema.org/draft-07/schema#", type: "object" };
      upgradeJsonSchemaToDraft202012(doc);
      expect(doc.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    });

    it("preserves other properties", () => {
      const doc = {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "Test",
        type: "object",
        properties: { name: { type: "string" } },
      };
      upgradeJsonSchemaToDraft202012(doc);
      expect(doc.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(doc.title).toBe("Test");
      expect(doc.type).toBe("object");
      expect(doc.properties).toEqual({ name: { type: "string" } });
    });
  });
});
