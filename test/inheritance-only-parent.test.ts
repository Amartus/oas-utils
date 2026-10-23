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

  it('should not add a constraint to the parent when creating its OneOf wrapper (children placement)', () => {
    const input = parse(readFileSync('test/resources/inheritance-only-parent.input.yaml', 'utf-8'));
    const result = allOfToOneOf(input, { addDiscriminatorConst: true, discriminatorConstPlacement: 'children' });

    // Child should NOT have a constraint added to it directly
    const child = result.components.schemas.Child;
    expect(child.allOf).toBeDefined();

    const hasConstraint = child.allOf.some((item: any) => item?.properties?.['@type'] !== undefined);
    expect(hasConstraint).toBe(false);

    // But ChildOneOf SHOULD exist with the constraint (enum, because the document is OpenAPI 3.0.1)
    expect(result.components.schemas.ChildOneOf).toBeDefined();
    expect(result.components.schemas.ChildOneOf.allOf).toBeDefined();

    const oneOfHasConstraint = result.components.schemas.ChildOneOf.allOf.some(
      (item: any) => Array.isArray(item?.properties?.['@type']?.enum) && item.properties['@type'].enum.includes('Child')
    );
    expect(oneOfHasConstraint).toBe(true);
  });

  it('should match expected output', () => {
    const input = parse(readFileSync('test/resources/inheritance-only-parent.input.yaml', 'utf-8'));
    const expected = parse(readFileSync('test/resources/inheritance-only-parent.expected.yaml', 'utf-8'));

    const result = allOfToOneOf(input, { addDiscriminatorConst: true });

    // Compare schemas
    expect(result.components.schemas.Parent).toEqual(expected.components.schemas.Parent);
    expect(result.components.schemas.Child).toEqual(expected.components.schemas.Child);
    expect(result.components.schemas.GrandChild).toEqual(expected.components.schemas.GrandChild);
    expect(result.components.schemas.ChildPolymorphic).toEqual(expected.components.schemas.ChildPolymorphic);

    // Verify unwanted schemas don't exist
    expect(result.components.schemas.ParentPolymorphic).toBeUndefined();
    expect(result.components.schemas.ParentOneOf).toBeUndefined();
    expect(result.components.schemas.ChildOneOf).toBeUndefined();
  });

  it('should only create wrappers for schemas that are actually referenced', () => {
    const input = parse(readFileSync('test/resources/inheritance-only-parent.input.yaml', 'utf-8'));
    const result = allOfToOneOf(input, { addDiscriminatorConst: true });

    // Count schemas
    const schemaNames = Object.keys(result.components.schemas);

    // Should have: Entity, Parent, Child, GrandChild,
    // Sibling, ChildPolymorphic
    expect(schemaNames.length).toBe(6);

    // Should NOT have unused wrappers
    expect(schemaNames).not.toContain('ParentPolymorphic');
    expect(schemaNames).not.toContain('ParentOneOf');
    expect(schemaNames).not.toContain('SiblingPolymorphic');
    expect(schemaNames).not.toContain('SiblingOneOf');
  });
});
