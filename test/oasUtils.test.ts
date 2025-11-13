import { describe, it, expect } from "vitest";
import { buildInheritanceGraph, getDescendants, getAncestors } from "../src/lib/oasUtils.js";

describe("oasUtils", () => {
  describe("buildInheritanceGraph", () => {
    it("builds graph from simple inheritance", () => {
      const schemas = {
        Animal: {
          type: "object",
          properties: { type: { type: "string" } },
          discriminator: { propertyName: "type", mapping: { Cat: "#/components/schemas/Cat", Dog: "#/components/schemas/Dog" } },
        },
        Cat: {
          allOf: [
            { $ref: "#/components/schemas/Animal" },
            { type: "object", properties: { meow: { type: "boolean" } } },
          ],
        },
        Dog: {
          allOf: [
            { $ref: "#/components/schemas/Animal" },
            { type: "object", properties: { bark: { type: "boolean" } } },
          ],
        },
      };

      const graph = buildInheritanceGraph(schemas);

      expect(graph.get("Animal")).toBeDefined();
      expect(graph.get("Animal")!.size).toBe(2);
      expect(graph.get("Animal")!.has("Cat")).toBe(true);
      expect(graph.get("Animal")!.has("Dog")).toBe(true);
    });

    it("builds graph from multi-level inheritance", () => {
      const schemas = {
        Animal: {
          allOf: [{ type: "object", properties: { id: { type: "string" } } }],
        },
        Pet: {
          allOf: [
            { $ref: "#/components/schemas/Animal" },
            { type: "object", properties: { owner: { type: "string" } } },
          ],
        },
        Dog: {
          allOf: [
            { $ref: "#/components/schemas/Pet" },
            { type: "object", properties: { breed: { type: "string" } } },
          ],
        },
      };

      const graph = buildInheritanceGraph(schemas);

      expect(graph.get("Animal")).toBeDefined();
      expect(graph.get("Animal")!.has("Pet")).toBe(true);
      expect(graph.get("Pet")).toBeDefined();
      expect(graph.get("Pet")!.has("Dog")).toBe(true);
    });

    it("builds graph with multiple compositions", () => {
      const schemas = {
        Food: {
          type: "object",
          properties: { name: { type: "string" } },
        },
        Animal: {
          allOf: [{ $ref: "#/components/schemas/Food" }],
          properties: { id: { type: "string" } },
        },
        Dog: {
          allOf: [
            { $ref: "#/components/schemas/Animal" },
            { $ref: "#/components/schemas/Food" },
            { type: "object", properties: { breed: { type: "string" } } },
          ],
        },
      };

      const graph = buildInheritanceGraph(schemas);

      expect(graph.get("Food")!.size).toBe(2); // Animal and Dog
      expect(graph.get("Food")!.has("Animal")).toBe(true);
      expect(graph.get("Food")!.has("Dog")).toBe(true);
      expect(graph.get("Animal")!.has("Dog")).toBe(true);
    });

    it("returns empty graph for empty schemas", () => {
      const graph = buildInheritanceGraph({});
      expect(graph.size).toBe(0);
    });

    it("ignores schemas without allOf", () => {
      const schemas = {
        SimpleSchema: {
          type: "object",
          properties: { id: { type: "string" } },
        },
      };

      const graph = buildInheritanceGraph(schemas);
      expect(graph.size).toBe(0);
    });
  });

  describe("getDescendants", () => {
    it("gets direct descendants", () => {
      const schemas = {
        Animal: {
          discriminator: { propertyName: "type", mapping: {} },
        },
        Cat: {
          allOf: [{ $ref: "#/components/schemas/Animal" }],
        },
        Dog: {
          allOf: [{ $ref: "#/components/schemas/Animal" }],
        },
      };

      const graph = buildInheritanceGraph(schemas);
      const descendants = getDescendants("Animal", graph);

      expect(descendants.size).toBe(2);
      expect(descendants.has("Cat")).toBe(true);
      expect(descendants.has("Dog")).toBe(true);
    });

    it("gets transitive descendants", () => {
      const schemas = {
        Animal: {
          type: "object",
        },
        Pet: {
          allOf: [{ $ref: "#/components/schemas/Animal" }],
        },
        Dog: {
          allOf: [{ $ref: "#/components/schemas/Pet" }],
        },
        Puppy: {
          allOf: [{ $ref: "#/components/schemas/Dog" }],
        },
      };

      const graph = buildInheritanceGraph(schemas);
      const descendants = getDescendants("Animal", graph);

      expect(descendants.size).toBe(3);
      expect(descendants.has("Pet")).toBe(true);
      expect(descendants.has("Dog")).toBe(true);
      expect(descendants.has("Puppy")).toBe(true);
    });

    it("returns empty set for schema with no descendants", () => {
      const graph = new Map<string, Set<string>>();
      const descendants = getDescendants("NonExistent", graph);

      expect(descendants.size).toBe(0);
    });
  });

  describe("getAncestors", () => {
    it("gets direct ancestors", () => {
      const schemas = {
        Animal: {
          type: "object",
          properties: { type: { type: "string" } },
        },
        Dog: {
          allOf: [
            { $ref: "#/components/schemas/Animal" },
            { type: "object", properties: { breed: { type: "string" } } },
          ],
        },
      };

      const ancestors = getAncestors("Dog", schemas);

      expect(ancestors.size).toBe(1);
      expect(ancestors.has("Animal")).toBe(true);
    });

    it("gets transitive ancestors", () => {
      const schemas = {
        Animal: {
          type: "object",
        },
        Pet: {
          allOf: [{ $ref: "#/components/schemas/Animal" }],
        },
        Dog: {
          allOf: [{ $ref: "#/components/schemas/Pet" }],
        },
        Puppy: {
          allOf: [{ $ref: "#/components/schemas/Dog" }],
        },
      };

      const ancestors = getAncestors("Puppy", schemas);

      expect(ancestors.size).toBe(3);
      expect(ancestors.has("Dog")).toBe(true);
      expect(ancestors.has("Pet")).toBe(true);
      expect(ancestors.has("Animal")).toBe(true);
    });

    it("handles multiple ancestors", () => {
      const schemas = {
        Food: {
          type: "object",
        },
        Animal: {
          allOf: [{ $ref: "#/components/schemas/Food" }],
        },
        Dog: {
          allOf: [
            { $ref: "#/components/schemas/Animal" },
            { $ref: "#/components/schemas/Food" },
          ],
        },
      };

      const ancestors = getAncestors("Dog", schemas);

      expect(ancestors.size).toBe(2);
      expect(ancestors.has("Animal")).toBe(true);
      expect(ancestors.has("Food")).toBe(true);
    });

    it("returns empty set for schema with no ancestors", () => {
      const schemas = {
        Root: {
          type: "object",
        },
      };

      const ancestors = getAncestors("Root", schemas);
      expect(ancestors.size).toBe(0);
    });
  });
});
