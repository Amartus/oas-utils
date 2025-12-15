# Changelog

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

