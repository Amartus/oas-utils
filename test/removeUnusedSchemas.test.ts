import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { removeUnusedSchemas } from "../src/lib/removeUnusedSchemas";

async function loadYaml(file: string): Promise<any> {
  const raw = await fs.readFile(file, "utf8");
  return YAML.parse(raw);
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

describe("removeUnusedSchemas (fixtures)", () => {
  const cases = [
    "basic-transitive",
    "paths-only",
    "components-ref",
    "allof-promotion",
    "allof-transitive",
    "keep-option",
    "aggressive-components",
    "allof-promotion-positive",
    "allof-promotion-negative",
    "allof-ignore-parent",
  ];

  for (const name of cases) {
    it(name, async () => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const base = path.resolve(__dirname, "resources", `${name}`);
      const inputPath = base + ".input.yaml";
      const expectedPath = base + ".expected.yaml";
      const input = await loadYaml(inputPath);
      const expected = await loadYaml(expectedPath);
      // optional options file
      let options: any = undefined;
      try {
        const optsRaw = await fs.readFile(base + ".options.json", "utf8");
        options = JSON.parse(optsRaw);
      } catch {}
      const actual = removeUnusedSchemas(deepClone(input), options);
      expect(actual).toEqual(expected);
    });
  }
});
