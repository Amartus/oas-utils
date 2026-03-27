import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { AllOfToOneOfTransform } from "../src/lib/allOfToOneOfInterface.js";
import { allOfToOneOf } from "../src/lib/allOfToOneOfJsonPath.js";
import { testSchemas } from "./schemaLoader.js";
import { createDoc, objectSchema, oneOfRefs, ref } from "./testBuilders.js";

async function loadYaml(file: string): Promise<any> {
  const raw = await fs.readFile(file, "utf8");
  return YAML.parse(raw);
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function discriminatorSchema(
  propertyName: string,
  mapping: Record<string, string>,
  extra: Record<string, any> = {}
): any {
  return {
    type: "object",
    ...extra,
    discriminator: {
      propertyName,
      mapping: Object.fromEntries(Object.entries(mapping).map(([key, schemaName]) => [key, ref(schemaName)])),
    },
  };
}

function allOfChild(parentName: string, properties: Record<string, any> = {}, extra: Record<string, any> = {}): any {
  return {
    allOf: [{ $ref: ref(parentName) }, objectSchema(properties)],
    ...extra,
  };
}

function jsonResponsePath(pathName: string, schemaName: string, description = "ok"): Record<string, any> {
  return {
    [pathName]: {
      get: {
        responses: {
          "200": {
            description,
            content: {
              "application/json": {
                schema: { $ref: ref(schemaName) },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Deep equality comparison that ignores:
 * - Object key order
 * - Array element order (treats arrays as sets)
 */
function deepEqualUnordered(a: any, b: any, path: string = "root"): { equal: boolean; diffs: string[] } {
  const diffs: string[] = [];

  function compare(a: any, b: any, currentPath: string): boolean {
    // Handle primitives and null
    if (a === b) return true;
    if (a == null || b == null) {
      diffs.push(`${currentPath}: null mismatch - actual: ${JSON.stringify(a)}, expected: ${JSON.stringify(b)}`);
      return false;
    }
    if (typeof a !== typeof b) {
      diffs.push(`${currentPath}: type mismatch - actual: ${typeof a}, expected: ${typeof b}`);
      return false;
    }

    // Handle arrays - treat as sets (order-insensitive)
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        diffs.push(`${currentPath}: array length mismatch - actual: ${a.length}, expected: ${b.length}`);
        return false;
      }

      // For each element in a, find a matching element in b
      const bMatched = new Set<number>();
      const unmatchedA: any[] = [];
      for (let i = 0; i < a.length; i++) {
        const aItem = a[i];
        let found = false;
        const startDiffCount = diffs.length;
        for (let j = 0; j < b.length; j++) {
          if (!bMatched.has(j)) {
            const result = compare(aItem, b[j], `${currentPath}[${i}]`);
            if (result) {
              bMatched.add(j);
              found = true;
              // Clear any diffs that were added during failed comparison attempts
              diffs.splice(startDiffCount);
              break;
            }
          }
        }
        if (!found) {
          unmatchedA.push(aItem);
        }
      }

      if (unmatchedA.length > 0) {
        diffs.push(`${currentPath}: unmatched array elements in actual: ${JSON.stringify(unmatchedA, null, 2)}`);
        const unmatchedB = b.filter((_: any, i: number) => !bMatched.has(i));
        if (unmatchedB.length > 0) {
          diffs.push(`${currentPath}: unmatched array elements in expected: ${JSON.stringify(unmatchedB, null, 2)}`);
        }
        return false;
      }

      return true;
    }

    // Handle objects (key order-insensitive)
    if (typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a).sort();
      const bKeys = Object.keys(b).sort();

      const missingInB = aKeys.filter(k => !bKeys.includes(k));
      const missingInA = bKeys.filter(k => !aKeys.includes(k));

      if (missingInB.length > 0) {
        diffs.push(`${currentPath}: keys in actual but not in expected: ${missingInB.join(", ")}`);
      }
      if (missingInA.length > 0) {
        diffs.push(`${currentPath}: keys in expected but not in actual: ${missingInA.join(", ")}`);
      }

      if (aKeys.length !== bKeys.length) return false;

      let allMatch = true;
      for (const key of aKeys) {
        if (!compare(a[key], b[key], `${currentPath}.${key}`)) {
          allMatch = false;
        }
      }

      return allMatch;
    }

    diffs.push(`${currentPath}: value mismatch - actual: ${JSON.stringify(a)}, expected: ${JSON.stringify(b)}`);
    return false;
  }

  const equal = compare(a, b, path);
  return { equal, diffs };
}

/**
 * Parametrized test suite - runs the same tests for all three implementations.
 * Each test receives the transform function as a parameter.
 */
const implementations: Array<{ name: string; transform: AllOfToOneOfTransform }> = [
  { name: "jsonpath", transform: allOfToOneOf },
];

describe.each(implementations)("allOfToOneOf ($name implementation)", ({ name, transform }) => {

  describe("file-based tests", () => {
    const cases = ["foo-fvo-res", "merge-nested-oneof", "nested-oneof-discriminators", "nested-oneof-discriminators-sametypedisc"];

    for (const testCase of cases) {
      it(`${testCase} - matches expected output`, async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const base = path.resolve(__dirname, "resources", `${testCase}`);
        const inputPath = base + ".input.yaml";
        const expectedPath = base + ".expected.yaml";

        const input = await loadYaml(inputPath);
        const expected = await loadYaml(expectedPath);

        let options: any = undefined;
        try {
          const optsRaw = await fs.readFile(base + ".options.json", "utf8");
          options = JSON.parse(optsRaw);
        } catch { }

        const result = transform(deepClone(input), options);
        const comparison = deepEqualUnordered(result, expected);

        if (!comparison.equal) {
          console.log(`\n❌ Test failed: ${testCase}`);
          console.log(`\n📋 Differences found (${comparison.diffs.length}):`);
          comparison.diffs.forEach((diff, i) => console.log(`  ${i + 1}. ${diff}`));
          console.log(`\n📄 Full actual result:\n${JSON.stringify(result, null, 2)}`);
          console.log(`\n📄 Full expected result:\n${JSON.stringify(expected, null, 2)}`);
        }

        expect(comparison.equal, `Differences:\n${comparison.diffs.join('\n')}`).toBe(true);
      });
    }

    it("nested-oneof-discriminators-sametypedisc - with addDiscriminatorConst: false", async () => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const base = path.resolve(__dirname, "resources", "nested-oneof-discriminators-sametypedisc");
      const inputPath = base + ".input.yaml";
      const expectedPath = base + ".noconst.expected.yaml";

      const input = await loadYaml(inputPath);
      const expected = await loadYaml(expectedPath);

      const result = transform(deepClone(input), { addDiscriminatorConst: false });
      const comparison = deepEqualUnordered(result, expected);

      if (!comparison.equal) {
        console.log(`\n❌ Test failed: nested-oneof-discriminators-sametypedisc (noconst)`);
        console.log(`\n📋 Differences found (${comparison.diffs.length}):`);
        comparison.diffs.forEach((diff, i) => console.log(`  ${i + 1}. ${diff}`));
        console.log(`\n📄 Full actual result:\n${JSON.stringify(result, null, 2)}`);
        console.log(`\n📄 Full expected result:\n${JSON.stringify(expected, null, 2)}`);
      }

      expect(comparison.equal, `Differences:\n${comparison.diffs.join('\n')}`).toBe(true);
    });

    for (const testCase of ["extensible-allof-nested-discriminators", "extensible-only-allof-to-oneof"]) {
      it(`${testCase} - with addDiscriminatorConst: false and mergeNestedOneOf: true`, async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const base = path.resolve(__dirname, "resources", testCase);
        const inputPath = base + ".input.yaml";
        const expectedPath = base + ".mergeOneOf.expected.yaml";

        const input = await loadYaml(inputPath);
        const expected = await loadYaml(expectedPath);

        const result = transform(deepClone(input), { addDiscriminatorConst: false, mergeNestedOneOf: true });
        const comparison = deepEqualUnordered(result, expected);

        if (!comparison.equal) {
          console.log(`\n❌ Test failed: ${testCase} (mergeOneOf)`);
          console.log(`\n📋 Differences found (${comparison.diffs.length}):`);
          comparison.diffs.forEach((diff, i) => console.log(`  ${i + 1}. ${diff}`));
          console.log(`\n📄 Full actual result:\n${JSON.stringify(result, null, 2)}`);
          console.log(`\n📄 Full expected result:\n${JSON.stringify(expected, null, 2)}`);
        }

        expect(comparison.equal, `Differences:\n${comparison.diffs.join('\n')}`).toBe(true);
      });
    }



    it("does not uplift when children have different discriminator property names", async () => {
      const doc: any = createDoc({
        openapi: "3.0.0",
        schemas: {
          Animal: {
            ...discriminatorSchema("kind", { Cat: "CatPolymorphic", Bird: "BirdPolymorphic" }),
            oneOf: oneOfRefs("CatPolymorphic", "BirdPolymorphic"),
          },
          CatPolymorphic: {
            ...discriminatorSchema("catType", { Domestic: "DomesticCat", Wild: "WildCat" }),
            oneOf: oneOfRefs("DomesticCat", "WildCat"),
          },
          BirdPolymorphic: {
            ...discriminatorSchema("birdType", { Sparrow: "Sparrow", Eagle: "Eagle" }),
            oneOf: oneOfRefs("Sparrow", "Eagle"),
          },
          DomesticCat: objectSchema({ name: { type: "string" } }),
          WildCat: objectSchema({ habitat: { type: "string" } }),
          Sparrow: objectSchema({ chirp: { type: "string" } }),
          Eagle: objectSchema({ wingspan: { type: "number" } }),
        },
      });

      const result = transform(deepClone(doc), { mergeNestedOneOf: true });

      // Animal should NOT merge children because they use different discriminator property names
      expect(result.components.schemas.Animal.oneOf).toHaveLength(2);
      expect(result.components.schemas.Animal.oneOf[0].$ref).toBe("#/components/schemas/CatPolymorphic");
      expect(result.components.schemas.Animal.oneOf[1].$ref).toBe("#/components/schemas/BirdPolymorphic");

      // Animal discriminator should remain unchanged since no merge happened
      expect(result.components.schemas.Animal.discriminator.propertyName).toBe("kind");

      // Child wrappers should still exist with their original structure
      expect(result.components.schemas.CatPolymorphic.oneOf).toHaveLength(2);
      expect(result.components.schemas.CatPolymorphic.discriminator.propertyName).toBe("catType");
      expect(result.components.schemas.BirdPolymorphic.oneOf).toHaveLength(2);
      expect(result.components.schemas.BirdPolymorphic.discriminator.propertyName).toBe("birdType");
    });
  });

  it("converts allOf + discriminator to oneOf + discriminator with const properties", () => {
    const doc: any = createDoc({
      schemas: {
        Animal: testSchemas.animalWithDiscriminator({
          Cat: ref("Cat"),
          Dog: ref("Dog"),
        }),
        Cat: testSchemas.catSpecialized(),
        Dog: testSchemas.dogSpecialized(),
        Human: {
          ...objectSchema({
            id: { type: "string", example: "h1", description: "Unique identifier for the human" },
            name: { type: "string", example: "Alex Johnson" },
            age: { type: "integer", minimum: 0, example: 32 },
            pets: {
              type: "array",
              description: "Array of animals (polymorphic via discriminator)",
              items: { $ref: ref("Animal") },
            },
          }),
          required: ["id", "name"],
          description: "A human who may own zero or more pets",
        },
      },
    });

    const result = transform(deepClone(doc));

    expect(result.components.schemas.AnimalPolymorphic).toBeDefined();
    expect(result.components.schemas.AnimalPolymorphic.oneOf).toHaveLength(2);
    expect(result.components.schemas.AnimalPolymorphic.discriminator.propertyName).toBe("type");
    expect(result.components.schemas.Cat.allOf.find((item: any) => item.properties?.type?.const === "Cat")).toBeDefined();
    expect(result.components.schemas.Dog.allOf.find((item: any) => item.properties?.type?.const === "Dog")).toBeDefined();
    expect(result.components.schemas.Human.properties.pets.items.$ref).toBe("#/components/schemas/AnimalPolymorphic");
    expect(result.components.schemas.Animal.discriminator).toBeUndefined();
  });

  it("converts vehicle hierarchy with commercial vehicle references", () => {
    const doc: any = createDoc({
      openapi: "3.0.0",
      paths: jsonResponsePath("/dealership", "Dealership", "Returns dealership"),
      schemas: {
        Vehicle: discriminatorSchema("type", { Car: "Car", Bike: "Bike", ElectricCar: "ElectricCar" }, {
          properties: { id: { type: "string" }, type: { type: "string" } },
        }),
        Car: allOfChild("Vehicle", { seatingCapacity: { type: "number" } }, {
          discriminator: {
            propertyName: "type",
            mapping: {
              Car: ref("Car"),
              ElectricCar: ref("ElectricCar"),
              CommercialCar: ref("CommercialCar"),
            },
          },
        }),
        ElectricCar: allOfChild("Car", { batteryCapacity: { type: "number" } }),
        Bike: allOfChild("Vehicle", { engineType: { type: "string" } }),
        CommercialCar: allOfChild("Car", { cargoCapacity: { type: "number" } }, {
          discriminator: {
            propertyName: "commercialKind",
            mapping: {
              Car: ref("Car"),
              ElectricCar: ref("ElectricCar"),
            },
          },
        }),
        Dealership: objectSchema({
          primaryCar: { $ref: ref("Car") },
          commercialVehicle: { $ref: ref("CommercialCar") },
        }),
      },
    });

    const result = transform(deepClone(doc));

    expect(result.components.schemas.CarPolymorphic).toBeDefined();
    const carRefs = result.components.schemas.CarPolymorphic.oneOf.map((item: any) => item.$ref);
    expect(carRefs).toContain("#/components/schemas/ElectricCar");
    expect(carRefs).toContain("#/components/schemas/CommercialCar");

    const commercialCar = result.components.schemas.CommercialCar;
    expect(commercialCar).toBeDefined();
    const commercialCarParents = commercialCar.allOf.map((item: any) => item.$ref).filter(Boolean);
    expect(commercialCarParents).toContain("#/components/schemas/Car");

    const dealershipProps = result.components.schemas.Dealership.properties;
    expect(dealershipProps.primaryCar.$ref).toBe("#/components/schemas/CarPolymorphic");
    expect(dealershipProps.commercialVehicle.$ref).toBe("#/components/schemas/CommercialCar");
    expect(result.components.schemas.CommercialCar.discriminator).toBeDefined();
  });

  it("handles nested polymorphic bases with independent wrappers", () => {
    const doc: any = createDoc({
      openapi: "3.1.0",
      paths: {
        ...jsonResponsePath("/byBase", "Animal", "Base A response"),
        ...jsonResponsePath("/byIntermediate", "Pet", "Intermediate Pet response"),
      },
      schemas: {
        Animal: discriminatorSchema("type", { Pet: "Pet", Bird: "Bird" }, {
          properties: { id: { type: "string" }, type: { type: "string" } },
        }),
        Pet: allOfChild("Animal", { owner: { type: "string" } }, {
          discriminator: {
            propertyName: "type",
            mapping: { Cat: ref("Cat"), Dog: ref("Dog") },
          },
        }),
        Bird: allOfChild("Animal", { wingSpan: { type: "number" } }),
        Cat: allOfChild("Pet", { lives: { type: "integer" } }),
        Dog: allOfChild("Pet", { barkVolume: { type: "number" } }),
      },
    });

    const result = transform(deepClone(doc));

    expect(result.components.schemas.AnimalPolymorphic).toBeDefined();
    expect(result.components.schemas.PetPolymorphic).toBeDefined();

    const animalOneOf = result.components.schemas.AnimalPolymorphic.oneOf;
    expect(animalOneOf.some((item: any) => item.$ref === "#/components/schemas/PetPolymorphic")).toBe(true);

    expect(result.paths["/byBase"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/AnimalPolymorphic");
    expect(result.paths["/byIntermediate"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/PetPolymorphic");
  });

  it("does not modify documents without discriminators", () => {
    const doc: any = createDoc({
      schemas: {
        Base: objectSchema(),
        Derived: { allOf: [{ $ref: ref("Base") }] },
      },
    });

    const before = JSON.stringify(doc);
    const result = transform(deepClone(doc));
    expect(JSON.stringify(result)).toBe(before);
  });

  it("replaces references in nested structures", () => {
    const doc: any = createDoc({
      paths: jsonResponsePath("/test", "Animal"),
      schemas: {
        Animal: testSchemas.animalWithDiscriminator({ Dog: ref("Dog"), Cat: ref("Cat") }),
        Dog: testSchemas.dogSpecialized(),
        Cat: testSchemas.catSpecialized(),
        Pack: objectSchema({
          leader: { $ref: ref("Animal") },
          members: { type: "array", items: { $ref: ref("Animal") } },
        }),
      },
    });

    const result = transform(deepClone(doc));

    expect(result.components.schemas.Pack.properties.members.items.$ref)
      .toBe("#/components/schemas/AnimalPolymorphic");
    expect(result.components.schemas.Pack.properties.leader.$ref)
      .toBe("#/components/schemas/AnimalPolymorphic");
  });

  it("creates wrapper when reference is nested inside allOf item properties", () => {
    const doc: any = createDoc({
      schemas: {
        Entity: objectSchema(),
        Animal: allOfChild("Entity", { name: { type: "string" } }, {
          discriminator: {
            propertyName: "@type",
            mapping: { Animal: ref("Animal"), Dog: ref("Dog") },
          },
        }),
        Dog: allOfChild("Animal", { value: { type: "string" } }),
        Kennel: {
          allOf: [
            { $ref: ref("Entity") },
            objectSchema({ pet: { $ref: ref("Animal") } }),
          ],
        },
      },
    });

    const result = transform(deepClone(doc));

    expect(result.components.schemas.AnimalPolymorphic).toBeDefined();
    expect(result.components.schemas.AnimalOneOf).toBeDefined();
    expect(result.components.schemas.Animal.discriminator).toBeUndefined();
  });

  it("handles addDiscriminatorConst option", () => {
    const doc: any = createDoc({
      schemas: {
        Animal: testSchemas.animalWithDiscriminator({ Cat: ref("Cat") }),
        Cat: testSchemas.catSpecialized(),
      },
    });

    const result = transform(deepClone(doc), { addDiscriminatorConst: false });

    const catAllOf = result.components.schemas.Cat.allOf;
    const catInline = catAllOf?.find((item: any) => item.properties && item.properties.type);
    expect(catInline).toBeUndefined();
  });

  it("replaces references in properties nested inside allOf composition items", () => {
    // Regression test for: https://github.com/Amartus/oas-utils/issues/...
    // When a schema uses allOf to compose with another, and that composition item
    // contains properties that reference a polymorphic schema, those references
    // should be replaced with the polymorphic wrapper.
    //
    // Example: Product.allOf[1].properties.productPrice.$ref → ProductPrice
    // should become: Product.allOf[1].properties.productPrice.$ref → ProductPricePolymorphic
    const doc: any = createDoc({
      schemas: {
        Base: objectSchema({ id: { type: "string" } }),
        Price: allOfChild("Base", { amount: { type: "number" } }, {
          discriminator: {
            propertyName: "@type",
            mapping: { Price: ref("Price"), PremiumPrice: ref("PremiumPrice") },
          },
        }),
        PremiumPrice: allOfChild("Price", { premiumFee: { type: "number" } }),
        Product: {
          allOf: [
            { $ref: ref("Base") },
            objectSchema({
              pricing: {
                type: "array",
                items: { $ref: ref("Price") },
              },
            }),
          ],
        },
      },
    });

    const result = transform(deepClone(doc));

    // Verify wrappers were created
    expect(result.components.schemas.PricePolymorphic).toBeDefined();
    expect(result.components.schemas.PriceOneOf).toBeDefined();
    expect(result.components.schemas.Price.discriminator).toBeUndefined();

    // Verify the nested reference was replaced
    const productPricingItems = result.components.schemas.Product.allOf[1].properties.pricing.items;
    expect(productPricingItems.$ref).toBe("#/components/schemas/PricePolymorphic");
  });
});
