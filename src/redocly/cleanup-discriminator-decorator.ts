import { cleanupDiscriminatorMappings, CleanupDiscriminatorOptions } from "../lib/cleanupDiscriminatorMappings.js";

export default function CleanupDiscriminatorsDecorator(opts: CleanupDiscriminatorOptions = {}) {
  return {
    Root: {
      leave(target: any) {
        const result = cleanupDiscriminatorMappings(target, opts);
        if (result.discriminatorsRemoved > 0) {
          console.log(`[CLEANUP-DISCRIMINATORS] Removed ${result.discriminatorsRemoved} discriminator(s) entirely from schemas: [${result.removedDiscriminators.join(", ")}]`);
        }
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
