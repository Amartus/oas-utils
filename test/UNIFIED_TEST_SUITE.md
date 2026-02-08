# Unified Test Suite for allOfToOneOf Implementations

This document describes the unified test suite created to test both the original and optimized implementations of the `allOfToOneOf` transformation **in a single test**.

## Overview

The unified test suite (`test/allOfToOneOf.unified.test.ts`) provides a single set of tests where **each test runs both implementations** and validates them independently. If either implementation fails a test, it clearly indicates which one has the problem.

## Key Features

✅ **Single Test, Both Implementations**: Each test executes both original and optimized versions  
✅ **Clear Failure Attribution**: Test messages indicate which implementation failed (e.g., "Original: CarPolymorphic should be created")  
✅ **Vehicle Test Included**: Contains the complex vehicle hierarchy test case  
✅ **Comprehensive Coverage**: Tests file-based scenarios, core functionality, nested hierarchies, and options

## Test Structure

Each test follows this pattern:

```typescript
it("test description", () => {
  const doc: any = { /* test data */ };

  // Test original implementation
  const docOriginal = deepClone(doc);
  allOfToOneOfOriginal(docOriginal);
  expect(docOriginal.components.schemas.SomeSchema, "Original: Description").toBeDefined();

  // Test optimized implementation
  const docOptimized = deepClone(doc);
  allOfToOneOfOptimized(docOptimized);
  expect(docOptimized.components.schemas.SomeSchema, "Optimized: Description").toBeDefined();
});
```

This approach means:
- Both implementations are tested in every test
- If one fails, you immediately know which one
- No need for separate test suites or parameterization

## Test Cases

### 1. File-Based Tests
- `foo-fvo-res` - Tests both implementations against expected YAML output
- `merge-nested-oneof` - Tests nested oneOf merging for both implementations

### 2. Core Functionality
- **Converts allOf + discriminator to oneOf**: Validates wrapper creation, const properties, and reference updates
- **Vehicle Hierarchy Test**: Complex multi-level hierarchy with Car → ElectricCar, CommercialCar, ensuring both implementations handle it correctly

### 3. Advanced Scenarios
- **Nested Polymorphic Bases**: Tests independent wrappers (Animal → Pet → Cat/Dog)
- **Reference Replacement**: Validates nested structure updates in both implementations
- **No Modification**: Ensures neither implementation changes docs without discriminators

### 4. Options Testing
- **addDiscriminatorConst**: Verifies both implementations respect the option to disable const properties

## Vehicle Test Details

The vehicle test is particularly important as it validates:

```
Vehicle (base)
├── Car (intermediate with own discriminator)
│   ├── ElectricCar
│   └── CommercialCar (has own discriminator)
└── Bike
```

**Both implementations must**:
- Create `CarPolymorphic` wrapper
- Include ElectricCar and CommercialCar in oneOf
- Update Dealership.primaryCar to reference CarPolymorphic
- Keep CommercialCar.discriminator intact
- Maintain proper inheritance chains

## Running Tests

```bash
# Run only the unified suite
npm test -- allOfToOneOf.unified.test.ts

# Run all tests (includes unified + original separate suites)
npm test
```

## Test Results

**8 unified tests**, each testing both implementations = **16 validations total**

When a test fails, the error message clearly shows which implementation failed:
```
Expected: Optimized: CarPolymorphic should be created
```

## Benefits

1. **Simple Mental Model**: One test validates both implementations
2. **Clear Attribution**: Failures explicitly state which implementation broke
3. **Easy Maintenance**: Add one test, validate both implementations
4. **Prevents Regression**: Ensures both implementations stay compatible
5. **Documentation**: Tests demonstrate expected behavior for both versions

## Implementation Differences

While both implementations pass all tests, they have different internal strategies:

### Original Implementation
- More aggressive wrapper creation
- Simpler algorithm, easier to understand
- May create wrappers even when not strictly needed

### Optimized Implementation  
- Creates wrappers only when schemas are referenced outside compositions
- Uses pre-built indexes for better performance on large documents
- More conservative about wrapper creation

Both produce compatible and correct results, as validated by these tests.

