# oas-utils

Utilities for working with OpenAPI (OAS) documents. Includes tools to remove unused schemas and to remove entries from oneOf. Use them as a CLI or as Redocly decorators.

## Definition of "unused schema"

"Unused" means a schema under `components.schemas` that is not referenced (directly or transitively) from anything reachable under the `paths` section. Exception: if a schema has an `allOf` that references a schema already considered used, that schema is also considered used. Traversal follows `$ref` chains found within schemas and follows `$ref` from `paths` into other components (e.g. `requestBodies`) to discover nested schema usage.

## Install

```
npm i -D oas-utils
```

Or clone this repo and build locally.

### Local global install

To install globally from a local clone:

```
npm install -g
```

This makes the `oas-utils` CLI available system-wide.

## CLI usage

```
oas-utils remove-unused <input.yaml> -o output.yaml [--keep Name1 Name2] [--aggressive] [--ignore-parents NameX]
# Read from stdin and write to stdout
cat openapi.yaml | oas-utils remove-unused --keep CommonError > pruned.yaml
```

Options:
- --keep: schema names to keep regardless of usage; can be passed multiple times or as a variadic list (e.g., `--keep CommonError Pagination`).
- --aggressive: also prune other unused components referenced from paths (responses, headers, requestBodies, parameters, examples, links, callbacks, securitySchemes). Non-referenced entries in these sections are removed.
- --ignore-parents: schema names that shouldn't promote children via allOf (can be repeated). Useful to avoid allOf upward inclusion when the parent acts as an abstract/base.

Remove entries from oneOf and update discriminators:

```
oas-utils remove-oneof <input.yaml> --parent Pet --remove Cat --remove Dog -o output.yaml
# Or remove globally from all oneOf occurrences
oas-utils remove-oneof <input.yaml> --remove Cat
# Guess variant names: Cat, Cat_* will be included
oas-utils remove-oneof <input.yaml> --parent Pet --remove Cat --guess
```

Options (remove-oneof):
- --parent: parent schema name containing oneOf; if omitted, removal is global across the document.
- --remove: schema name(s) to remove; can be repeated.
- --guess: expand each name to include variants starting with `<name>_`.

## As Redocly decorators

1) Add the plugin to `plugins` in your `redocly.yaml` (path relative to the config):

```
plugins:
  - ./node_modules/oas-utils/dist/redocly/plugin.js
```

2) Enable the decorator:

```
decorators:
  # Remove unused schemas
  oas-utils/remove-unused:
    keep: [CommonError, Pagination]
    aggressive: true

  # Remove entries from oneOf (and update discriminator mappings)
  oas-utils/remove-oneof:
    parent: Pet             # optional; if omitted, removal is global
    remove: [Cat, Cat_variant1]
    guess: false
```

3) Run bundling with Redocly CLI and the decorators will apply the transformations. With `aggressive: true`, unused non-schema components (responses, headers, requestBodies, etc.) are removed as well.

Notes:
- Preferred plugin id is `oas-utils`. Old aliases `oas-remove-unused/remove-unused-schemas` and `oas-remove-unused/remove-from-oneof` still work.

## Programmatic usage

```
import { removeUnusedSchemas } from 'oas-utils';
const pruned = removeUnusedSchemas(doc, { keep: ['CommonError'], aggressive: true });
```

## Notes
- This tool resolves direct and transitive `$ref` usages of `components.schemas` and deletes unreferenced definitions. Starting points are only what’s reachable from `paths`.
- Special rule: any schema with `allOf` that references a used schema is also considered used.
- With `--aggressive`, unused non-schema components (responses, headers, requestBodies, parameters, examples, links, callbacks, securitySchemes) are removed as well.
- YAML and JSON are supported; output format follows `-o` extension, otherwise YAML.

## Development and tests

Run builds and unit tests (fixture-based):

```
npm run build
npm run test
```

Fixture files live under `test/resources` as `<name>.input.yaml`, `<name>.expected.yaml`, with optional `<name>.options.json` to pass core options like `{ "keep": ["Foo"], "aggressive": true }`.
