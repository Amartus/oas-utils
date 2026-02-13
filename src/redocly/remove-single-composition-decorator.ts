import { removeSingleComposition } from '../lib/removeSingleComposition.js';

export default function RemoveSingleCompositionDecorator(opts: any) {
  return {
    Root: {
      leave(target: any) {
        const result = removeSingleComposition(target, { aggressive: Boolean(opts?.aggressive) });
        if (result.schemasRemoved > 0) {
          console.log(`[REMOVE-SINGLE-COMPOSITION] Removed ${result.schemasRemoved} single-composition schema(s): ${result.removed.join(", ")}`);
        }
      },
    },
  };
}
