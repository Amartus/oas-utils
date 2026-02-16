# Changelog

## [0.7.2] - 2026-02-16
### Added
- Enhanced `remove-single-composition` with `--keep` CLI option to specify schema names that should be preserved, even if they are single-composition wrappers.
- Added `replacements` tracking to `removeSingleComposition` API, returning a map of removed schemas to their replacement targets for transparency and debugging.

### Changed
- Improved transitive chain resolution in `remove-single-composition` to respect the `keep` predicate: when an intermediate schema in a chain is marked to keep, the resolution stops at that schema instead of continuing through it. For example, if A→B→C but B is kept, A will resolve to B (not C).

## [0.7.0] - 2026-02-13
### Added
- `remove-single-composition` operation: removes single-composition wrapper schemas (schemas whose only content is a single `allOf`, `anyOf`, or `oneOf` with one `$ref`) and rewires all references to point directly to the target schema. Supports transitive chain resolution and discriminator mapping updates. Available as CLI command, Redocly decorator (`oas-utils/remove-single-composition`), and programmatic API (`removeSingleComposition`).

## [0.6.0] - 2026-02-09
### Breaking Changes
- Rewrote `allOfToOneOf` using a JSONPath-based implementation, replacing the original recursive approach. The public API (`allOfToOneOf` function and CLI command) remains the same, but the internal module path changed from `allOfToOneOf.js` to `allOfToOneOfJsonPath.js`.
- Removed the non-functional `--remove-discriminator-from-base` CLI option and `removeDiscriminatorFromBase` config key. Discriminators are now always removed from base schemas that receive polymorphic wrappers.

### Added
- `--merge-nested-oneof` CLI option for `allof-to-oneof` command to merge nested oneOf schemas by inlining references to schemas that only contain oneOf.
- Extracted `AllOfToOneOfOptions` and `AllOfToOneOfTransform` interfaces into a dedicated `allOfToOneOfInterface.ts` module.
- File-based test infrastructure for `allOfToOneOf` with real-world regression test cases.
- Test for inheritance-only parent schemas (bases not referenced directly in the API).

### Changed
- `allOfToOneOf` now skips creating polymorphic wrapper schemas when the base schema is only used for inheritance and not referenced directly in paths, operations, or other components.
- Updated README documentation to accurately reflect `allof-to-oneof` behavior, options, and Redocly decorator configuration.

### Removed
- Removed the original `allOfToOneOf.ts` implementation.
- Removed the alternative `allOfToOneOfOptimized.ts` implementation.

## [0.5.0] - 2026-01-19
### Added
- Added `mergeNestedOneOf` option to `allOfToOneOf` transformation to optimize oneOf schemas by inlining references to "simple oneOf wrapper" schemas (schemas containing only oneOf, discriminator, and/or description).
- Added file-based test infrastructure to `allOfToOneOf` tests for easier regression testing with real-world examples.

### Changed
- Enhanced `allOfToOneOf` to skip creating polymorphic wrapper schemas when the base schema is only used for inheritance and not referenced directly in the API (paths, operations, or components).
- Updated multiple tests to add explicit API references where polymorphic wrappers should be created, reflecting the new smarter wrapper creation logic.

## [0.4.0] - 2025-12-15
### Added
- Introduced `removeDanglingRefs` (and the `remove-dangling-refs` decorator) so you can drop `$ref`s that point to deleted component schemas during programmatic runs or Redocly bundling.
### Changed
- `removeUnusedSchemas` now builds and reuses an `allOf` reverse map, iterating until the used set stabilizes while honoring `--ignore-parents`, plus the helper now shares a single transitive reference collector.

## [0.3.8] - 2025-12-02
### Changed
- Reimplemented seal functionality
- Test alignment with new implementation 
### Added
- Extra test for seal functionality

## [0.3.7] - 2025-11-28
### Changed
- Fixed OAS with discriminator cleanup
- Refined `allOfToOneOf` tests to assert the new discriminator ownership model.

## [0.3.6] - 2025-11-28
### Added
- Introduced a minimal polymorphic OpenAPI 3.1 example (`examples/polymorphic-minimal.yaml`) showcasing `allOf` inheritance with a discriminator-based base schema.

### Changed
- Extended `allOfToOneOf` to support nested polymorphic bases with their own wrappers, ensuring parent wrappers expose child polymorphic wrappers instead of raw bases.
- Updated reference-rewrite logic to support propert `oneOf` accross full spec.

## [0.3.5] - 2025-11-27
### Changed
- Introduced a template-style sealing pipeline (`SchemaSealerTemplate`, `ComponentSchemaSealer`, `NestedSchemaSealer`) so OpenAPI versus standalone JSON Schema handling share the same core steps while only the normalization/finalization hooks differ.
- Consolidated the `allOf` reference rewrites behind `updateAllOfReferencesWithQuery`, keeping both component-level and nested updates in sync.
- Separated document entry points via explicit handlers (`jsonSchemaSealHandler` vs `openApiSealHandler`) so the core `sealSchema` flow is easier to extend without duplicating context logic.

## [0.3.4] - 2025-11-26
### Fixed
- `sealSchema` no longer blocks `additionalProperties:false` sealing for documents that already target JSON Schema 2020-12 (or OpenAPI 3.1) and therefore support `unevaluatedProperties`; the compatibility guard now only throws when the schema version lacks native `unevaluatedProperties` support.
- Added regression coverage for the JSON Schema 2020-12 scenario to guarantee composition roots still seal correctly using shared fixtures.

## [0.3.2] - 2025-11-25
### Added
- Added compatibility checks in `sealSchema` so sealing with `additionalProperties:false` now raises an error when the document deliberately targets OpenAPI 3.0.x or JSON Schema draft-07 and contains `allOf` references. Users can upgrade with `--uplift` or switch to `unevaluatedProperties` instead.
- Documented the new compatibility rules and JSONPath-based detection in the README.

### Changed
- Added `jsonpath-plus` to runtime helpers (`sealSchema`, `removeUnusedSchemas`, `optimizeAllOfComposition`, `oasUtils`, and related utilities) to more accurately detect `$ref`/`allOf` usages without expensive manual recursion.
- Refactored schema traversal helpers (`schemaTransformUtils`, `removeUnusedSchemas`) to rely on JSONPath value queries with clear fallbacks when necessary.

### Fixed
- Ensured sealing logic reuses JSONPath to detect `allOf` references across the document, preventing unsafe additional-properties sealing on older drafts.

