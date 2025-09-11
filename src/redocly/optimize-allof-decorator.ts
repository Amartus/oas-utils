import { optimizeAllOfComposition } from "../lib/optimizeAllOfComposition.js";

export default function OptimizeAllOfDecorator() {
  return {
    Root: {
      leave(target: any) {
        optimizeAllOfComposition(target);
      },
    },
  };
}
