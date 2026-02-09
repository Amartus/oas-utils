import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse, stringify } from 'yaml';
import { allOfToOneOf } from '../src/lib/allOfToOneOfJsonPath.js';

describe('Inheritance-only parent schema', () => {
  it('should not create wrapper for schemas only used in allOf (inheritance)', () => {
    const input = parse(readFileSync('test/resources/inheritance-only-parent.input.yaml', 'utf-8'));
    const result = allOfToOneOf(input, { addDiscriminatorConst: true });

    // Parent should NOT have a Polymorphic wrapper because it's never referenced outside allOf
    expect(result.components.schemas.ParentPolymorphic).toBeUndefined();
    expect(result.components.schemas.ParentOneOf).toBeUndefined();

    // Parent's discriminator should be removed even though it's not being wrapped
    expect(result.components.schemas.Parent.discriminator).toBeUndefined();
  });

  it('should not add const to parent when creating OneOf wrapper for it', () => {
    const input = parse(readFileSync('test/resources/inheritance-only-parent.input.yaml', 'utf-8'));
    const result = allOfToOneOf(input, { addDiscriminatorConst: true });

    // Child should NOT have const added to it directly
    const child = result.components.schemas.Child;
    expect(child.allOf).toBeDefined();

    // Check that const is not in Child's allOf
    const hasConst = child.allOf.some((item: any) =>
      item?.properties?.['@type']?.const === 'Child'
    );
    expect(hasConst).toBe(false);

    // But ChildOneOf SHOULD exist with the const
    expect(result.components.schemas.ChildOneOf).toBeDefined();
    expect(result.components.schemas.ChildOneOf.allOf).toBeDefined();

    const oneOfHasConst = result.components.schemas.ChildOneOf.allOf.some(
      (item: any) => item?.properties?.['@type']?.const === 'Child'
    );
    expect(oneOfHasConst).toBe(true);
  });

  it('should match expected output', () => {
    const input = parse(readFileSync('test/resources/inheritance-only-parent.input.yaml', 'utf-8'));
    const expected = parse(readFileSync('test/resources/inheritance-only-parent.expected.yaml', 'utf-8'));

    const result = allOfToOneOf(input, { addDiscriminatorConst: true });

    // Compare schemas
    expect(result.components.schemas.Parent).toEqual(expected.components.schemas.Parent);
    expect(result.components.schemas.Child).toEqual(expected.components.schemas.Child);
    expect(result.components.schemas.ChildOneOf).toEqual(expected.components.schemas.ChildOneOf);
    expect(result.components.schemas.ChildPolymorphic).toEqual(expected.components.schemas.ChildPolymorphic);

    // Verify unwanted schemas don't exist
    expect(result.components.schemas.ParentPolymorphic).toBeUndefined();
    expect(result.components.schemas.ParentOneOf).toBeUndefined();
  });

  it('should only create wrappers for schemas that are actually referenced', () => {
    const input = parse(readFileSync('test/resources/inheritance-only-parent.input.yaml', 'utf-8'));
    const result = allOfToOneOf(input, { addDiscriminatorConst: true });

    // Count schemas
    const schemaNames = Object.keys(result.components.schemas);

    // Should have: Entity, Parent, Child, GrandChild, 
    // Sibling, ChildOneOf, ChildPolymorphic
    expect(schemaNames.length).toBe(7);

    // Should NOT have unused wrappers
    expect(schemaNames).not.toContain('ParentPolymorphic');
    expect(schemaNames).not.toContain('ParentOneOf');
    expect(schemaNames).not.toContain('SiblingPolymorphic');
    expect(schemaNames).not.toContain('SiblingOneOf');
  });
});
