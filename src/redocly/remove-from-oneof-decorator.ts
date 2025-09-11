import { removeFromOneOfByName, removeFromOneOfGlobally } from '../lib/removeFromOneOfByName.js';

type Config = {
  /** Optional parent schema name containing oneOf; if omitted, remove globally */
  parent?: string;
  /** Schema names to remove (at least one required) */
  remove: string[];
  /** If true, expand each provided name to name + all schemas starting with name_ */
  guess?: boolean;
};

function guessNames(base: string, doc: any): string[] {
  const keys = doc?.components?.schemas ? Object.keys(doc.components.schemas) : [];
  return [base, ...keys.filter((k) => k.startsWith(`${base}_`))];
}

export default function RemoveFromOneOfDecorator(config: Config) {
  const remove = Array.isArray(config?.remove) ? config.remove : [];
  const parent = config?.parent;
  const guess = Boolean(config?.guess);
  if (!remove.length) {
    // Redocly will call this during bundling; be tolerant and no-op when misconfigured
    return { Root: { leave() {} } } as const;
  }

  return {
    Root: {
      leave(target: any) {
        const doc = target;
        const toRemove = guess
          ? remove.flatMap((n) => guessNames(n, doc))
          : remove;

        if (parent) {
          for (const name of toRemove) {
            removeFromOneOfByName(doc, parent, name);
          }
        } else {
          for (const name of toRemove) {
            removeFromOneOfGlobally(doc, name);
          }
        }
      },
    },
  } as const;
}
