# oas-utils

Utilities for working with OpenAPI (OAS) documents. Includes tools to remove unused schemas, remove entries from oneOf, optimize allOf composition, convert allOf + discriminator patterns to oneOf + discriminator, clean up discriminator mappings, remove dangling `$ref` targets, and remove single-composition wrapper schemas. Use them as a CLI or as Redocly decorators.

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

### remove-unused

```
oas-utils remove-unused <input.yaml> -o output.yaml [--keep Name1 Name2] [--aggressive] [--ignore-parents NameX]
# Read from stdin and write to stdout
cat openapi.yaml | oas-utils remove-unused --keep CommonError > pruned.yaml
```

Options:
- --keep: schema names to keep regardless of usage; can be passed multiple times or as a variadic list (e.g., `--keep CommonError Pagination`).
- --aggressive: also prune other unused components referenced from paths (responses, headers, requestBodies, parameters, examples, links, callbacks, securitySchemes). Non-referenced entries in these sections are removed.
- --ignore-parents: schema names that shouldn't promote children via allOf (can be repeated). Useful to avoid allOf upward inclusion when the parent acts as an abstract/base.

### remove-oneof

Remove entries from oneOf and update discriminators:

```
oas-utils remove-oneof <input.yaml> --parent Pet --remove Cat --remove Dog -o output.yaml
# Or remove globally from all oneOf occurrences
oas-utils remove-oneof <input.yaml> --remove Cat
# Guess variant names: Cat, Cat_* will be included
oas-utils remove-oneof <input.yaml> --parent Pet --remove Cat --guess
```

Options:
- --parent: parent schema name containing oneOf; if omitted, removal is global across the document.
- --remove: schema name(s) to remove; can be repeated.
- --guess: expand each name to include variants starting with `<name>_`.

### optimize-allof

Optimize allOf composition by removing redundant references:

```
oas-utils optimize-allof <input.yaml> -o output.yaml
```

Options:
- -o, --output: write result to this file (defaults to stdout).

### allof-to-oneof

Convert allOf + discriminator patterns to oneOf + discriminator. This is useful for transforming inheritance-based polymorphic schemas into composition-based ones.

Specifically, it:
1. Identifies base schemas with discriminators
2. Finds concrete schemas that extend the base via allOf
3. Optionally adds a const property to each concrete schema matching its discriminator value (enabled by default)
4. Creates a new oneOf wrapper schema containing all concrete types
5. Replaces references to the base schema with the wrapper schema (outside of allOf composition contexts)
6. Removes discriminators from base schemas that received wrappers
7. Optionally merges nested oneOf schemas by inlining references to schemas that only contain oneOf

```
oas-utils allof-to-oneof <input.yaml> -o output.yaml
# Optionally skip adding const to specialization schemas
oas-utils allof-to-oneof <input.yaml> -o output.yaml --no-add-discriminator-const
# Optionally skip transformation if only one specialization is found
oas-utils allof-to-oneof <input.yaml> -o output.yaml --ignore-single-specialization
# Optionally merge nested oneOf schemas
oas-utils allof-to-oneof <input.yaml> -o output.yaml --merge-nested-oneof
```

Options:
- -o, --output: write result to this file (defaults to stdout).
- --no-add-discriminator-const: do not add const property with discriminator value to specialization schemas.
- --ignore-single-specialization: skip oneOf transformation if only one specialization is found (useful for bases with only one concrete implementation).
- --merge-nested-oneof: merge nested oneOf schemas by inlining references to schemas that only contain oneOf.

Example transformation (with addDiscriminatorConst enabled, the default):
- Base schema `Animal` with discriminator `type` and mapping `{Cat: ..., Dog: ...}`
- Concrete schemas `Cat` and `Dog` with `allOf: [{$ref: Animal}, {...}]`
- Creates `AnimalPolymorphic` with `oneOf: [Cat, Dog]` and the same discriminator
- Adds `type: {const: "Cat"}` to Cat's properties and `type: {const: "Dog"}` to Dog's properties
- Replaces references to `Animal` with `AnimalPolymorphic` in array items and other polymorphic contexts

### cleanup-discriminators

Clean up discriminator mappings by removing entries that reference non-existent schemas. This is useful when schemas are removed but discriminator mappings are not updated, leaving dangling references.

```
oas-utils cleanup-discriminators <input.yaml> -o output.yaml
# Read from stdin and write to stdout
cat openapi.yaml | oas-utils cleanup-discriminators > cleaned.yaml
```

Options:
- -o, --output: write result to this file (defaults to stdout).

Example:
- Original discriminator mapping: `{cat: '#/components/schemas/Cat', dog: '#/components/schemas/Dog', bird: '#/components/schemas/Bird'}`
- After removing `Bird` schema: mapping entries `bird` is invalid
- After cleanup: `{cat: '#/components/schemas/Cat', dog: '#/components/schemas/Dog'}`

### remove-single-composition

Remove single-composition wrapper schemas. A single-composition schema is one whose only content is a single `allOf`, `anyOf`, or `oneOf` containing exactly one `$ref`. Such schemas add indirection without semantic value and are replaced by their target reference.

```
oas-utils remove-single-composition <input.yaml> -o output.yaml
# Read from stdin and write to stdout
cat openapi.yaml | oas-utils remove-single-composition > cleaned.yaml
```

Options:
- -o, --output: write result to this file (defaults to stdout).

Example:
- Schema `Foo` with `allOf: [{$ref: '#/components/schemas/Bar'}]`
- `Foo` is removed and all references to `Foo` are replaced with `Bar`
- Transitive chains are resolved: if `A`→`B`→`C` are all single-composition, both `A` and `B` are removed and references point to `C`

### seal-schema

Seal object schemas to prevent additional properties. This ensures every final object shape exposed in the API is sealed (no additional properties allowed), without breaking schemas that are extended via `allOf`.

The algorithm:
1. Identifies schemas that are bases for extension (referenced in `allOf`)
2. For each such schema, creates a `Core` variant and a sealed wrapper
3. Rewrites `allOf` references to point to `Core` variants (allowing extension)
4. Seals composition roots (`allOf`, `anyOf`, `oneOf`) and direct-use schemas

This ensures:
- **Objects used directly** in fields or arrays are fully sealed
- **Objects used as bases** for extension remain unsealed internally but are sealed at the wrapper level
- **anyOf/oneOf compositions** remain valid alternatives and are sealed at the outer level

```
oas-utils seal-schema <input.yaml> -o output.yaml
# Use unevaluatedProperties: false (default, recommended for JSON Schema 2019-09+)
oas-utils seal-schema <input.yaml> -o output.yaml --use-unevaluated-properties
# Use additionalProperties: false instead
oas-utils seal-schema <input.yaml> -o output.yaml --use-additional-properties
# Automatically upgrade OpenAPI 3.0.x to 3.1.0 or JSON Schema to draft 2020-12
oas-utils seal-schema <input.yaml> -o output.yaml --uplift
```

Options:
- -o, --output: write result to this file (defaults to stdout).
- --use-unevaluated-properties: use `unevaluatedProperties: false` (default, better for JSON Schema 2019-09+).
- --use-additional-properties: use `additionalProperties: false` instead.
- --uplift: automatically upgrade OpenAPI version to 3.1.0 or JSON Schema to draft 2020-12 to support `unevaluatedProperties`.

Compatibility notes:
- When sealing against OpenAPI 3.0.x or JSON Schema draft-07, the CLI now detects `allOf` references and raises an error if `--use-additional-properties` is requested (because `additionalProperties:false` cannot cover compositions reliably). Use `--use-unevaluated-properties` together with `--uplift`, or manually upgrade the document, to avoid the error.
- The tool relies on `jsonpath-plus` for these checks, so users can expect faster detection of `allOf` + `$ref` patterns that trigger compatibility constraints.

**Note**: `unevaluatedProperties` is only supported in OpenAPI 3.1+ or JSON Schema 2019-09+. If your document uses an earlier version and you want to use `unevaluatedProperties`, either:
- Use the `--uplift` option to automatically upgrade the version
- Manually upgrade your document to a compatible version
- Use `--use-additional-properties` instead

Example transformation:
- Original `Animal` schema (object-like, referenced in `allOf` by `Cat`)
- Becomes: `AnimalCore` (unsealed original) + `Animal` wrapper with `allOf: [{$ref: AnimalCore}]` and `unevaluatedProperties: false`
- `Cat` now uses `allOf: [{$ref: AnimalCore}, {...}]` allowing safe extension
- Direct references to `Animal` point to the sealed wrapper
- Inline objects and composition roots are sealed with appropriate keywords

## As Redocly decorators

1) Add the plugin to `plugins` in your `redocly.yaml` (path relative to the config):

```
plugins:
  - ./node_modules/oas-utils/dist/redocly/plugin.js
```

2) Enable the decorators:

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

  # Optimize allOf composition
  oas-utils/optimize-allof: {}

  # Convert allOf + discriminator to oneOf + discriminator
  oas-utils/allof-to-oneof:
    addDiscriminatorConst: true
    ignoreSingleSpecialization: false

  # Clean up discriminator mappings
  oas-utils/cleanup-discriminators: {}

  # Remove dangling $ref entries that point to missing component schemas
  oas-utils/remove-dangling-refs: {}

  # Remove single-composition wrapper schemas
  oas-utils/remove-single-composition: {}

  # Seal object schemas
  oas-utils/seal-schema:
    useUnevaluatedProperties: true
    uplift: false  # Set to true to automatically upgrade OpenAPI/JSON Schema version
```

3) Run bundling with Redocly CLI and the decorators will apply the transformations. With `aggressive: true`, unused non-schema components (responses, headers, requestBodies, etc.) are removed as well.

The `remove-dangling-refs` decorator mirrors `removeDanglingRefs`, dropping `$ref`s whose targets are missing so bundling ends up free of dangling references.

Notes:
- Preferred plugin id is `oas-utils`. Old aliases `oas-remove-unused/remove-unused-schemas` and `oas-remove-unused/remove-from-oneof` still work.

## Programmatic usage

```
import {
  cleanupDiscriminatorMappings,
  removeDanglingRefs,
  removeSingleComposition,
  removeUnusedSchemas,
  allOfToOneOf,
  sealSchema,
} from 'oas-utils';

// Remove unused schemas
removeUnusedSchemas(doc, { keep: ['CommonError'], aggressive: true });

// Convert allOf + discriminator to oneOf + discriminator
allOfToOneOf(doc, { addDiscriminatorConst: true, mergeNestedOneOf: false });

// Clean up discriminator mappings
const result = cleanupDiscriminatorMappings(doc);
console.log(`Removed ${result.mappingsRemoved} invalid mappings from ${result.schemasChecked} schemas`);

// Seal object schemas
sealSchema(doc, { useUnevaluatedProperties: true, uplift: true });

// Remove dangling refs (aggressive mode prunes external URIs too)
const dangling = removeDanglingRefs(doc, { aggressive: true });
console.log(`Removed ${dangling.removed} dangling $ref(s)`);

// Remove single-composition wrapper schemas
const single = removeSingleComposition(doc);
console.log(`Removed ${single.schemasRemoved} single-composition schema(s)`);
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

### Development run

For rapid development and testing, use the dev script to run the CLI with auto-reload:

```
npm run dev <command> <input.yaml> [options]
```

Examples:

```
# Test remove-unused with auto-reload on code changes
npm run dev remove-unused examples/petstore.yaml -o output.yaml --keep CommonError

# Test allof-to-oneof transformation
npm run dev allof-to-oneof examples/polymorphic-minimal.yaml -o output.yaml

# Test seal-schema with uplift
npm run dev seal-schema examples/petstore.yaml -o output.yaml --uplift
```

The dev script uses `tsx watch` to automatically restart the CLI when source files change, making it easy to test your changes without rebuilding.
