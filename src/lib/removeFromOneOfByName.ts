

function updateDiscriminator(node: any, removeName: string): boolean {
      if (node.discriminator && node.discriminator.mapping) {
        for (const [key, ref] of Object.entries(node.discriminator.mapping)) {
          const name = refToName(ref as string);
          if (name === removeName) {
            delete node.discriminator.mapping[key];
            return true;
          }
        }
      }
      return false;
}

function updateOneOf(node: any, removeName: string): boolean {
    if (!node  || ! Array.isArray(node.oneOf)) {
        return false;
    }

    const beforeLength = node.oneOf.length;
    node.oneOf = node.oneOf.filter((item: any) => {
        if (typeof item?.$ref === "string") {
          const name = refToName(item.$ref);
          return name !== removeName;
        }
        return true;
      });
    return beforeLength !== node.oneOf.length;
}

/**
 * Remove a schema from all oneOfs in the OAS and update discriminator mappings globally.
 * @param doc OpenAPI document
 * @param removeName Name of the schema to remove from all oneOfs
 * @returns Number of schemas modified
 */
export function removeFromOneOfGlobally(doc: any, removeName: string): number {
  let modified = 0;
  function traverse(node: any) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(traverse);
      return;
    }

    if(updateOneOf(node, removeName)) {
        updateDiscriminator(node, removeName);
        modified++;
    }

      
    for (const k of Object.keys(node)) {
      traverse(node[k]);
    }
  }
  traverse(doc);
  return modified;
}
import { refToName } from './oasUtils.js';

/**
 * Remove a schema from oneOf by name and update discriminator mappings.
 * @param doc OpenAPI document
 * @param parentSchemaName Name of the parent schema containing oneOf
 * @param removeName Name of the schema to remove from oneOf
 */
export function removeFromOneOfByName(doc: any, parentSchemaName: string, removeName: string): boolean {
    if (!doc?.components?.schemas) return false;
    const parentSchema = doc.components.schemas[parentSchemaName];
    const removed = updateOneOf(parentSchema, removeName);
    if (removed) {
      return updateDiscriminator(parentSchema, removeName);
    }
    return false;
}


