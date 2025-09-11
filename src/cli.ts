#!/usr/bin/env node
import fs from "node:fs/promises";
import { Command } from "commander";
import { runRemoveUnused, runRemoveOneOf, optimizeAllOf } from "./lib/cliActions.js";
import YAML from "yaml";


const program = new Command();
program
  .command("remove-unused")
  .showHelpAfterError()
  .description("Remove unused schemas from an OpenAPI (OAS) file")
  .argument(
    "[input]",
    "Path to input OpenAPI file (YAML or JSON). If omitted, reads from stdin"
  )
  .option(
    "-o, --output <file>",
    "Write result to this file (defaults to stdout)"
  )
  .option(
    "--keep <names...>",
    "Schema names to keep regardless of usage (can be repeated)",
    []
  )
  .option("--aggressive", "Also prune empty component sections", false)
  .option(
    "--ignore-parents <names...>",
    "Schema names to ignore as allOf parents (can be repeated)",
    []
  )
  .action(
    async (
      input: string | undefined,
      opts: {
        output?: string;
        keep?: string;
        aggressive?: boolean;
        ignoreParents?: string;
      }
    ) => {
      try {
        await runRemoveUnused(opts, format, () => reader(input));
      } catch (err: any) {
        console.error(`Error: ${err?.message || String(err)}`);
        process.exitCode = 1;
      }
    }
  );

program
  .command("remove-oneof")
  .showHelpAfterError()
  .description("Remove one or more schemas from oneOf and update discriminator mappings")
  .argument("<input>", "Path to input OpenAPI file (YAML or JSON)")
  .option("--parent <name>", "Parent schema name containing oneOf")
  .requiredOption("--remove <name...>", "Schema name(s) to remove from oneOf (can be repeated)")
  .option(
    "-o, --output <file>",
    "Write result to this file (defaults to stdout)"
  )
  .option("--guess", "Guess schema names for each --remove <name>", false)
  .action(
    async (
      input: string,
      opts: { parent: string | undefined; remove: string[]; output?: string, guess: boolean }
    ) => {
      try {
        await runRemoveOneOf(opts, format, () => reader(input));
      } catch (err: any) {
        console.error(`Error: ${err?.message || String(err)}`);
        process.exitCode = 1;
      }
    }
  );

program
  .command("optimize-allof")
  .showHelpAfterError()
  .description("Optimize allOf composition in an OpenAPI (OAS) file")
  .argument(
    "[input]",
    "Path to input OpenAPI file (YAML or JSON). If omitted, reads from stdin"
  )
  .option(
    "-o, --output <file>",
    "Write result to this file (defaults to stdout)"
  )
  .action(async (input: string | undefined, opts: { output?: string }) => {
    await optimizeAllOf(opts, format, () => reader(input));
  });

if (process.argv.length <= 2) {
  program.help();
} else {
  program.parse();
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function loadDoc(
  input: string
): Promise<string> {
  const raw = await fs.readFile(input, "utf8");
  return raw;
}

async function reader(input: string | undefined): Promise<string> {
  if (input) {
    return loadDoc(input);
  }
  return readStdin();
}


function format(doc: any, target?: string) {
  const isJson = target?.endsWith(".json");
  return isJson ? JSON.stringify(doc, null, 2) + "\n" : YAML.stringify(doc);
}
