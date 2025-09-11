import { removeUnusedSchemas, RemoveOptions } from '../lib/removeUnusedSchemas.js';

// Redocly decorator factory.
// See: https://redocly.com/docs/cli/custom-plugins/custom-decorators
export default function RemoveUnusedDecorator(config: { keep?: string[]; aggressive?: boolean } = {}) {
  const options: RemoveOptions = {
    keep: config.keep ?? [],
    aggressive: config.aggressive ?? false,
  };
  return {
    Root: {
      leave(target: any) {
        removeUnusedSchemas(target, options);
      },
    },
  };
}
