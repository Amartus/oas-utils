import { removeDanglingRefs } from '../lib/removeDanglingRefs.js';

export default function RemoveDanglingDecorator(opts: any) {
  return {
    Root: {
      leave(target: any) {
        const result = removeDanglingRefs(target);
        if (result.removed > 0) {
          console.log(`[REMOVE-DANGLING] Removed ${result.removed} dangling $ref(s).`);
        }
      },
    },
  };
}
