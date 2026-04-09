import { addDiscriminatorConst, ConstMode } from "../lib/addDiscriminatorConst.js";

export default function AddDiscriminatorConstDecorator(opts: any) {
  return {
    Root: {
      leave(target: any) {
        const mode: ConstMode = opts?.mode || 'auto';
        
        addDiscriminatorConst(target, {
          mode,
          forceUplift: Boolean(opts?.forceUplift),
          placement: opts?.placement,
          compatibilityMode: opts?.compatibilityMode,
        });
      },
    },
  };
}
