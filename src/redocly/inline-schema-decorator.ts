import { batchInlineSchemas } from "../lib/inlineSchema.js";

export default function InlineSchemaDecorator(opts: any) {
  return {
    Root: {
      leave(target: any) {
        const schemas = opts?.schemas || [];
        if (!Array.isArray(schemas) || schemas.length === 0) {
          return;
        }

        const combiner = opts?.combiner || 'allOf';
        const chain = opts?.chain || false;
        const warnDiscriminator = opts?.warnDiscriminator !== false;

        batchInlineSchemas(target, schemas, {
          combiner,
          chain,
          warnDiscriminator,
          onDiscriminatorWarning: (warning) => {
            console.warn(
              `[inline-schema] Schema '${warning.schemaName}' is in discriminator mapping of '${warning.parentName}' (property: ${warning.discriminatorProperty})`
            );
          },
        });
      },
    },
  };
}
