import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { optimizeAllOfComposition } from "./optimizeAllOfComposition.js";
import { removeUnusedSchemas, RemoveOptions } from "./removeUnusedSchemas.js";
import {
  removeFromOneOfByName,
  removeFromOneOfGlobally,
} from "./removeFromOneOfByName.js";
import { allOfToOneOf, AllOfToOneOfOptions } from "./allOfToOneOf.js";

function parseYamlOrJson(data: any): any {
  // Accept pre-parsed objects (useful in tests)
  if (data && typeof data === "object") return data;
  if (typeof data !== "string") return {};
  try {
    return YAML.parse(data);
  } catch (yamlError) {
    try {
      return JSON.parse(data);
    } catch (jsonError) {
      console.error("Failed to parse input as YAML or JSON:", yamlError, jsonError);
      return {};
    }
  }
}

async function writeOutput(
  doc: any,
  output: string | undefined,
  format: (doc: any, target?: string) => string
) {
  const out = format(doc, output);
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, out, "utf8");
  } else {
    process.stdout.write(out);
  }
}

function logSchemaChanges(before: string[], after: string[]) {
  for (const name of before) {
    if (after.includes(name)) {
      console.error(`[KEEP]    ${name}`);
    } else {
      console.error(`[REMOVE]  ${name}`);
    }
  }
}

export async function runRemoveUnused(
  opts: {
    output?: string;
    keep?: string;
    aggressive?: boolean;
    ignoreParents?: string;
  },
  format: (doc: any, target?: string) => string,
  reader: () => Promise<string>
) {

  // Commander now passes keep and ignoreParents as arrays (variadic)
  const keep = Array.isArray(opts.keep) ? opts.keep : (opts.keep ? String(opts.keep).split(",").map(s => s.trim()).filter(Boolean) : []);
  const ignoreParents = Array.isArray(opts.ignoreParents) ? opts.ignoreParents : (opts.ignoreParents ? String(opts.ignoreParents).split(",").map(s => s.trim()).filter(Boolean) : []);

  const ropts: RemoveOptions = {
    keep,
    aggressive: Boolean(opts.aggressive),
    ignoreParents,
  };

  let doc: any, ext: string | undefined;
  doc = parseYamlOrJson(await reader());
  const beforeSchemas = Object.keys(doc?.components?.schemas ?? {});
  removeUnusedSchemas(doc, ropts);
  const afterSchemas = Object.keys(doc?.components?.schemas ?? {});
  logSchemaChanges(beforeSchemas, afterSchemas);
  await writeOutput(doc, opts.output, format);
}

function guess(name: string, doc: any): string[] {
    const keys = doc?.components?.schemas ? Object.keys(doc.components.schemas) : [];
    return [name,  ...keys.filter((key) => key.startsWith(`${name}_`))];
}


export async function runRemoveOneOf(
  opts: { parent: string | undefined; remove: string[]; guess: boolean; output?: string },
  format: (doc: any, target?: string) => string,
  reader: () => Promise<string>
) {
  const doc = parseYamlOrJson(await reader());

  if (!doc.components || !doc.components.schemas) {
    console.error("[ERROR] The input document does not contain valid components.schemas.");
    return;
  }

  const toRemove = opts.guess ? opts.remove.flatMap((name) => guess(name, doc)) : opts.remove;

  if (opts.parent) {
    let anyChanged = false;
    for (const name of toRemove) {
      const changed = removeFromOneOfByName(doc, opts.parent, name);
      if (changed) {
        console.error(`[REMOVE-ONEOF] Removed '${name}' from oneOf of '${opts.parent}'.`);
        anyChanged = true;
      } else {
        console.error(`[WARN] No change: schema '${name}' not found in oneOf of '${opts.parent}'.`);
      }
    }
    if (!anyChanged) {
      console.error(`[WARN] No schemas removed from oneOf of '${opts.parent}'.`);
    }
  } else {
    let total = 0;
    for (const name of toRemove) {
      const count = removeFromOneOfGlobally(doc, name);
      if (count === 0) {
        console.error(`[WARN] No change: schema '${name}' not found in any oneOf.`);
      } else {
        console.error(`[REMOVE-ONEOF-GLOBAL] Removed '${name}' from ${count} oneOf(s) globally.`);
        total += count;
      }
    }
    if (total === 0) {
      console.error(`[WARN] No schemas removed globally.`);
    }
  }
  await writeOutput(doc, opts.output, format);
}

/**
 * Optimizes allOf composition in the provided OpenAPI document.
 *
 * @param input - Path to the input OpenAPI document.
 * @param output - Path to the output OpenAPI document.
 */
export async function optimizeAllOf(  opts: { output?: string },
  format: (doc: any, target?: string) => string,
  reader: () => Promise<string>) {
  const data = await reader();
  const doc = parseYamlOrJson(data);

  optimizeAllOfComposition(doc);

  await writeOutput(doc, opts.output, format);
}

/**
 * Converts allOf + discriminator patterns to oneOf + discriminator.
 *
 * @param opts - Options including output path and transformation options
 * @param format - Function to format output
 * @param reader - Function to read input
 */
export async function runAllOfToOneOf(
  opts: { output?: string; removeDiscriminatorFromBase?: boolean; addDiscriminatorConst?: boolean; ignoreSingleSpecialization?: boolean },
  format: (doc: any, target?: string) => string,
  reader: () => Promise<string>
) {
  const data = await reader();
  const doc = parseYamlOrJson(data);

  if (!doc.components || !doc.components.schemas) {
    console.error("[ERROR] The input document does not contain valid components.schemas.");
    return;
  }

  const beforeSchemas = Object.keys(doc.components.schemas);
  const topts: AllOfToOneOfOptions = {
    removeDiscriminatorFromBase: Boolean(opts.removeDiscriminatorFromBase),
    addDiscriminatorConst: opts.addDiscriminatorConst !== false,
    ignoreSingleSpecialization: Boolean(opts.ignoreSingleSpecialization),
  };

  allOfToOneOf(doc, topts);

  const afterSchemas = Object.keys(doc.components.schemas);
  const newSchemas = afterSchemas.filter(s => !beforeSchemas.includes(s));

  if (newSchemas.length > 0) {
    console.error(`[ALLOF-TO-ONEOF] Created wrapper schema(s): ${newSchemas.join(", ")}`);
  } else {
    console.error("[INFO] No allOf + discriminator patterns found to convert.");
  }

  await writeOutput(doc, opts.output, format);
}
