import { sealSchema } from "../lib/sealSchema.js";

export default function SealSchemaDecorator(opts: any) {
  return {
    Root: {
      leave(target: any) {
        sealSchema(target, {
          useUnevaluatedProperties: opts?.useUnevaluatedProperties !== false,
          uplift: opts?.uplift === true,
        });
      },
    },
  };
}
