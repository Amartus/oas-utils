import { allOfToOneOf } from "../lib/allOfToOneOfJsonPath.js";

export default function AllOfToOneOfDecorator(opts: any) {
  return {
    Root: {
      leave(target: any) {
        allOfToOneOf(target, {
          addDiscriminatorConst: opts?.addDiscriminatorConst !== false,
          ignoreSingleSpecialization: opts?.ignoreSingleSpecialization || false,
        });
      },
    },
  };
}
