import { removeDanglingRefs } from '../src/lib/removeDanglingRefs.js';
import { describe, it, expect } from 'vitest';

describe('removeDanglingRefs', () => {
  it('removes $ref properties that point to non-existent component schemas', () => {
    const doc: any = {
      components: {
        schemas: {
          Foo: { type: 'object' },
        },
      },
      paths: {
        '/pets': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Bar' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const res = removeDanglingRefs(doc);
    expect(res.removed).toBe(1);
    // Ensure the $ref was removed from response schema
    expect(doc.paths['/pets'].get.responses['200'].content['application/json'].schema).toBeUndefined();
  });

  it('does not remove valid $ref entries', () => {
    const doc: any = {
      components: { schemas: { Foo: { type: 'object' } } },
      paths: { '/pets': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Foo' } } } } } } } },
    };

    const res = removeDanglingRefs(doc);
    expect(res.removed).toBe(0);
    expect(doc.paths['/pets'].get.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/Foo');
  });

  it('removes external/non-local $ref entries when aggressive is true', () => {
    const doc: any = {
      components: { schemas: { Foo: { type: 'object' } } },
      paths: { '/pets': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: 'http://example.com/schemas/External' } } } } } } } },
    };

    // non-aggressive should not remove external refs
    let copy = JSON.parse(JSON.stringify(doc));
    let res = removeDanglingRefs(copy, { aggressive: false });
    expect(res.removed).toBe(0);
    expect(copy.paths['/pets'].get.responses['200'].content['application/json'].schema.$ref).toBe('http://example.com/schemas/External');

    // aggressive should remove external refs
    copy = JSON.parse(JSON.stringify(doc));
    res = removeDanglingRefs(copy, { aggressive: true });
    expect(res.removed).toBe(1);
    expect(copy.paths['/pets'].get.responses['200'].content['application/json'].schema).toBeUndefined();
  });
});
