import RemoveUnusedDecorator from "./remove-unused-decorator.js";
import RemoveFromOneOfDecorator from "./remove-from-oneof-decorator.js";
import OptimizeAllOfDecorator from "./optimize-allof-decorator.js";

export default function oasRemoveUnusedPlugin() {
  return {
  id: "oas-utils",
    decorators: {
      oas3: {
    // Preferred names (aligned with CLI subcommands)
    "remove-unused": RemoveUnusedDecorator,
    "remove-oneof": RemoveFromOneOfDecorator,
    "optimize-allof": OptimizeAllOfDecorator,
    // Back-compat aliases
    "remove-unused-schemas": RemoveUnusedDecorator,
    "remove-from-oneof": RemoveFromOneOfDecorator,
      },
      oas2: {
    // Preferred names
    "remove-unused": RemoveUnusedDecorator,
    "remove-oneof": RemoveFromOneOfDecorator,
    "optimize-allof": OptimizeAllOfDecorator,
    // Back-compat aliases
    "remove-unused-schemas": RemoveUnusedDecorator,
    "remove-from-oneof": RemoveFromOneOfDecorator,
      },
    },
  };
}
