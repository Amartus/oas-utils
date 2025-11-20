import { cleanupDiscriminatorMappings } from "../lib/cleanupDiscriminatorMappings.js";

export default function CleanupDiscriminatorsDecorator(opts: any) {
  return {
    Root: {
      leave(target: any) {
        const result = cleanupDiscriminatorMappings(target);
        if (result.mappingsRemoved > 0) {
          console.log(`[CLEANUP-DISCRIMINATORS] Removed ${result.mappingsRemoved} mapping(s).`);
          for (const detail of result.details) {
            console.log(`[CLEANUP-DISCRIMINATORS]   Schema '${detail.schema}': removed mappings [${detail.removed.join(", ")}]`);
          }
        }
      },
    },
  };
}
