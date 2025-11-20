# Test Resources Directory Structure

## Organization

The test resources have been reorganized into logical directories based on usage patterns:

### `/test/resources/common/` (8 schemas)
Core reusable entity schemas used across multiple test files:

- **animal.json** - Abstract animal base type with discriminator (id, type, name, age, gender)
- **cat.json** - Cat specialization extending Animal (huntingSkill, livesLeft)
- **dog.json** - Dog specialization extending Animal (breed, isTrainedAsServiceDog)
- **person.json** - Person entity (name, age, address)
- **vehicle.json** - Abstract vehicle base type with discriminator (id, type)
- **car.json** - Car specialization extending Vehicle (numDoors)
- **pet-food.json** - Food schema (name, foodType)
- **pet-intermediate.json** - Pet intermediate type extending Animal with owner

### `/test/resources/sealSchema/` (10 schemas)
Test-specific input fixtures for sealSchema.test.ts:

- **base.json** - Simple base schema (id)
- **base-result.json** - Base result schema (status)
- **result.json** - Result extending BaseResult (data)
- **extended.json** - Extended schema via allOf composition
- **container.json** - Container with nested schema references
- **mixin1.json**, **mixin2.json** - Mixin schemas for composition tests
- **people.json** - Collection of people
- **string-name.json** - Minimal string type schema
- **integer-age.json** - Minimal integer type schema

## Schema Loading

The `loadSchemaFromFile()` function in `schemaLoader.ts` uses a fallback strategy:
1. First checks `/test/resources/common/` (core reusable entities)
2. Falls back to `/test/resources/sealSchema/` (test-specific fixtures)
3. Throws error if schema not found in either location

This allows for:
- **Single source of truth** - Core schemas defined once in common
- **Test isolation** - Test-specific fixtures remain in their test directories
- **Flexibility** - Easy to override or add test-specific variants
