# Changelog

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
