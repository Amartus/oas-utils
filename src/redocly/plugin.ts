import RemoveUnusedDecorator from "./remove-unused-decorator.js";
import RemoveFromOneOfDecorator from "./remove-from-oneof-decorator.js";
import OptimizeAllOfDecorator from "./optimize-allof-decorator.js";
import AllOfToOneOfDecorator from "./allof-to-oneof-decorator.js";
import SealSchemaDecorator from "./seal-schema-decorator.js";
import CleanupDiscriminatorsDecorator from "./cleanup-discriminator-decorator.js";
import RemoveDanglingDecorator from "./remove-dangling-decorator.js";

export default function oasRemoveUnusedPlugin() {
  return {
  id: "oas-utils",
    decorators: {
      oas3: {
    // Preferred names (aligned with CLI subcommands)
    "remove-unused": RemoveUnusedDecorator,
    "remove-oneof": RemoveFromOneOfDecorator,
    "optimize-allof": OptimizeAllOfDecorator,
    "allof-to-oneof": AllOfToOneOfDecorator,
    "seal-schema": SealSchemaDecorator,
    "cleanup-discriminators": CleanupDiscriminatorsDecorator,
    "remove-dangling-refs": RemoveDanglingDecorator,
    // Back-compat aliases
    "remove-unused-schemas": RemoveUnusedDecorator,
    "remove-from-oneof": RemoveFromOneOfDecorator,
      },
      oas2: {
    // Preferred names
    "remove-unused": RemoveUnusedDecorator,
    "remove-oneof": RemoveFromOneOfDecorator,
    "optimize-allof": OptimizeAllOfDecorator,
    "allof-to-oneof": AllOfToOneOfDecorator,
    "seal-schema": SealSchemaDecorator,
    "cleanup-discriminators": CleanupDiscriminatorsDecorator,
    "remove-dangling-refs": RemoveDanglingDecorator,
    // Back-compat aliases
    "remove-unused-schemas": RemoveUnusedDecorator,
    "remove-from-oneof": RemoveFromOneOfDecorator,
      },
    },
  };
}
