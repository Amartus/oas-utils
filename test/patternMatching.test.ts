import { describe, it, expect } from "vitest";
import { createWildcardMatcher, matchesAny, createKeepPredicate } from "../src/lib/patternMatching.js";

describe("patternMatching", () => {
  describe("createWildcardMatcher", () => {
    it("should match exact strings when no wildcard", () => {
      const matcher = createWildcardMatcher("Foo");
      expect(matcher("Foo")).toBe(true);
      expect(matcher("FooBar")).toBe(false);
      expect(matcher("MyFoo")).toBe(false);
      expect(matcher("Bar")).toBe(false);
    });

    it("should match everything with single *", () => {
      const matcher = createWildcardMatcher("*");
      expect(matcher("")).toBe(true);
      expect(matcher("Foo")).toBe(true);
      expect(matcher("FooBar")).toBe(true);
      expect(matcher("anything")).toBe(true);
    });

    it("should match prefix with Foo*", () => {
      const matcher = createWildcardMatcher("Foo*");
      expect(matcher("Foo")).toBe(true);
      expect(matcher("FooBar")).toBe(true);
      expect(matcher("FooBarBaz")).toBe(true);
      expect(matcher("MyFoo")).toBe(false);
      expect(matcher("Bar")).toBe(false);
    });

    it("should match suffix with *Bar", () => {
      const matcher = createWildcardMatcher("*Bar");
      expect(matcher("Bar")).toBe(true);
      expect(matcher("FooBar")).toBe(true);
      expect(matcher("MyFooBar")).toBe(true);
      expect(matcher("BarFoo")).toBe(false);
      expect(matcher("Foo")).toBe(false);
    });

    it("should match substring with *Baz*", () => {
      const matcher = createWildcardMatcher("*Baz*");
      expect(matcher("Baz")).toBe(true);
      expect(matcher("FooBaz")).toBe(true);
      expect(matcher("BazBar")).toBe(true);
      expect(matcher("FooBazBar")).toBe(true);
      expect(matcher("Foo")).toBe(false);
    });

    it("should handle multiple wildcards", () => {
      const matcher = createWildcardMatcher("Foo*Bar*Baz");
      expect(matcher("FooBarBaz")).toBe(true);
      expect(matcher("FooXBarYBaz")).toBe(true);
      expect(matcher("FooBarXBaz")).toBe(true);
      expect(matcher("FooBaz")).toBe(false);
      expect(matcher("FooBar")).toBe(false);
    });

    it("should escape regex special characters", () => {
      const matcher = createWildcardMatcher("Foo.Bar*");
      expect(matcher("Foo.Bar")).toBe(true);
      expect(matcher("Foo.BarBaz")).toBe(true);
      expect(matcher("FooXBar")).toBe(false); // . should be literal, not regex wildcard
    });
  });

  describe("matchesAny", () => {
    it("should return false for empty patterns", () => {
      expect(matchesAny("Foo", [])).toBe(false);
    });

    it("should return true if any pattern matches", () => {
      expect(matchesAny("FooBar", ["Foo*", "Bar*"])).toBe(true);
      expect(matchesAny("BarBaz", ["Foo*", "Bar*"])).toBe(true);
      expect(matchesAny("Baz", ["Foo*", "Bar*"])).toBe(false);
    });

    it("should handle exact matches in patterns", () => {
      expect(matchesAny("Foo", ["Foo", "Bar"])).toBe(true);
      expect(matchesAny("Bar", ["Foo", "Bar"])).toBe(true);
      expect(matchesAny("FooBar", ["Foo", "Bar"])).toBe(false);
    });
  });

  describe("createKeepPredicate", () => {
    it("should return undefined when no patterns provided", () => {
      const predicate = createKeepPredicate([]);
      expect(predicate).toBeUndefined();
    });

    it("should keep only matching when positive patterns only", () => {
      const predicate = createKeepPredicate(["Foo*", "Bar"]);
      expect(predicate("Foo")).toBe(true);
      expect(predicate("FooBar")).toBe(true);
      expect(predicate("Bar")).toBe(true);
      expect(predicate("Baz")).toBe(false);
      expect(predicate("MyBar")).toBe(false);
    });

    it("should exclude matching when negative patterns only", () => {
      const predicate = createKeepPredicate(["!Foo*", "!Bar"]);
      expect(predicate("Foo")).toBe(false);
      expect(predicate("FooBar")).toBe(false);
      expect(predicate("Bar")).toBe(false);
      expect(predicate("Baz")).toBe(true);
      expect(predicate("MyBar")).toBe(true);
    });

    it("should combine positive and negative patterns correctly", () => {
      const predicate = createKeepPredicate(["Foo*", "!*Test"]);
      expect(predicate("Foo")).toBe(true);
      expect(predicate("FooBar")).toBe(true);
      expect(predicate("FooTest")).toBe(false); // matches positive but also negative
      expect(predicate("Bar")).toBe(false); // doesn't match positive
      expect(predicate("BarTest")).toBe(false); // doesn't match positive
    });

    it("should handle complex real-world scenarios", () => {
      // Keep all schemas starting with "Legacy" or "Deprecated" but not those ending with "_Test"
      const predicate = createKeepPredicate(["Legacy*", "Deprecated*", "!*_Test"]);
      expect(predicate("LegacyUser")).toBe(true);
      expect(predicate("DeprecatedProduct")).toBe(true);
      expect(predicate("LegacyUser_Test")).toBe(false);
      expect(predicate("User")).toBe(false);
      expect(predicate("User_Test")).toBe(false);
    });

    it("should handle wildcard * in positive patterns", () => {
      const predicate = createKeepPredicate(["*", "!*Test*"]);
      expect(predicate("Foo")).toBe(true);
      expect(predicate("Bar")).toBe(true);
      expect(predicate("FooTest")).toBe(false);
      expect(predicate("TestFoo")).toBe(false);
      expect(predicate("FooTestBar")).toBe(false);
    });

    it("should handle exact matches with negation", () => {
      const predicate = createKeepPredicate(["Foo", "Bar", "!Foo"]);
      expect(predicate("Foo")).toBe(false); // matches positive but excluded
      expect(predicate("Bar")).toBe(true);
      expect(predicate("FooBar")).toBe(false);
    });

    it("should trim patterns correctly", () => {
      const predicate = createKeepPredicate([" Foo* ", " !Bar* "]);
      expect(predicate("Foo")).toBe(true);
      expect(predicate("FooBar")).toBe(true);
      expect(predicate("Bar")).toBe(false);
      expect(predicate("BarBaz")).toBe(false);
    });
  });
});
