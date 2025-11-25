import { describe, it, expect } from "vitest";
import {
  getOpenApiVersion,
  getJsonSchemaVersion,
  supportsUnevaluatedProperties,
  oasSupportsUnevaluatedProperties,
  documentSupportsUnevaluatedProperties,
  upgradeToOas31,
  upgradeJsonSchemaToDraft201909,
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
    it.each([
      { label: "2019-09", schemaVersion: "https://json-schema.org/draft/2019-09/schema", expected: true },
      { label: "2020-12", schemaVersion: "https://json-schema.org/draft/2020-12/schema", expected: true },
      { label: "draft-07", schemaVersion: "http://json-schema.org/draft-07/schema#", expected: false },
      { label: "draft-06", schemaVersion: "http://json-schema.org/draft-06/schema#", expected: false },
      { label: "draft-04", schemaVersion: "http://json-schema.org/draft-04/schema#", expected: false },
      { label: "empty string", schemaVersion: "", expected: false },
    ])("returns $expected for JSON Schema $label", ({ label, schemaVersion, expected }) => {
      expect(supportsUnevaluatedProperties(schemaVersion)).toBe(expected);
    });
  });

  describe("oasSupportsUnevaluatedProperties (OpenAPI)", () => {
    it.each([
      { version: "3.1.0", expected: true },
      { version: "3.1.1", expected: true },
      { version: "3.2.0", expected: true },
      { version: "3.0.0", expected: false },
      { version: "3.0.3", expected: false },
      { version: "", expected: false },
    ])("returns $expected for OpenAPI '$version'", ({ version, expected }) => {
      expect(oasSupportsUnevaluatedProperties(version)).toBe(expected);
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

  describe("upgradeJsonSchemaToDraft201909", () => {
    it("sets $schema to draft 2019-09", () => {
      const doc = { type: "object", properties: {} };
      upgradeJsonSchemaToDraft201909(doc);
      expect(doc.$schema).toBe("https://json-schema.org/draft/2019-09/schema");
    });

    it("upgrades from draft-07 to draft 2019-09", () => {
      const doc = { $schema: "http://json-schema.org/draft-07/schema#", type: "object" };
      upgradeJsonSchemaToDraft201909(doc);
      expect(doc.$schema).toBe("https://json-schema.org/draft/2019-09/schema");
    });

    it("preserves 2020-12 version", () => {
      const doc = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "Test",
        type: "object",
        properties: { name: { type: "string" } },
      };
      upgradeJsonSchemaToDraft201909(doc);
      expect(doc.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(doc.title).toBe("Test");
      expect(doc.type).toBe("object");
      expect(doc.properties).toEqual({ name: { type: "string" } });
    });

    it("preserves 2019-09 version", () => {
      const doc = {
        $schema: "https://json-schema.org/draft/2019-09/schema",
        title: "Test",
        type: "object",
      };
      upgradeJsonSchemaToDraft201909(doc);
      expect(doc.$schema).toBe("https://json-schema.org/draft/2019-09/schema");
    });

    it("preserves other properties when upgrading", () => {
      const doc = {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "Test",
        type: "object",
        properties: { name: { type: "string" } },
      };
      upgradeJsonSchemaToDraft201909(doc);
      expect(doc.$schema).toBe("https://json-schema.org/draft/2019-09/schema");
      expect(doc.title).toBe("Test");
      expect(doc.type).toBe("object");
      expect(doc.properties).toEqual({ name: { type: "string" } });
    });
  });
});
